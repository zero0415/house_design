import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
    calculateBudget, calculatePlanTotal,
} from "../extensions/renovation-equipment/assets/budget.js";
import {
    APPROVED_MANAGEMENT_FEE, editManagementFee, guardManagementFeeUpdate,
    importManagementFee, managementFeeCsv, managementFeeSummary,
    undoManagementFee, validateFeePeriod, validateManagementFee,
} from "../extensions/renovation-equipment/assets/management-fee.js";
import {
    managementFeeDescription, managementFeeUI, renderManagementFee,
} from "../extensions/renovation-equipment/assets/management-fee-view.js";
import { editCalendar, undoCalendar } from
    "../extensions/renovation-equipment/assets/construction-calendar.js";
import {
    decodeSave, encodeSave, itemListCsv,
} from "../extensions/renovation-equipment/assets/file-actions.js";
import { migratePublicManagementFee } from
    "../extensions/renovation-equipment/management-fee-migration.mjs";
import {
    createStore, summarize, validateState,
} from "../extensions/renovation-equipment/state.mjs";

const priorBytes = execFileSync("git", [
    "show",
    "b50ab2632334f98c03246c8a42c98400ca7e0604:files/設備規劃.json",
], { maxBuffer: 4 * 1024 * 1024 });
const candidateBytes = await readFile(
    new URL("../files/設備規劃.json", import.meta.url));
const hash = (value) => createHash("sha256").update(value).digest("hex");
const source = JSON.parse(priorBytes);
const candidate = JSON.parse(candidateBytes);
const protectedFields = (state) => ({
    rooms: state.rooms, items: state.items,
    products: state.products, undo: state.undo,
    constructionCalendar: state.constructionCalendar,
});
const caps = {
    controlRelationsVersion: 1, doorAllocationVersion: 1,
    robotFeatureVersion: 1, calendarFeatureVersion: 1,
    calendarAttendeesVersion: 1, managementFeeVersion: 1,
};

test("public-only guarded migration adds exactly the approved fee to r0 anonymous sample", () => {
    assert.equal(hash(priorBytes),
        "413ae7ded2f07315" +
        "61630e032ec22c966850be87cc357a9c9f01b0f4407db1d6");
    assert.equal(hash(candidateBytes),
        "a0e9dec5cf9707262f10d2d18daadf3030943ba8e41fcd084ef5c30d13faf3a4");
    assert.deepEqual(Object.keys(candidate),
        [...Object.keys(source), "managementCleaningFee"]);
    assert.deepEqual(protectedFields(candidate), protectedFields(source));
    assert.deepEqual(candidate.managementCleaningFee, {
        version: 1, fee: APPROVED_MANAGEMENT_FEE, undo: { fee: null },
    });
    assert.deepEqual(migratePublicManagementFee(source), candidate);
    assert.deepEqual(migratePublicManagementFee(candidate), candidate);
    assert.deepEqual([candidate.version, candidate.revision, candidate.undo,
        candidate.rooms.length, candidate.items.length,
        candidate.products.length, candidate.constructionCalendar.version,
        candidate.constructionCalendar.events.length,
        candidate.constructionCalendar.undo.length],
    [5, 0, null, 13, 182, 28, 2, 13, 12]);
    assert(candidate.items.some((item) =>
        item.id === "living-auto-water-robot"));
    assert.equal(candidate.items.filter((item) =>
        item.switchType && item.switchPlanStatus === "active").length, 14);
    assert.deepEqual(["R", "B", "C"].map((prefix) =>
        candidate.items.filter((item) =>
            item.outletPlanPointId?.startsWith(prefix)).length),
    [51, 9, 7]);
    assert.deepEqual(validateState(candidate).managementCleaningFee,
        candidate.managementCleaningFee);
    assert.deepEqual(summarize(candidate).managementFeeTotals,
        { fee: APPROVED_MANAGEMENT_FEE, days: 110,
            sundays: 15, totalTWD: 11_000 });
    assert.equal(summarize(source).originalQuoteTWD, 1_959_530);
    assert.equal(summarize(source).overallTotals.TWD, 2_322_060.2);
    assert.equal(summarize(candidate).overallTotals.TWD, 2_333_060.2);
    assert.deepEqual(summarize(candidate).additionalTotals,
        summarize(source).additionalTotals);
    assert.equal(itemListCsv(candidate), itemListCsv(source));
    assert.throws(() => migratePublicManagementFee({
        ...source, unreviewed: true,
    }), /匿名 v5/);
});

