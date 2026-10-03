import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
    GUEST_BATH_TARGET_IDS, GUEST_BATH_TARGET_TAG,
    isUnknownDepthGuestTub, migrateGuestBathTarget,
} from "../extensions/renovation-equipment/assets/guest-bath-plan.js";
import {
    guestVanityAssessment, itemFootprint, renderOverviewPlan,
    renderRoomPlan, roomGeometry,
} from "../extensions/renovation-equipment/assets/floorplan.js";
import { applyProductToItem } from "../extensions/renovation-equipment/assets/product-database.js";
import { validateState, summarize } from "../extensions/renovation-equipment/state.mjs";
import {
    decodeSave, encodeSave, itemListCsv,
} from "../extensions/renovation-equipment/assets/file-actions.js";

const state = JSON.parse(await readFile(
    new URL("../files/設備規劃.json", import.meta.url), "utf8"));
const byId = (document, id) => document.items.find((item) => item.id === id);

function legacyPublicBathFixture() {
    const previous = structuredClone(state);
    const oldTub = previous.products.find((item) =>
        item.id === "sample-product-03");
    const tub = applyProductToItem(oldTub, byId(previous, "bath-guest-tub"));
    Object.assign(tub, {
        name: "浴缸", widthCm: 110, depthCm: 70, heightCm: null,
        orientation: 270, placement: { x: .202, y: .382 },
        note: "舊匿名示例的110cm浴缸；改管與施工待現勘。",
    });
    previous.items = previous.items.map((item) =>
        item.id === tub.id ? tub : item);
    for (const room of ["bath-main", "bath-guest"]) {
        const vanity = byId(previous, `${room}-vanity`);
        vanity.widthCm = 60;
        vanity.depthCm = 35;
        vanity.note = "舊匿名示例浴櫃暫位，型號及管線待核。";
    }
    byId(previous, "bath-guest-vanity").placement = { x: .474, y: .157 };
    validateState(previous);
    return previous;
}

test("public sample has a single unpriced 80cm guest tub and orphaned OVO catalog", () => {
    validateState(state);
    assert.deepEqual([state.version, state.revision, state.undo,
        state.rooms.length, state.items.length, state.products.length],
    [5, 0, null, 13, 182, 28]);
    const tub = byId(state, "bath-guest-tub");
    assert.deepEqual([tub.name, tub.brandModel, tub.productId,
        tub.unitPrice, tub.widthCm, tub.depthCm, tub.heightCm,
        tub.orientation, tub.installationUnitPrice],
    ["坐式浴缸（80cm條件目標）", "", null, null, 80, null, null, 0, 0]);
    assert.equal(isUnknownDepthGuestTub(tub), true);
    assert.equal(state.products.find((item) =>
        item.id === "sample-product-03").unitPrice, 26936);
    assert(state.items.every((item) => item.productId !== "sample-product-03"));
    for (const id of GUEST_BATH_TARGET_IDS) {
        assert(byId(state, id).note.includes(GUEST_BATH_TARGET_TAG));
        assert.equal(byId(state, id).installationUnitPrice, 0);
    }
    assert.equal(byId(state, "bath-main-vanity").depthCm, 47);
    assert.equal(byId(state, "bath-guest-vanity").depthCm, 47);
    assert.deepEqual(byId(state, "bath-guest-vanity").placement,
        { x: 111.41 / 205, y: .157 });
    assert.equal(summarize(state).originalQuoteTWD, 1_959_530);
    assert.equal(summarize(state).overallTotals.TWD, 2_333_060.2);
    assert.deepEqual(migrateGuestBathTarget(state), {
        state, changed: false, changedItemIds: [],
    });
});

