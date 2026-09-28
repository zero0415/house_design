import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
    createStore, StoreError, summarize, validateState,
} from "../extensions/renovation-equipment/state.mjs";
import { migrateDoorAllocation } from
    "../extensions/renovation-equipment/door-migration.mjs";
import {
    calculateBudget, itemSubtotal, ORIGINAL_QUOTE_TWD, unquotedTrackCost,
} from "../extensions/renovation-equipment/assets/budget.js";
import {
    quoteProvenance, markerQuoteProvenance,
} from "../extensions/renovation-equipment/assets/quote-provenance.js";
import {
    decodeSave, encodeSave, itemListCsv,
} from "../extensions/renovation-equipment/assets/file-actions.js";
import {
    renderOverviewPlan, renderRoomPlan,
} from "../extensions/renovation-equipment/assets/floorplan.js";
import { renderElectricalSheet } from
    "../extensions/renovation-equipment/assets/electrical-sheets.js";
import { previewCircuitLinks } from
    "../extensions/renovation-equipment/assets/circuit-preview.js";
import { ROBOT_ID } from
    "../extensions/renovation-equipment/assets/robot-plan.js";

const path = new URL("../files/設備規劃.json", import.meta.url);
const raw = await readFile(path, "utf8");
const currentSample = JSON.parse(raw);
const sample = structuredClone(currentSample);
sample.items = sample.items.filter((entry) => entry.id !== ROBOT_ID);
const item = (state, id) => state.items.find((entry) => entry.id === id);
const snapshot = (state) => structuredClone({
    rooms: state.rooms, items: state.items, products: state.products,
});
const total = (state) => summarize(state).overallTotals.TWD;
const capabilities = { controlRelationsVersion: 1, doorAllocationVersion: 1 };
const changedIds = [
    "door-balcony", "door-bedroom-2", "door-main-bath-master",
    "door-main-bath-hall", "track-main-bath-hall",
    "track-bedroom-3-studio", "door-bedroom-3-studio",
];
const originalDoorNote =
    "已含在原報價；切換材質後的價差僅供規劃，實際價格須廠商確認。";
const originalTrackNote =
    "原報價「滑門軌道－主浴.工作室」合計 1.6 米 × 1,800 元＝2,880 元；\n" +
    "            依屋主指示暫分這道拉門 0.8 米、1,440 元。軌道長度為暫估，\n" +
    "            未含於此筆的門片本體仍須另議；取消或轉用已含軌道門片的減項須廠商確認。";

function previousPublicDoors() {
    const before = structuredClone(sample);
    before.items = before.items.filter((entry) =>
        entry.id !== "door-bedroom-3-studio");
    const balcony = item(before, "door-balcony");
    Object.assign(balcony, {
        doorMaterial: "wood-slide", brandModel: "木纖滑門",
        unitPrice: 19000, quotedUnitPrice: 19000,
        priceSource: "原報價｜門片工程", note: originalDoorNote,
    });
    delete balcony.doorQuoteAllocation;
    item(before, "door-bedroom-2").note = originalDoorNote;
    Object.assign(item(before, "door-main-bath-master"), {
        doorMaterial: "wood-fiber", brandModel: "木纖門", unitPrice: 10500,
        priceSource: "原報價門片單價（跨材質試算，待廠商確認）",
        note: originalDoorNote,
    });
    Object.assign(item(before, "door-main-bath-hall"), {
        doorOpeningKind: "slide",
        note: originalDoorNote +
            " 新配置確認通客餐廳為拉門；目前單價仍沿用原塑鋼廁所門報價基準，" +
            "拉門滑軌與施工價差須請廠商重報，未自動計入追加。",
    });
    const mainTrack = item(before, "track-main-bath-hall");
    Object.assign(mainTrack, {
        roomId: "bath-main", trackDoorId: "main-bath-hall",
        name: "滑門軌道－主浴門", priceSource: "原報價｜輕隔間工程",
        note: originalTrackNote,
    });
    delete mainTrack.doorQuoteAllocation;
    const studioTrack = item(before, "track-bedroom-3-studio");
    Object.assign(studioTrack, {
        priceSource: "原報價｜輕隔間工程", note: originalTrackNote,
    });
    delete studioTrack.doorQuoteAllocation;
    validateState(before);
    return before;
}

