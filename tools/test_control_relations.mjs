import assert from "node:assert/strict";
import { readFile, writeFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
    validateState, summarize, createStore, StoreError,
} from "../extensions/renovation-equipment/state.mjs";
import {
    CONTROL_RELATIONS_VERSION, guardControlRelationsUpdate,
    hasControlRelations, previewCircuitLinks, previewControlledLights,
    validateControlRelations,
} from "../extensions/renovation-equipment/assets/circuit-preview.js";
import { renderOverviewPlan } from "../extensions/renovation-equipment/assets/floorplan.js";
import { renderElectricalSheet } from
    "../extensions/renovation-equipment/assets/electrical-sheets.js";
import {
    decodeSave, encodeSave, itemListCsv,
} from "../extensions/renovation-equipment/assets/file-actions.js";
import {
    createQuotedOutletItems, isDedicatedCircuit, isSocket,
} from "../extensions/renovation-equipment/assets/socket-plan.js";
import { ROBOT_ID } from
    "../extensions/renovation-equipment/assets/robot-plan.js";

const path = new URL("../files/設備規劃.json", import.meta.url);
const raw = await readFile(path, "utf8");
const publicSample = JSON.parse(raw);
const baseline = validateState(publicSample);
const item = (state, id) => state.items.find((entry) => entry.id === id);
const snapshot = (state) => structuredClone({
    rooms: state.rooms, items: state.items, products: state.products,
});
const firstSwitch = "quoted-switch-01";
const secondSwitch = "quoted-switch-02";
const track = "corridor-track-lighting";
const ceiling = "living-ceiling-light-01";
const capabilities = {
    controlRelationsVersion: CONTROL_RELATIONS_VERSION,
    doorAllocationVersion: 1,
    robotFeatureVersion: 1,
};

function assigned() {
    const state = structuredClone(baseline);
    item(state, firstSwitch).controlledLightIds = [track, ceiling];
    item(state, secondSwitch).controlledLightIds = [ceiling];
    state.undo = snapshot(baseline);
    return state;
}

test("anonymous v5 sample remains untouched, with no inferred same-room or cross-room links", () => {
    assert.deepEqual([publicSample.version, publicSample.revision,
        publicSample.undo, publicSample.rooms.length, publicSample.items.length,
        publicSample.products.length], [5, 0, null, 13, 182, 28]);
    assert.equal(baseline.products.find((product) =>
        product.id === "sample-product-08").trackLengthCm, 150);
    assert.deepEqual(baseline.items, publicSample.items);
    assert.deepEqual(baseline.rooms, publicSample.rooms);
    assert.equal(publicSample.items.filter((entry) =>
        entry.switchType && entry.switchPlanStatus === "active").length, 14);
    assert.equal(publicSample.items.filter((entry) =>
        entry.switchType && entry.switchPlanStatus === "removed").length, 2);
    assert.equal(publicSample.items.some((entry) =>
        Object.hasOwn(entry, "controlledLightIds")), false);
    for (const switchItem of baseline.items.filter((entry) => entry.switchType)) {
        assert.deepEqual(previewControlledLights(switchItem, baseline.items), []);
    }
    assert.deepEqual(previewCircuitLinks(baseline.items), []);
    assert.equal(hasControlRelations(baseline), false);
    assert.equal(JSON.parse(encodeSave(baseline)).formatVersion, 8);
    assert.doesNotMatch(renderOverviewPlan(baseline.rooms, baseline.items, false,
        new Set()), /data-preview-light-id=/);
    const lighting = renderElectricalSheet(baseline, "lighting-sheet");
    assert.doesNotMatch(lighting, /data-control-light-id=/);
    assert.match(lighting, /尚未設定對應 14/);
    assert.equal((lighting.match(/data-sheet-switch=/g) ?? []).length, 14);
    assert.equal(summarize(baseline).overallTotals.TWD, 2_322_060.2);
});

