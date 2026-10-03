import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
    migrateRobotPlan, robotProvisionalPosition,
} from "../extensions/renovation-equipment/robot-migration.mjs";
import {
    guardRobotPlanUpdate, ROBOT_ID, ROBOT_TAG,
} from "../extensions/renovation-equipment/assets/robot-plan.js";
import {
    createStore, StoreError, summarize, validateState,
} from "../extensions/renovation-equipment/state.mjs";
import {
    calculateBudget, itemSubtotal, ORIGINAL_QUOTE_TWD,
} from "../extensions/renovation-equipment/assets/budget.js";
import {
    decodeSave, encodeSave, itemListCsv,
} from "../extensions/renovation-equipment/assets/file-actions.js";
import {
    renderOverviewPlan, renderRoomPlan, roomGeometry, markerPosition,
    placementFootprint,
} from "../extensions/renovation-equipment/assets/floorplan.js";
import {
    electricalSheetData, renderElectricalSheet,
} from "../extensions/renovation-equipment/assets/electrical-sheets.js";
import {
    previewCircuitLinks,
} from "../extensions/renovation-equipment/assets/circuit-preview.js";

const file = new URL("../files/設備規劃.json", import.meta.url);
const raw = await readFile(file, "utf8");
const currentSample = JSON.parse(raw);
const sample = structuredClone(currentSample);
delete sample.managementCleaningFee;
delete sample.constructionCalendar;
const before = structuredClone(sample);
before.items = before.items.filter((item) => item.id !== ROBOT_ID);
const snapshot = (state) => structuredClone({
    rooms: state.rooms, items: state.items, products: state.products,
});
const one = (state, id = ROBOT_ID) =>
    state.items.find((item) => item.id === id);
const total = (state) => summarize(state).overallTotals.TWD;
const capabilities = {
    controlRelationsVersion: 1, doorAllocationVersion: 1,
    robotFeatureVersion: 1,
};
const count = (text, regex) => [...text.matchAll(regex)].length;

test("public robot release adds only one unknown-price item to the reviewed door sample", () => {
    assert.equal(currentSample.constructionCalendar.events.length, 13);
    assert.equal(createHash("sha256").update(
        JSON.stringify(sample, null, 2) + "\n").digest("hex"),
        "b1c8a5dcd2a768acae1e99606a65caad44c53927fab5899053d44b84e685ffcc");
    assert.equal(createHash("sha256").update(
        JSON.stringify(before, null, 2) + "\n").digest("hex"),
    "a427936df43e0ec5b487002306951b33a99c9d2497a265970f7a227f9edc33dd");
    assert.deepEqual([
        sample.version, sample.revision, sample.undo,
        sample.rooms.length, sample.items.length, sample.products.length,
    ], [5, 0, null, 13, 182, 28]);
    const migrated = migrateRobotPlan(before);
    assert.deepEqual([
        migrated.changed, migrated.addedItems, migrated.addedProducts,
        migrated.changedItemIds, migrated.deltaTWD,
    ], [true, 1, 0, [ROBOT_ID], 0]);
    assert.deepEqual(migrated.state.undo, snapshot(before));
    assert.deepEqual({ ...migrated.state, undo: null }, sample);
    assert.deepEqual(sample.items.slice(0, -1), before.items);
    assert.deepEqual(sample.rooms, before.rooms);
    assert.deepEqual(sample.products, before.products);
    const robot = one(sample);
    assert.equal(robot.kind, "equipment");
    assert.equal(robot.roomId, "living-dining");
    assert.equal(robot.quantity, 1);
    assert(robot.note.includes(ROBOT_TAG));
    for (const key of [
        "brandModel", "productId", "unitPrice", "installationUnitPrice",
        "widthCm", "depthCm", "heightCm",
        "outletCircuit", "circuitOutletId", "equipmentType",
        "equipmentCategory", "markerStyle",
    ]) {
        assert.equal(robot[key], null, key);
    }
    assert.equal(robot.outletPlanPointId, undefined);
    assert.equal(itemSubtotal(robot, sample.items), null);
    assert(robot.note.includes("非施工"));
    assert(robot.note.includes("防回流"));
    assert(robot.note.includes("不可視為免費"));
    assert.equal(ORIGINAL_QUOTE_TWD, 1_959_530);
    assert.equal(total(before), 2_322_060.2);
    assert.equal(total(sample), total(before));
    assert.equal(calculateBudget(sample.items).quotedDoorTotal, 114_500);
    assert.equal(sample.items.filter((item) => item.trackDoorId).reduce(
        (sum, item) => sum +
            item.quotedQuantity * item.quotedUnitPrice, 0), 2_880);
    assert.deepEqual(
        ["R", "B", "C"].map((prefix) => sample.items.filter((item) =>
            item.outletPlanPointId?.startsWith(prefix)).length),
        [51, 9, 7],
    );
    assert.deepEqual([
        sample.items.filter((item) => item.lightType && item.placement).length,
        sample.items.filter((item) => item.switchType &&
            item.switchPlanStatus === "active").length,
        sample.items.filter((item) => item.switchType &&
            item.switchPlanStatus === "removed").length,
    ], [16, 14, 2]);
    assert.deepEqual(previewCircuitLinks(sample.items), []);
});