const before = previousPublicDoors();
const migration = migrateDoorAllocation(before);

test("public release is v5 r0 without private history and the exact +3500 attribution", () => {
    assert.equal(currentSample.items.length, 182);
    assert.equal(createHash("sha256").update(
        JSON.stringify(sample, null, 2) + "\n").digest("hex"),
        "a427936df43e0ec5b487002306951b33a99c9d2497a265970f7a227f9edc33dd");
    assert.deepEqual([
        sample.version, sample.revision, sample.undo,
        sample.rooms.length, sample.items.length, sample.products.length,
    ], [5, 0, null, 13, 181, 28]);
    validateState(sample);
    assert.equal(ORIGINAL_QUOTE_TWD, 1_959_530);
    assert.equal(total(before), 2_318_560.2);
    assert.equal(total(sample), 2_322_060.2);
    assert.equal(total(sample) - total(before), 3500);
    assert.equal(calculateBudget(sample.items).quotedDoorTotal, 114500);
    assert.equal(sample.items.filter((entry) => entry.trackDoorId).reduce(
        (sum, entry) => sum +
            entry.quotedQuantity * entry.quotedUnitPrice, 0), 2880);
    assert.deepEqual(
        ["R", "B", "C"].map((prefix) => sample.items.filter((entry) =>
            entry.outletPlanPointId?.startsWith(prefix)).length),
        [51, 9, 7],
    );
    const lights = sample.items.filter((entry) => entry.lightType &&
        entry.placement);
    assert.equal(lights.length, 16);
    assert.equal(lights.reduce((sum, entry) => sum +
        (entry.lightType === "track" ?
            entry.spotlightQuantity : entry.quantity), 0), 19);
    assert.deepEqual([
        sample.items.filter((entry) => entry.switchType &&
            entry.switchPlanStatus === "active").length,
        sample.items.filter((entry) => entry.switchType &&
            entry.switchPlanStatus === "removed").length,
    ], [14, 2]);
    assert(sample.items.every((entry) =>
        !Object.hasOwn(entry, "controlledLightIds")));
    assert.deepEqual(previewCircuitLinks(sample.items), []);
    assert(sample.items.every((entry) =>
        !/拖地機器人|自動補水.*排污/.test(entry.name)));
});

test("pure guarded public migration changes exactly six items and creates one true quoted door", () => {
    assert.equal(migration.changed, true);
    assert.deepEqual(migration.changedItemIds, changedIds);
    assert.deepEqual([migration.addedItems, migration.addedProducts,
        migration.deltaTWD], [1, 0, 3500]);
    assert.deepEqual(migration.state.undo, snapshot(before));
    assert.deepEqual({ ...migration.state, undo: null }, sample);
    assert.deepEqual(migration.state.rooms, before.rooms);
    assert.deepEqual(migration.state.products, before.products);
    assert.deepEqual(migration.state.items.filter((entry) =>
        !changedIds.includes(entry.id)),
    before.items.filter((entry) => !changedIds.includes(entry.id)));
    assert.equal(item(sample, "door-main-bath-master").doorMaterial, "solid-wood");
    assert.equal(item(sample, "door-main-bath-master").unitPrice, 14000);
    assert.equal(item(sample, "door-main-bath-hall").doorOpeningKind, "swing");
    assert.deepEqual(item(sample, "door-main-shower"),
        item(before, "door-main-shower"));
    assert.equal(item(sample, "door-balcony").unitPrice, null);
    assert.equal(item(sample, "door-balcony").doorOpeningKind, "slide");
    assert.equal(item(sample, "door-balcony").quotedUnitPrice, 0);
    const studio = item(sample, "door-bedroom-3-studio");
    assert.deepEqual([
        studio.doorMaterial, studio.unitPrice, studio.quotedUnitPrice,
        studio.productId, studio.placement, studio.widthCm,
    ], ["wood-slide", 19000, 19000, null, null, null]);
    assert.deepEqual([
        item(sample, "track-main-bath-hall").roomId,
        item(sample, "track-main-bath-hall").trackDoorId,
    ], ["bedroom-2", "bedroom-2"]);
    assert.equal(sample.items.filter((entry) =>
        entry.trackDoorId === "main-bath-hall").length, 0);
    assert.equal(migrateDoorAllocation(sample).changed, false);
    const ownerEdits = structuredClone(sample);
    item(ownerEdits, "door-balcony").note += " 新增丈量待核。";
    assert.deepEqual(migrateDoorAllocation(ownerEdits).state, ownerEdits);
});