test("explicit whole-panel many-to-many mapping drives sheets and preview, including track group", () => {
    const state = validateState(assigned());
    assert.deepEqual(previewControlledLights(item(state, firstSwitch), state.items)
        .map((entry) => entry.id).sort(), [track, ceiling].sort());
    assert.equal(previewCircuitLinks(state.items).length, 3);
    assert.equal(item(state, track).spotlightQuantity, 4);
    const sheet = renderElectricalSheet(state, "lighting-sheet", firstSwitch);
    assert.equal((sheet.match(/data-control-light-id=/g) ?? []).length, 3);
    assert.match(sheet, /屋主指定對應待電工核／非實際配管走線／非施工圖/);
    assert.match(sheet, /整個開關面板（含雙開關，不區分左右鍵）/);
    assert.equal((renderOverviewPlan(state.rooms, state.items, false, new Set())
        .match(/data-preview-light-id=/g) ?? []).length, 3);
    const moved = structuredClone(state);
    item(moved, firstSwitch).roomId = "master";
    item(moved, firstSwitch).placement = { x: .2, y: .3 };
    assert.deepEqual(item(validateState(moved), firstSwitch).controlledLightIds,
        [track, ceiling]);
    assert.notEqual(renderElectricalSheet(moved, "lighting-sheet"), sheet);
    assert.deepEqual(summarize(state), summarize(baseline));
    assert.deepEqual(state.rooms, baseline.rooms);
    assert.deepEqual(state.products, baseline.products);
    assert.deepEqual(state.items.filter((entry) =>
        ![firstSwitch, secondSwitch].includes(entry.id)),
    baseline.items.filter((entry) =>
        ![firstSwitch, secondSwitch].includes(entry.id)));
});

test("reject malformed, orphaned, removed or unplaced controls without mutating candidates", () => {
    for (const mutation of [
        (state) => { item(state, firstSwitch).controlledLightIds = [track, track]; },
        (state) => { item(state, firstSwitch).controlledLightIds = null; },
        (state) => { item(state, firstSwitch).controlledLightIds = "all"; },
        (state) => { item(state, firstSwitch).controlledLightIds = ["unknown"]; },
        (state) => { item(state, firstSwitch).controlledLightIds = [secondSwitch]; },
        (state) => { item(state, firstSwitch).controlledLightIds = [17]; },
        (state) => { item(state, ceiling).controlledLightIds = []; },
        (state) => {
            item(state, firstSwitch).switchPlanStatus = "removed";
            item(state, firstSwitch).quantity = 0;
        },
        (state) => { item(state, firstSwitch).placement = null; },
        (state) => { item(state, track).placement = null; },
        (state) => { item(state, track).spotlightQuantity = 0; },
        (state) => { state.items = state.items.filter((entry) => entry.id !== ceiling); },
        (state) => { item(state.undo, firstSwitch).controlledLightIds = ["unknown"]; },
    ]) {
        const candidate = assigned();
        mutation(candidate);
        const before = structuredClone(candidate);
        assert.throws(() => validateState(candidate),
            (error) => error instanceof StoreError && error.status === 400);
        assert.deepEqual(candidate, before);
    }
    const stale = assigned();
    stale.items = stale.items.filter((entry) => entry.id !== ceiling);
    assert.equal(previewCircuitLinks(stale.items).length, 1);
    item(stale, firstSwitch).switchPlanStatus = "removed";
    assert.equal(previewCircuitLinks(stale.items).length, 0);
    stale.items = stale.items.filter((entry) => entry.id !== firstSwitch);
    assert.equal(previewCircuitLinks(stale.items).length, 0);
});