test("guarded conversion from prior anonymous selection touches only three fixtures", () => {
    const previous = legacyPublicBathFixture();
    const before = structuredClone(previous);
    const result = migrateGuestBathTarget(previous);
    const after = result.state;
    assert(result.changed);
    assert.deepEqual(result.changedItemIds, [...GUEST_BATH_TARGET_IDS]);
    assert.deepEqual(previous, before);
    validateState(after);
    assert.deepEqual(after.rooms, previous.rooms);
    assert.deepEqual(after.products, previous.products);
    assert.deepEqual(after.items.filter((item) =>
        !GUEST_BATH_TARGET_IDS.includes(item.id)), previous.items.filter((item) =>
        !GUEST_BATH_TARGET_IDS.includes(item.id)));
    assert.deepEqual(after.undo, {
        rooms: previous.rooms, items: previous.items, products: previous.products,
    });
    assert.equal(summarize(after).overallTotals.TWD -
        summarize(previous).overallTotals.TWD, -26_936);
    assert.equal(result.guestVanityCenterXCm, 111.41);
    assert.deepEqual(byId(after, "bath-guest-tub").placement,
        byId(previous, "bath-guest-tub").placement);
    assert.equal(byId(after, "bath-main-vanity").placement.x,
        byId(previous, "bath-main-vanity").placement.x);
    assert.deepEqual(migrateGuestBathTarget(after), {
        state: after, changed: false, changedItemIds: [],
    });
    const restored = decodeSave(encodeSave(after));
    assert.deepEqual(restored.items, after.items);
    assert.deepEqual(restored.undo, after.undo);
    const row = itemListCsv(after).split("\r\n")
        .find((line) => line.includes("坐式浴缸（80cm條件目標）"));
    assert(row?.includes("待補") && !row.includes("26936"));
});

test("unknown depth is a dashed horizontal band, never a verified footprint", () => {
    const room = state.rooms.find((entry) => entry.id === "bath-guest");
    const geometry = roomGeometry(room);
    const tub = byId(state, "bath-guest-tub");
    const footprint = itemFootprint(tub, geometry);
    assert.equal(footprint.width, 80 * geometry.cmScale);
    assert.equal(footprint.height, 28);
    const report = guestVanityAssessment(state.items, geometry);
    assert(report.incomplete && report.tubDepthUnknown);
    assert.match(report.warning, /浴缸深度／高度未定/);
    assert.match(report.warning, /無法判定浴缸完整占地/);
    assert(!report.warning.includes("未見這兩個圖示的占地重疊"));
    const rotated = structuredClone(state);
    byId(rotated, tub.id).orientation = 90;
    const rotatedReport = guestVanityAssessment(rotated.items, geometry);
    assert.equal(rotatedReport.incomplete, true);
    assert.match(rotatedReport.warning, /深度／淨距未定/);
    for (const svg of [
        renderRoomPlan(room, state.items.filter((item) =>
            item.roomId === room.id), null, state.items),
        renderOverviewPlan(state.rooms, state.items),
    ]) {
        assert.match(svg, /data-tub-depth="unknown"/);
        assert.match(svg, /80cm區段/);
        assert.match(svg, /深度未定/);
        assert(!/undefined|NaN|<image|data:image/.test(svg));
    }
});

test("conflicted or partial old choices abort without mutating the input", () => {
    for (const mutation of [
        (state) => { byId(state, "bath-guest-tub").unitPrice = 26000; },
        (state) => { byId(state, "bath-guest-vanity").placement.x = .5; },
        (state) => { byId(state, "bath-main-vanity").depthCm = 48; },
        (state) => { byId(state, "bath-guest-tub").note += GUEST_BATH_TARGET_TAG; },
        (state) => { state.items = state.items.filter((item) =>
            item.id !== "bath-guest-tub"); },
    ]) {
        const conflict = legacyPublicBathFixture();
        mutation(conflict);
        const before = structuredClone(conflict);
        assert.throws(() => migrateGuestBathTarget(conflict), /不同|部分|缺漏/);
        assert.deepEqual(conflict, before);
    }
});