test("110 calendar days include all 15 Sundays regardless of rendered job rest", () => {
    assert.deepEqual(managementFeeSummary(candidate.managementCleaningFee),
        { fee: APPROVED_MANAGEMENT_FEE, days: 110,
            sundays: 15, totalTWD: 11_000 });
    assert.equal(calculatePlanTotal(
        calculateBudget(candidate.items, { wholePlan: true })).TWD,
    2_322_060.2);
    assert.equal(calculatePlanTotal(
        calculateBudget(candidate.items, { wholePlan: true }),
        candidate.managementCleaningFee).TWD, 2_333_060.2);
    const originalTZ = process.env.TZ;
    try {
        for (const timezone of [
            "Asia/Taipei", "America/New_York", "Pacific/Honolulu",
        ]) {
            process.env.TZ = timezone;
            assert.equal(managementFeeSummary(
                candidate.managementCleaningFee).days, 110);
            assert.equal(managementFeeSummary(
                candidate.managementCleaningFee).sundays, 15);
        }
    } finally {
        if (originalTZ === undefined) delete process.env.TZ;
        else process.env.TZ = originalTZ;
    }
    const changedCalendar = editCalendar(
        candidate.constructionCalendar, {
            ...candidate.constructionCalendar.events[0],
            start: "2028-01-01", end: "2028-02-01",
        });
    const altered = { ...candidate, constructionCalendar: changedCalendar };
    assert.deepEqual(altered.managementCleaningFee,
        candidate.managementCleaningFee);
    assert.equal(summarize(altered).overallTotals.TWD, 2_333_060.2);
    assert.deepEqual(undoCalendar(changedCalendar).events,
        candidate.constructionCalendar.events);
});

test("editing rate and dates preserves separate equipment/calendar/fee Undo", () => {
    const edited = editManagementFee(candidate.managementCleaningFee, {
        start: "2026-10-25", end: "2026-10-26", dailyRate: 100.25,
    });
    assert.deepEqual(managementFeeSummary(edited), {
        fee: edited.fee, days: 2, sundays: 1, totalTWD: 200.5,
    });
    assert.equal(summarize({ ...candidate,
        managementCleaningFee: edited }).overallTotals.TWD, 2_322_260.7);
    assert.deepEqual(undoManagementFee(edited).fee,
        candidate.managementCleaningFee.fee);
    const sundayOnly = editManagementFee(edited, {
        start: "2026-10-25", end: "2026-10-25", dailyRate: 100,
    });
    assert.equal(managementFeeSummary(sundayOnly).totalTWD, 100);
    assert.deepEqual(protectedFields({ ...candidate,
        managementCleaningFee: edited }), protectedFields(candidate));
    assert.deepEqual(undoManagementFee(
        candidate.managementCleaningFee), {
        version: 1, fee: null, undo: null,
    });
    assert.throws(() => undoManagementFee({
        version: 1, fee: null, undo: null,
    }), /沒有可還原/);
});