test("container 8 retains controls with robot and door attribution; older exports stay readable", () => {
    const state = assigned();
    const document = JSON.parse(encodeSave(state));
    assert.equal(document.formatVersion, 8);
    assert.equal(document.state.version, 5);
    assert.deepEqual(decodeSave(JSON.stringify(document)),
        { ...snapshot(state), undo: state.undo });
    assert.throws(() => decodeSave(JSON.stringify({
        ...document, formatVersion: 6,
        state: { ...document.state, items: baseline.items, undo: null },
    })), /完整對應欄位/);
    assert.throws(() => decodeSave(JSON.stringify({
        ...document, formatVersion: 6,
        state: { ...document.state, version: 4 },
    })), /v5 資料/);
    const undoOnly = structuredClone(baseline);
    undoOnly.undo = snapshot(state);
    assert.equal(JSON.parse(encodeSave(undoOnly)).formatVersion, 8);
    assert.deepEqual(decodeSave(encodeSave(undoOnly)).undo, undoOnly.undo);
    assert.equal(JSON.parse(encodeSave(baseline)).formatVersion, 8);
    const priorDoorState = structuredClone(baseline);
    priorDoorState.items = priorDoorState.items.filter((entry) =>
        entry.id !== ROBOT_ID);
    assert.equal(JSON.parse(encodeSave(priorDoorState)).formatVersion, 7);
    assert.deepEqual(decodeSave(encodeSave(baseline)),
        { ...snapshot(baseline), undo: null });
    for (const version of [2, 3, 4, 5]) {
        const legacy = { ...structuredClone(baseline), version, undo: null };
        assert.doesNotThrow(() => decodeSave(JSON.stringify(legacy)));
    }
    const outlet = createQuotedOutletItems().find((entry) =>
        entry.id === "outlet-kitchen-ih");
    const legacy1 = {
        version: 1, revision: 0,
        rooms: [{ id: "kitchen", name: "廚房" }],
        items: [{ ...outlet, outletCircuit: "dedicated",
            unitPrice: 6300, quotedUnitPrice: 6300 }],
        products: [], undo: null,
    };
    const upgraded1 = validateState({
        version: 5, revision: 0, updatedAt: baseline.updatedAt,
        ...decodeSave(JSON.stringify(legacy1)),
    });
    assert.equal(upgraded1.items.filter(isSocket).length, 1);
    assert.equal(upgraded1.items.filter(isDedicatedCircuit).length, 1);
    assert.deepEqual(previewCircuitLinks(upgraded1.items), []);
    const csv = itemListCsv(state);
    assert(csv.includes("面板對應燈具ID"));
    assert(csv.includes(`${track} | ${ceiling}`));
    assert(csv.includes("屋主指定對應待電工核"));
    assert(csv.includes("尚未設定對應"));
});

test("guarded store rejects old writer or orphan, supports clearing and one complete Undo", async () => {
    const directory = await mkdtemp(join(tmpdir(), "public-controls-"));
    const file = join(directory, "copy.json");
    try {
        await writeFile(file, raw);
        const store = createStore(file);
        const latest = await store.read();
        const candidate = structuredClone(latest);
        item(candidate, firstSwitch).controlledLightIds = [track, ceiling];
        item(candidate, secondSwitch).controlledLightIds = [ceiling];
        candidate.undo = snapshot(latest);
        const saved = await store.update(latest.revision, {
            ...candidate, ...capabilities,
        });
        assert.deepEqual(saved.undo, snapshot(latest));
        assert.deepEqual(snapshot(saved), snapshot(candidate));
        await assert.rejects(() => store.update(latest.revision, candidate),
            (error) => error instanceof StoreError && error.status === 409);
        const oldWriter = structuredClone(saved);
        for (const entry of oldWriter.items) delete entry.controlledLightIds;
        const bytes = await readFile(file, "utf8");
        await assert.rejects(() => store.update(saved.revision, oldWriter),
            (error) => error instanceof StoreError && error.status === 400 &&
                /舊版/.test(error.message));
        assert.equal(await readFile(file, "utf8"), bytes);
        const orphan = structuredClone(saved);
        orphan.items = orphan.items.filter((entry) => entry.id !== ceiling);
        await assert.rejects(() => store.update(saved.revision, {
            ...orphan, ...capabilities,
        }), (error) => error instanceof StoreError && error.status === 400 &&
            /不存在/.test(error.message));
        assert.equal(await readFile(file, "utf8"), bytes);
        const cleared = structuredClone(saved);
        for (const id of [firstSwitch, secondSwitch]) {
            item(cleared, id).controlledLightIds = [];
        }
        cleared.undo = snapshot(saved);
        const next = await store.update(saved.revision, {
            ...cleared, ...capabilities,
        });
        assert.equal(previewCircuitLinks(next.items).length, 0);
        const restored = await store.update(next.revision, {
            version: 5, ...next.undo, undo: null, ...capabilities,
        });
        assert.deepEqual(snapshot(restored), snapshot(saved));
        assert.equal(previewCircuitLinks(restored.items).length, 3);
        assert.throws(() => guardControlRelationsUpdate(next, oldWriter), /舊版/);
        assert.throws(() => guardControlRelationsUpdate(
            { ...baseline, undo: snapshot(saved) }, oldWriter), /舊版/);
        assert.doesNotThrow(() => validateControlRelations(restored.items));
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
    assert.equal(await readFile(path, "utf8"), raw);
});