test("symbol is on living side of the bath door, not measured clearance or new wiring", () => {
    const robot = one(sample);
    const room = sample.rooms.find((entry) => entry.id === "living-dining");
    const geometry = roomGeometry(room);
    const center = markerPosition(robot, geometry);
    assert.deepEqual(robot.placement, robotProvisionalPosition(before));
    assert(Math.abs(center.x - 535) < .001);
    assert(Math.abs(center.y - 850) < .001);
    assert(center.x + 12 < 569 && center.y - 12 > 815);
    assert.deepEqual(placementFootprint(robot, geometry),
        { width: 24, height: 24 });
    const overview = renderOverviewPlan(sample.rooms, sample.items);
    assert.equal(count(overview, /data-robot-id=/g), 1);
    assert.match(overview, /掃拖機器人/);
    assert.match(overview, /圖示不是實機占地/);
    assert.doesNotMatch(overview, /<image\b|data:image\/|<foreignObject\b/i);
    const roomSvg = renderRoomPlan(room, sample.items.filter((item) =>
        item.roomId === room.id), ROBOT_ID, sample.items);
    assert.match(roomSvg, new RegExp(`data-marker-id="${ROBOT_ID}"`));
    assert.match(roomSvg, /robot-symbol/);
    assert.match(roomSvg, /自動上下水（暫位）/);
    assert.match(roomSvg, /門扇、逃生/);
});

test("both vector-only sheets show saved robot context without extra endpoints or loops", () => {
    const original = electricalSheetData(before);
    const current = electricalSheetData(sample);
    for (const key of [
        "endpoints", "lights", "activeSwitches", "removedSwitches",
    ]) {
        assert.deepEqual(current[key], original[key]);
    }
    for (const view of ["outlet-sheet", "lighting-sheet"]) {
        const html = renderElectricalSheet(sample, view);
        assert.equal(count(html, new RegExp(
            `data-sheet-context="${ROBOT_ID}"`, "g")), 1);
        assert.equal(count(html, /data-sheet-context=/g), 4);
        assert.equal(count(html, /data-sheet-point=/g),
            view === "outlet-sheet" ? 67 : 0);
        assert.equal(count(html, /data-sheet-light=/g),
            view === "lighting-sheet" ? 16 : 0);
        assert.equal(count(html, /data-control-light-id=/g), 0);
        assert.match(html, /逃生淨空、給排水/);
        assert.doesNotMatch(html, new RegExp(`data-marker-id="${ROBOT_ID}"`));
        assert.doesNotMatch(renderElectricalSheet(before, view),
            /data-robot-legend|data-robot-warning|robot-symbol/);
    }
    const moved = structuredClone(sample);
    one(moved).placement = null;
    for (const view of ["outlet-sheet", "lighting-sheet"]) {
        assert.doesNotMatch(renderElectricalSheet(moved, view),
            new RegExp(`data-sheet-context="${ROBOT_ID}"`));
    }
});