test("fee schema rejects malformed dates/rates/history and silent unknown fields", () => {
    for (const dailyRate of [
        null, "", "100", NaN, Infinity, -1, 100.001, 1e9 + 1,
    ]) {
        assert.throws(() => validateFeePeriod({
            ...APPROVED_MANAGEMENT_FEE, dailyRate,
        }), TypeError);
    }
    for (const [start, end] of [
        ["2026-02-30", "2027-01-01"],
        ["2027-01-02", "2027-01-01"],
        ["2026-1-01", "2026-02-01"],
        ["1900-12-31", "2027-01-01"],
    ]) {
        assert.throws(() => validateFeePeriod({
            start, end, dailyRate: 100,
        }), TypeError);
    }
    assert.equal(managementFeeSummary(editManagementFee(undefined, {
        start: "2028-02-28", end: "2028-03-01", dailyRate: 0.29,
    })).totalTWD, 0.87);
    assert.equal(managementFeeSummary(editManagementFee(undefined, {
        ...APPROVED_MANAGEMENT_FEE, dailyRate: 0,
    })).totalTWD, 0);
    for (const fee of [
        null, {}, { version: 2, fee: null, undo: null },
        { version: 1, fee: null }, { version: 1, fee: null, undo: {} },
        { ...candidate.managementCleaningFee, recipient: "unapproved" },
    ]) {
        assert.throws(() => validateManagementFee(fee), TypeError);
        assert.throws(() => validateState({
            ...source, managementCleaningFee: fee,
        }), (error) => error.status === 400);
    }
    assert.throws(() => validateState({
        ...candidate, version: 4,
    }), (error) => error.status === 400);
});

test("JSON11 round-trips fee and old JSON10 imports preserve existing fee/Undo", () => {
    const exported = JSON.parse(encodeSave(candidate));
    assert.equal(exported.formatVersion, 11);
    assert.deepEqual(decodeSave(JSON.stringify(exported))
        .managementCleaningFee, candidate.managementCleaningFee);
    assert.equal(JSON.parse(encodeSave(source)).formatVersion, 10);
    const importedOld = decodeSave(encodeSave(source));
    assert.deepEqual(importManagementFee(candidate, importedOld),
        { managementCleaningFee: candidate.managementCleaningFee });
    const wrapper = (state, version) => JSON.stringify({
        format: exported.format, formatVersion: version, state,
    });
    for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]) {
        assert.throws(() => decodeSave(wrapper(candidate, version)),
            /容器 11/);
    }
    const missingFee = structuredClone(candidate);
    delete missingFee.managementCleaningFee;
    assert.throws(() => decodeSave(wrapper(missingFee, 11)),
        /容器 11/);
    const oldCalendar = structuredClone(source);
    oldCalendar.constructionCalendar.version = 1;
    oldCalendar.constructionCalendar.events = oldCalendar
        .constructionCalendar.events.map(
            ({ attendees: _roles, ...event }) => event);
    oldCalendar.constructionCalendar.undo = oldCalendar
        .constructionCalendar.undo.map(
            ({ attendees: _roles, ...event }) => event);
    assert.equal(JSON.parse(encodeSave(oldCalendar)).formatVersion, 9);
    assert.deepEqual(importManagementFee(candidate,
        decodeSave(encodeSave(oldCalendar))),
    { managementCleaningFee: candidate.managementCleaningFee });
    const revised = { ...candidate, managementCleaningFee:
        editManagementFee(candidate.managementCleaningFee, {
            ...APPROVED_MANAGEMENT_FEE, dailyRate: 150,
        }) };
    assert.deepEqual(importManagementFee(candidate,
        decodeSave(encodeSave(revised)))
        .managementCleaningFee.undo.fee,
    candidate.managementCleaningFee.fee);
    assert.equal(managementFeeCsv(candidate.managementCleaningFee)
        .trim().split("\r\n").length, 2);
    assert.equal(managementFeeCsv(undoManagementFee(
        candidate.managementCleaningFee)).trim().split("\r\n").length, 1);
});

