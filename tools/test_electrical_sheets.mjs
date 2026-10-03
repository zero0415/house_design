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
import { ROBOT_ID } from "../extensions/renovation-equipment/assets/robot-plan.js";

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

test("both sheets draw saved laundry positions and ghost only the tagged historical sink", () => {
    const previous = structuredClone(state);
    previous.items = previous.items.filter((item) =>
        item.id !== "balcony-outboard-sink" && item.id !== ROBOT_ID);
    const oldDryer = previous.items.find((item) =>
        item.id === "balcony-dryer");
    oldDryer.roomId = "ac-platform";
    oldDryer.orientation = 180;
    oldDryer.placement = { x: .857, y: .5 };
    const original = JSON.stringify(state);
    for (const view of ["outlet-sheet", "lighting-sheet"]) {
        const current = renderElectricalSheet(state, view);
        const old = renderElectricalSheet(previous, view);
        assert.equal(matches(current, /data-sheet-context=/g).length, 4);
        assert.equal(matches(current,
            new RegExp(`data-sheet-context="${ROBOT_ID}"`, "g")).length, 1);
        for (const id of ["balcony-dryer", "balcony-washer",
            "balcony-outboard-sink"]) {
            const item = state.items.find((entry) => entry.id === id);
            const room = state.rooms.find((entry) => entry.id === item.roomId);
            const { x, y } = markerPosition(item, roomGeometry(room));
            assert.equal(matches(current, new RegExp(
                `data-sheet-context="${id}"`, "g")).length, 1);
            assert(current.includes(`data-context-room="${item.roomId}"
            transform="translate(${x} ${y})"`));
        }
        assert.equal(matches(current, /historical-proposed-sink/g).length, 1);
        assert.match(current, /原水槽擬拆.*尚未拆除/);
        assert.equal(matches(current, />原水槽擬拆<\/text>/g).length, 1);
        assert.match(current, /data-demolition-status="proposed"/);
        assert.match(current, /非施工：烘衣機門口／燃氣／排氣/);
        assert.doesNotMatch(current, /class="sink-bowl"/);
        assert.match(current, /class="object-icon conditional-outboard-basin"/);
        assert.equal(matches(old, /data-sheet-context=/g).length, 2);
        const oldPosition = markerPosition(oldDryer,
            roomGeometry(previous.rooms.find((room) =>
                room.id === "ac-platform")));
        assert(old.includes(`data-context-room="ac-platform"
            transform="translate(${oldPosition.x} ${oldPosition.y})"`));
        assert.match(old, /class="fixed-balcony-sink" role="img"/);
        assert.match(old, /class="sink-bowl"/);
        assert.match(old, /原水槽仍為現況/);
        assert.doesNotMatch(old,
            /data-sheet-context="balcony-outboard-sink"|historical-proposed-sink|data-demolition-status/);
        assert(!/<(?:img|image|foreignObject|script)\b|data:image|file:/i.test(current));
        assert(!/<(?:img|image|foreignObject|script)\b|data:image|file:/i.test(old));
    }
    assert.equal(JSON.stringify(state), original);
    assert.equal(data.placedEndpoints.length, 67);
    assert.equal(data.placedLights.length, 16);
    assert.equal(data.activeSwitches.length, 14);
});

test("sheet context follows later user placements and never guesses a gas model", () => {
    const edited = structuredClone(state);
    const dryer = edited.items.find((item) => item.id === "balcony-dryer");
    dryer.placement = { x: .2, y: .5 };
    const position = markerPosition(dryer, roomGeometry(edited.rooms.find(
        (room) => room.id === dryer.roomId)));
    let html = renderElectricalSheet(edited, "outlet-sheet");
    assert(html.includes(`data-context-room="balcony"
            transform="translate(${position.x} ${position.y})"`));
    dryer.brandModel = "";
    dryer.productId = null;
    dryer.note = "機型和供能未選，施工條件待核。";
    html = renderElectricalSheet(edited, "lighting-sheet");
    assert.match(html, /<text[^>]*>烘衣機（條件）<\/text>/);
    assert.doesNotMatch(html, /瓦斯烘衣機（條件）/);
    assert.match(html, /非施工：烘衣機門口／供能／排氣/);
    assert.doesNotMatch(html, /historical-proposed-sink/);
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
    assert.equal(state.items.length, 182);
    assert.equal(state.products.length, 28);
    assert.equal(state.revision, 0);
    assert.equal(state.undo, null);
    assert.equal(summarize(state).originalQuoteTWD, 1_959_530);
    assert.equal(summarize(state).overallTotals.TWD, 2_333_060.2);
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