test("v5 export uses container 8 for current or Undo robot, legacy 7 stays readable", () => {
    const encoded = JSON.parse(encodeSave(sample));
    assert.equal(encoded.formatVersion, 8);
    assert.deepEqual(decodeSave(JSON.stringify(encoded)),
        { ...snapshot(sample), undo: null });
    const undoOnly = { ...structuredClone(before), undo: snapshot(sample) };
    assert.equal(JSON.parse(encodeSave(undoOnly)).formatVersion, 8);
    assert.deepEqual(decodeSave(encodeSave(undoOnly)).undo, undoOnly.undo);
    assert.equal(JSON.parse(encodeSave(before)).formatVersion, 7);
    assert.deepEqual(decodeSave(encodeSave(before)),
        { ...snapshot(before), undo: null });
    assert.throws(() => decodeSave(JSON.stringify({
        ...encoded, state: before,
    })), /完整規劃欄位/);
    assert.throws(() => decodeSave(JSON.stringify({
        ...encoded, state: { ...sample, version: 4 },
    })), /v5 資料/);
    const csv = itemListCsv(sample);
    assert.match(csv, /掃拖機器人／自動上下水/);
    assert.match(csv, /原報未含/);
    assert.match(csv, /防回流/);
    assert.doesNotMatch(csv, /<image\b|data:image\//i);
});

test("guard refuses occupied or already-deleted robot and conflicting dry-side plans", () => {
    for (const modify of [
        (state) => { state.version = 4; },
        (state) => { state.unreviewedField = true; },
        (state) => { state.items.push({ ...one(sample), note: "另一用途" }); },
        (state) => { state.items.push({ ...one(sample), id: "other-robot" }); },
        (state) => { state.undo = snapshot(sample); },
        (state) => { one(state, "door-main-bath-hall").doorOpeningKind = "slide"; },
        (state) => { one(state, "living-refrigerator").placement =
            one(sample).placement; },
        (state) => { state.items.push({ ...one(sample), id: "owner-vacuum",
            note: "" }); },
    ]) {
        const state = structuredClone(before);
        modify(state);
        const prior = structuredClone(state);
        assert.throws(() => migrateRobotPlan(state), undefined, String(modify));
        assert.deepEqual(state, prior);
    }
    const edited = structuredClone(sample);
    one(edited).placement = { x: .85, y: .78 };
    one(edited).brandModel = "使用者日後選款";
    one(edited).unitPrice = 23000;
    const again = migrateRobotPlan(validateState(edited));
    assert.equal(again.changed, false);
    assert.deepEqual(again.state, validateState(edited));
});

test("store needs all capabilities, rejects old writers and keeps complete Undo", async () => {
    const directory = await mkdtemp(join(tmpdir(), "public-robot-"));
    try {
        const path = join(directory, "state.json");
        const mapped = structuredClone(before);
        one(mapped, "quoted-switch-01").controlledLightIds =
            ["corridor-track-lighting"];
        await writeFile(path, JSON.stringify(mapped), "utf8");
        const store = createStore(path);
        const current = await store.read();
        const proposed = migrateRobotPlan(current).state;
        await assert.rejects(() => store.update(current.revision, proposed),
            (error) => error instanceof StoreError &&
                error.status === 400 && /舊版/.test(error.message));
        const saved = await store.update(current.revision, {
            ...proposed, ...capabilities,
        });
        assert.equal(saved.revision, current.revision + 1);
        assert.deepEqual(saved.undo, snapshot(current));
        assert.deepEqual(snapshot(saved), snapshot(proposed));
        const originalBytes = await readFile(path, "utf8");
        await assert.rejects(() => store.update(saved.revision, {
            ...current, ...capabilities, robotFeatureVersion: undefined,
        }), (error) => error instanceof StoreError &&
            error.status === 400 && /掃拖機/.test(error.message));
        assert.equal(await readFile(path, "utf8"), originalBytes);
        const restored = await store.update(saved.revision, {
            version: 5, ...saved.undo, undo: null, ...capabilities,
        });
        assert.deepEqual(snapshot(restored), snapshot(current));
        assert.equal(JSON.parse(encodeSave(restored)).formatVersion, 7);
        assert.throws(() => guardRobotPlanUpdate(
            { ...before, undo: snapshot(sample) },
            { ...before, robotFeatureVersion: undefined },
        ), /掃拖機/);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
    assert.equal(await readFile(file, "utf8"), raw);
});