test("stale writes get 409 before fee guards get 400; no fee or Undo can be dropped", async () => {
    const directory = await mkdtemp(join(tmpdir(), "public-fee-"));
    try {
        const path = join(directory, "state.json");
        await writeFile(path, priorBytes);
        const store = createStore(path);
        const current = await store.read();
        const added = {
            ...current, managementCleaningFee:
                candidate.managementCleaningFee,
        };
        const saved = await store.update(current.revision, {
            ...added, ...caps,
        });
        assert.equal(saved.revision, 1);
        assert.deepEqual(protectedFields(saved),
            protectedFields(current));
        assert.equal(summarize(saved).overallTotals.TWD, 2_333_060.2);
        const after = await readFile(path);
        await assert.rejects(() => store.update(0, {
            ...current, managementFeeVersion: undefined,
        }), (error) => error.status === 409);
        await assert.rejects(() => store.update(1, {
            ...saved, ...caps, managementFeeVersion: undefined,
        }), (error) => error.status === 400);
        await assert.rejects(() => store.update(1, {
            ...current, ...caps,
        }), (error) => error.status === 400);
        await assert.rejects(() => store.update(1, {
            ...saved, ...caps,
            managementCleaningFee: { version: 99 },
        }), (error) => error.status === 400);
        assert.deepEqual(await readFile(path), after);
        const restored = await store.update(1, {
            ...saved, ...caps, managementCleaningFee:
                undoManagementFee(saved.managementCleaningFee),
        });
        assert.equal(restored.managementCleaningFee.fee, null);
        assert.deepEqual(protectedFields(restored),
            protectedFields(current));
        assert.throws(() => guardManagementFeeUpdate(restored, {
            ...restored, ...caps, managementFeeVersion: 0,
        }), /舊版/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("fee edits and fee-only Undo retain a populated equipment Undo and calendar Undo", async () => {
    const directory = await mkdtemp(join(tmpdir(), "public-fee-undo-"));
    try {
        const path = join(directory, "state.json");
        await writeFile(path, priorBytes);
        const store = createStore(path);
        const current = await store.read();
        const equipmentUndo = {
            rooms: current.rooms, items: current.items,
            products: current.products,
        };
        const created = await store.update(current.revision, {
            ...current, ...caps, undo: equipmentUndo,
            managementCleaningFee: candidate.managementCleaningFee,
        });
        assert.deepEqual(created.undo, equipmentUndo);
        const changed = await store.update(created.revision, {
            ...created, ...caps, managementCleaningFee:
                editManagementFee(created.managementCleaningFee, {
                    start: "2026-10-25", end: "2026-10-26",
                    dailyRate: 100.25,
                }),
        });
        assert.deepEqual(changed.undo, equipmentUndo);
        assert.deepEqual(changed.constructionCalendar,
            current.constructionCalendar);
        const restored = await store.update(changed.revision, {
            ...changed, ...caps,
            managementCleaningFee:
                undoManagementFee(changed.managementCleaningFee),
        });
        assert.deepEqual(restored.undo, equipmentUndo);
        assert.deepEqual(restored.constructionCalendar,
            current.constructionCalendar);
        assert.deepEqual(restored.managementCleaningFee.fee,
            APPROVED_MANAGEMENT_FEE);
        assert.equal(summarize(restored).overallTotals.TWD, 2_333_060.2);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});

test("fee card and separate CSV show recipient, inclusive Sundays and quote boundary", () => {
    const before = structuredClone(candidate);
    const html = renderManagementFee(candidate.managementCleaningFee,
        managementFeeUI());
    for (const text of [
        "110 個日曆日", "15 個週日", "NT$11,000",
        "管委會", "NT$35,000", "不隨工項",
        "還原清潔費上一步",
    ]) assert(html.includes(text), text);
    assert.match(renderManagementFee(undefined,
        managementFeeUI()), /未設定／未計入/);
    assert.match(renderManagementFee(candidate.managementCleaningFee,
        { ...managementFeeUI(), draft: APPROVED_MANAGEMENT_FEE }),
    /name="dailyRate"/);
    assert.match(managementFeeDescription(
        candidate.managementCleaningFee), /110 個日曆日/);
    const csv = managementFeeCsv(candidate.managementCleaningFee);
    assert.match(csv, /"110","15","100","11000"/);
    assert.match(csv, /不取代原工程清潔 NT\$35,000/);
    assert.deepEqual(candidate, before);
});