test("reject owner-changed sources, partial tags and tampered quoted door or rail baselines", () => {
    for (const edit of [
        (state) => { item(state, "door-balcony").unitPrice = 20000; },
        (state) => { item(state, "door-balcony").note += "使用者編輯"; },
        (state) => { item(state, "door-main-bath-master").doorMaterial = "custom"; },
        (state) => { item(state, "door-main-bath-hall").doorOpeningKind = "swing"; },
        (state) => { item(state, "track-main-bath-hall").quantity = 1; },
        (state) => { state.items = state.items.filter((entry) =>
            entry.id !== "door-balcony"); },
        (state) => { item(state, "door-balcony").doorQuoteAllocation = 1; },
        (state) => { state.items.push(structuredClone(
            item(sample, "door-bedroom-3-studio"))); },
    ]) {
        const changed = structuredClone(before);
        edit(changed);
        const prior = structuredClone(changed);
        assert.throws(() => migrateDoorAllocation(changed));
        assert.deepEqual(changed, prior);
    }
    for (const edit of [
        (state) => { delete item(state, "door-balcony").doorQuoteAllocation; },
        (state) => { item(state, "door-balcony").quotedUnitPrice = 19000; },
        (state) => {
            item(state, "door-main-bath-master").quotedUnitPrice = 10500;
        },
        (state) => { item(state, "track-main-bath-hall").trackDoorId =
            "main-bath-hall"; },
        (state) => { item(state, "track-main-bath-hall").quotedQuantity = 1; },
    ]) {
        const state = structuredClone(sample);
        edit(state);
        assert.throws(() => validateState(state),
            (error) => error instanceof StoreError && error.status === 400);
    }
});

test("two historical 0.8m rail allowances are never refunded or charged twice", () => {
    const plan = structuredClone(sample);
    const rail = item(plan, "track-main-bath-hall");
    assert.equal(itemSubtotal(rail, plan.items), 1440);
    assert.equal(itemSubtotal(item(plan, "track-bedroom-3-studio"),
        plan.items), 1440);
    item(plan, "door-bedroom-2").doorOpeningKind = "swing";
    assert.equal(itemSubtotal(rail, plan.items), 1440);
    rail.quantity = .4;
    assert.equal(itemSubtotal(rail, plan.items), 1440);
    rail.quantity = 1;
    assert.equal(itemSubtotal(rail, plan.items), 1800);
    assert.equal(unquotedTrackCost(item(sample, "door-balcony"),
        sample.items), 0);
    assert.equal(itemSubtotal(item(sample, "door-balcony"),
        sample.items), null);
});

test("public quote, CSV and both vector views show the new attribution and three main-bath doors", () => {
    const studio = item(sample, "door-bedroom-3-studio");
    const studioSource = markerQuoteProvenance(studio, sample.items);
    assert.match(studioSource, /主浴.工作室/);
    assert.match(studioSource, /可能重複/);
    assert.match(studioSource, /並非第三組/);
    assert.match(quoteProvenance(item(sample, "door-balcony")),
        /未計算，非免費/);
    const csv = itemListCsv(sample);
    assert(csv.includes("歷史報價與歸屬說明"));
    for (const id of ["bedroom-3-studio", "bedroom-2", "main-bath-hall"]) {
        assert(csv.includes(id));
    }
    assert(csv.includes('"未計算"'));
    assert(csv.includes("主浴.工作室"));
    const overview = renderOverviewPlan(sample.rooms, sample.items);
    assert.match(overview, /door-pending-label[^>]*>未計算/);
    assert.match(overview, /data-plan-door-id="main-bath-hall"/);
    assert.match(overview, /data-plan-door-id="bedroom-3-studio"/);
    const bathRoom = sample.rooms.find((room) => room.id === "bath-main");
    const mainBathSvg = renderRoomPlan(bathRoom, sample.items.filter(
        (entry) => entry.roomId === bathRoom.id), null, sample.items);
    assert.deepEqual([...mainBathSvg.matchAll(
        /data-plan-door-id="(main-bath-master|main-bath-hall|main-shower)"/g)]
        .map((match) => match[1]).sort(),
    ["main-bath-hall", "main-bath-master", "main-shower"].sort());
    const old = renderOverviewPlan(before.rooms, before.items);
    assert.match(old, /class="plan-door-mark\s+slide\s+unpriced\s+material-unquoted"[\s\S]*?data-plan-door-id="bedroom-3-studio"/);
    assert(!old.includes("door-pending-label"));
    for (const view of ["outlet-sheet", "lighting-sheet"]) {
        const sheet = renderElectricalSheet(sample, view);
        assert(sheet.includes('data-plan-door-id="bedroom-3-studio"'));
        assert(sheet.includes("未計算"));
    }
    assert(!/<(?:image|foreignObject)\b/i.test(overview));
});

