import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import {
    electricalSheetData, renderElectricalSheet,
} from "../extensions/renovation-equipment/assets/electrical-sheets.js";
import {
    markerPosition, renderOverviewPlan, roomGeometry,
} from "../extensions/renovation-equipment/assets/floorplan.js";
import { HOUSE_ZONES } from "../extensions/renovation-equipment/assets/house-geometry.js";
import { summarize, validateState } from "../extensions/renovation-equipment/state.mjs";

const path = new URL("../files/設備規劃.json", import.meta.url);
const raw = await readFile(path, "utf8");
const state = validateState(JSON.parse(raw));
const baseline = JSON.stringify(state);
const data = electricalSheetData(state);
const outlet = renderElectricalSheet(state, "outlet-sheet");
const lighting = renderElectricalSheet(state, "lighting-sheet");
const matches = (html, regex) => [...html.matchAll(regex)];

test("exact saved R/B/C endpoints appear once, not duplicated by circuits", () => {
    assert.deepEqual(data.counts, { R: 51, B: 9, C: 7 });
    assert.equal(data.circuits.length, 9);
    const ids = matches(outlet, /data-sheet-point="([^"]+)"/g)
        .map((match) => match[1]);
    assert.equal(ids.length, 67);
    assert.equal(new Set(ids).size, 67);
    for (const [prefix, size] of [["R", 51], ["B", 9], ["C", 7]]) {
        for (let n = 1; n <= size; n++) {
            assert(ids.includes(`${prefix}${String(n).padStart(2, "0")}`));
        }
    }
    for (const id of ["R08", "R33", "R42", "B05"]) {
        const item = data.endpoints.find((entry) =>
            entry.outletPlanPointId === id);
        const point = markerPosition(item, roomGeometry(state.rooms.find(
            (room) => room.id === item.roomId)));
        assert(outlet.includes(`transform="translate(${point.x} ${point.y})"`));
        assert(outlet.includes(`<strong>${id}</strong>`));
    }
    assert.match(outlet, /fixed-balcony-sink/);
    assert.match(outlet, /data-demolition-status="proposed"/);
    assert.match(outlet, /R33.*保留來源位置/);
    assert.match(outlet, /C 是弱電／網路，不是電源/);
    assert.match(outlet, /專用迴路資料 9 筆（不另畫插座）/);
});

test("light heads and active switches follow this public state, never private counts", () => {
    assert.equal(data.placedLights.length, 16);
    assert.equal(data.heads, 19);
    assert.equal(data.activeSwitches.length, 14);
    assert.equal(data.removedSwitches.length, 2);
    assert.equal(data.unknownHeads, 0);
    assert.equal(data.placedLights.filter((item) =>
        item.lightType === "recessed").length, 6);
    assert.equal(data.placedLights.filter((item) =>
        item.lightType === "ceiling" && item.lightWatts === 50).length, 8);
    assert.equal(data.placedLights.filter((item) =>
        item.lightType === "ceiling" && item.lightWatts === 16).length, 1);
    const track = data.placedLights.find((item) => item.lightType === "track");
    assert.deepEqual([track.trackLengthCm, track.spotlightQuantity,
        track.lightWatts], [300, 4, 30]);
    assert.equal(matches(lighting, /data-sheet-light=/g).length, 16);
    assert.equal(matches(lighting, /data-light-head\b/g).length, 19);
    assert.equal(matches(lighting, /data-sheet-switch=/g).length, 14);
    for (const item of data.removedSwitches) {
        assert(!lighting.includes(`data-sheet-switch="${item.id}"`));
    }
    assert.match(lighting, /lm待核／°待核/);
    assert.match(lighting, /控制對象未核/);
    assert.match(lighting, /W 不能推算照度/);
});

test("both sheets reuse only this plan's traced geometry without editing or control routes", () => {
    for (const html of [outlet, lighting]) {
        for (const zone of HOUSE_ZONES.filter((zone) =>
            state.rooms.some((room) => room.id === zone.id))) {
            assert(html.includes(`d="${zone.path}"`), zone.id);
        }
        assert.match(html, /window-opening/);
        assert.match(html, /非施工圖／目前資料版本 v5・r0/);
        assert.doesNotMatch(html,
            /data-select-room|data-select-partition|data-marker-id|data-action=|data-circuit-link-id|data-preview-|lighting-preview|<image/);
        assert(!/undefined|\bNaN\b|1:60|1:6\b/.test(html));
        assert(!html.includes(["session", "state"].join("-")));
        assert(!/<(?:img|image|foreignObject|script)\b|data:image|file:/i.test(html));
    }
    assert.match(renderOverviewPlan(state.rooms, state.items),
        /data-select-room=/, "the editable overview must retain room navigation");
});

test("edits, missing prices and incomplete positions change labels without guessing", () => {
    const changed = structuredClone(state);
    changed.items = changed.items.filter((item) =>
        item.outletPlanPointId !== "R01");
    changed.items.find((item) =>
        item.id === data.activeSwitches[0].id).switchPlanStatus = "removed";
    const track = changed.items.find((item) => item.lightType === "track");
    track.spotlightQuantity = 2;
    track.trackLengthCm = null;
    changed.products = [];
    const next = electricalSheetData(changed);
    assert.deepEqual(next.counts, { R: 50, B: 9, C: 7 });
    assert.equal(next.activeSwitches.length, 13);
    assert.equal(next.removedSwitches.length, 3);
    assert.equal(next.heads, 17);
    const html = renderElectricalSheet(changed, "lighting-sheet");
    assert.match(html, /data-track-length="unknown"/);
    assert.match(html, /已連結商品不存在/);
    assert.match(html, /長度待核/);
    track.spotlightQuantity = null;
    track.placement = null;
    changed.items.find((item) =>
        item.id === data.activeSwitches[1].id).switchPlanStatus = null;
    assert.equal(electricalSheetData(changed).unresolvedSwitches.length, 1);
    assert.match(renderElectricalSheet(changed, "lighting-sheet"), /1 筆缺位置/);
    track.placement = { x: .52, y: .5 };
    assert.match(renderElectricalSheet(changed, "lighting-sheet"), /1 筆頭數未定/);
    for (const view of ["outlet-sheet", "lighting-sheet"]) {
        assert.throws(() => renderElectricalSheet({ version: 5 }, view),
            /完整的 v5/);
    }
    assert.throws(() => renderElectricalSheet(state, "unknown-sheet"),
        /未知的配置圖/);
    assert.throws(() => renderElectricalSheet(
        { ...state, revision: -1 }, "outlet-sheet"), /完整的 v5/);
});

test("rendering and offline bundle leave the exact anonymous quote and sample intact", async () => {
    assert.equal(JSON.stringify(state), baseline);
    assert.equal(state.items.length, 180);
    assert.equal(state.products.length, 28);
    assert.equal(state.revision, 0);
    assert.equal(state.undo, null);
    assert.equal(summarize(state).originalQuoteTWD, 1_959_530);
    assert.equal(summarize(state).overallTotals.TWD, 2_318_560.2);
    assert.equal(await readFile(path, "utf8"), raw);
    const portable = await readFile(
        new URL("../portable/裝修設備規劃.html", import.meta.url), "utf8");
    assert(portable.includes('"path":"assets/electrical-sheets.js"'));
    const extension = await readFile(
        new URL("../extensions/renovation-equipment/extension.mjs", import.meta.url),
        "utf8");
    assert.match(extension,
        /\["\/electrical-sheets\.js", \[join\(extensionDirectory, "assets", "electrical-sheets\.js"\), "text\/javascript; charset=utf-8"\]\]/);
});