test("JSON container7 holds current or Undo attribution; old door state remains v5/container5 or control6", () => {
    assert.equal(JSON.parse(encodeSave(sample)).formatVersion, 7);
    assert.deepEqual(decodeSave(encodeSave(sample)),
        { ...snapshot(sample), undo: null });
    const undoOnly = { ...structuredClone(before), undo: snapshot(sample) };
    assert.equal(JSON.parse(encodeSave(undoOnly)).formatVersion, 7);
    assert.deepEqual(decodeSave(encodeSave(undoOnly)).undo, undoOnly.undo);
    assert.equal(JSON.parse(encodeSave(before)).formatVersion, 5);
    const mappedPrior = structuredClone(before);
    item(mappedPrior, "quoted-switch-01").controlledLightIds =
        ["corridor-track-lighting"];
    assert.equal(JSON.parse(encodeSave(mappedPrior)).formatVersion, 6);
    assert.throws(() => decodeSave(JSON.stringify({
        ...JSON.parse(encodeSave(sample)),
        state: before,
    })), /完整門片欄位/);
    assert.throws(() => decodeSave(JSON.stringify({
        ...JSON.parse(encodeSave(sample)),
        state: { ...sample, version: 4 },
    })), /v5 資料/);
});

test("temporary store requires both capabilities and preserves old doors through Undo", async () => {
    const directory = await mkdtemp(join(tmpdir(), "public-door-allocation-"));
    try {
        const file = join(directory, "state.json");
        const linked = structuredClone(before);
        item(linked, "quoted-switch-01").controlledLightIds =
            ["corridor-track-lighting"];
        await writeFile(file, JSON.stringify(linked));
        const store = createStore(file);
        const latest = await store.read();
        const proposed = migrateDoorAllocation(latest).state;
        await assert.rejects(() => store.update(latest.revision, proposed),
            (error) => error instanceof StoreError &&
                error.status === 400 && /舊版/.test(error.message));
        const saved = await store.update(latest.revision, {
            ...proposed, controlRelationsVersion: 1, doorAllocationVersion: 1,
        });
        assert.deepEqual(snapshot(saved), snapshot(proposed));
        assert.deepEqual(saved.undo, snapshot(latest));
        await assert.rejects(() => store.update(latest.revision, {
            ...proposed, controlRelationsVersion: 1, doorAllocationVersion: 1,
        }), (error) => error instanceof StoreError && error.status === 409);
        const bytes = await readFile(file, "utf8");
        await assert.rejects(() => store.update(saved.revision, {
            ...latest, controlRelationsVersion: 1,
        }), (error) => error instanceof StoreError &&
            error.status === 400 && /舊版/.test(error.message));
        assert.equal(await readFile(file, "utf8"), bytes);
        const restored = await store.update(saved.revision, {
            version: 5, ...saved.undo, undo: null,
            controlRelationsVersion: 1, doorAllocationVersion: 1,
        });
        assert.deepEqual(snapshot(restored), snapshot(latest));
        assert.equal(total(restored), total(latest));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
    assert.equal(await readFile(path, "utf8"), raw);
});
