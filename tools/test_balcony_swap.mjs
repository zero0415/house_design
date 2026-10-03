import assert from "node:assert/strict";
import { readFile, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrateBalconySwap, renderBalconyReference } from
    "../extensions/renovation-equipment/assets/balcony-plan.js";
import {
    BALCONY_BASIN_WARNING, BALCONY_SINK_ID, BALCONY_SWAP_TAG,
    conditionalGasDryerWarning, isConditionalFloorDryer, isConditionalOutboardSink,
} from "../extensions/renovation-equipment/assets/laundry-notes.js";
import {
    BALCONY_SINK, HOUSE_ZONE_BY_ID, footprintFits, nearestRoomCenter,
} from "../extensions/renovation-equipment/assets/house-geometry.js";
import {
    itemFootprint, markerPosition, renderOverviewPlan, renderRoomPlan, roomGeometry,
} from "../extensions/renovation-equipment/assets/floorplan.js";
import {
    decodeSave, encodeSave, itemListCsv,
} from "../extensions/renovation-equipment/assets/file-actions.js";
import { linkedProductMismatch } from
    "../extensions/renovation-equipment/assets/product-database.js";
import {
    createStore, StoreError, summarize, validateState,
} from "../extensions/renovation-equipment/state.mjs";
import { calendarFields } from
    "../extensions/renovation-equipment/assets/construction-calendar.js";
import { ROBOT_ID } from
    "../extensions/renovation-equipment/assets/robot-plan.js";

const currentSample = JSON.parse(await readFile(
    new URL("../files/設備規劃.json", import.meta.url), "utf8"));
const sample = structuredClone(currentSample);
sample.items = sample.items.filter((entry) => entry.id !== ROBOT_ID);
const item = (state, id) => state.items.find((entry) => entry.id === id);
const product = (state, id) => state.products.find((entry) => entry.id === id);
const snapshot = (state) => ({
    rooms: state.rooms, items: state.items, products: state.products,
});

function previousAnonymousBalcony() {
    const state = structuredClone(sample);
    state.items = state.items.filter((entry) => entry.id !== BALCONY_SINK_ID);
    Object.assign(item(state, "balcony-dryer"), {
        roomId: "ac-platform", orientation: 180, placement: { x: .857, y: .5 },
        note: "Whirlpool 8TWGD5050PW 瓦斯烘衣機本體 NT$20,599；機身寬73.7×深72.1×高102.9cm，原外推鐵窗暫位不移。約78cm毛深與機身深度只差約5.9cm，尚未扣框架、排氣或維修；供氣、排煙、防雨、承重振動、防火與合法許可全未核，須合格人員現勘，嚴禁據圖施工。",
    });
    item(state, "balcony-washer").note =
        "Whirlpool 8TWTW5010PW 洗衣機本體參考 NT$21,150；機身寬 70.5×深 68.6cm，保留陽台原標位。圖上未含安裝與維修淨空；給排水、供電、門淨寬及實際施工另核。";
    item(state, "balcony-water-heater").note =
        "暫標在陽台右側牆面（烘衣機已移至外推鐵窗）；窄條僅表示牆面位置，與烘衣機可能在不同高度，非實際機身尺寸。熱水器型式、型號、尺寸、安裝高度、與烘衣機安全間距、電源或瓦斯、給排水及排氣須現場由合格廠商確認。原報價熱水器安裝單價2,500元／組但數量未填（本次0元）；本體及安裝費待報。";
    Object.assign(product(state, "sample-product-26"), {
        name: "Whirlpool 8TWGD5050PW 瓦斯烘衣機（鐵窗暫位）",
        note: "機身寬73.7×深72.1×高102.9cm。外推鐵窗約78cm毛深僅剩約5.9cm，未扣框架、排氣、維修；瓦斯供應、排煙防雨、荷重振動、防火、固定防墜與合法許可全未核。條件式暫位，不得據圖施工。",
    });
    validateState(state);
    return state;
}

const previous = previousAnonymousBalcony();
const migrated = migrateBalconySwap(previous);
const after = migrated.state;
const dryer = item(sample, "balcony-dryer");
const sink = item(sample, BALCONY_SINK_ID);
const balcony = roomGeometry(sample.rooms.find((room) => room.id === "balcony"));

test("published sample is anonymous v5 with one unpriced basin and unchanged prices", () => {
    assert.equal(currentSample.items.length, 182);
    assert.deepEqual(currentSample.items.slice(0, -1), sample.items);
    validateState(sample);
    assert.deepEqual([sample.version, sample.revision, sample.undo,
        sample.rooms.length, sample.items.length, sample.products.length],
    [5, 0, null, 13, 181, 28]);
    assert.equal(sample.updatedAt, "2026-01-01T00:00:00.000Z");
    assert.equal(new Set(sample.items.map((entry) => entry.id)).size, 181);
    assert.deepEqual([sink.roomId, sink.kind, sink.widthCm, sink.depthCm,
        sink.heightCm, sink.unitPrice, sink.installationUnitPrice,
        sink.productId, sink.equipmentCategory, sink.markerStyle],
    ["ac-platform", "equipment", 82, 48, null, null, null, null, null, null]);
    assert.equal(sink.lightSpecSource, "");
    assert.match(sink.note, /盛水荷重未知.*可靠混凝土結構.*不能以原鐵窗作承重依據/);
    assert.equal(summarize(sample).originalQuoteTWD, 1_959_530);
    assert.equal(summarize(sample).overallTotals.TWD, 2_322_060.2);
    assert.equal(summarize(previous).overallTotals.TWD, 2_322_060.2);
    assert.equal(sample.items.filter((entry) => entry.outletPlanPointId).length, 67);
    assert.equal(sample.items.filter((entry) => entry.lightWatts === 50).length, 8);
    assert.equal(product(sample, "sample-product-26").unitPrice, 20599);
    assert.equal(product(sample, "sample-product-26").environment, "any");
    assert.equal(linkedProductMismatch(
        product(sample, dryer.productId), dryer), null);
    assert.equal(sample.items.filter((entry) =>
        entry.productId === dryer.productId).length, 1);
});

test("guarded conversion touches only three existing items, new basin and one neutral product", () => {
    const original = structuredClone(previous);
    assert.equal(migrated.changed, true);
    assert.deepEqual(migrated.changedItemIds, [
        "balcony-dryer", "balcony-washer", "balcony-water-heater", BALCONY_SINK_ID,
    ]);
    assert.deepEqual(migrated.changedProductIds, ["sample-product-26"]);
    assert.deepEqual([migrated.addedItems, migrated.addedProducts,
        migrated.knownDeltaTWD], [1, 0, 0]);
    assert.deepEqual(previous, original);
    validateState(after);
    assert.deepEqual(after.undo, snapshot(previous));
    const sortItems = (state) => [...state.items].sort((a, b) =>
        a.id.localeCompare(b.id));
    assert.deepEqual({ ...after, items: sortItems(after), undo: null },
        { ...sample, items: sortItems(sample) });
    assert.deepEqual(after.rooms, previous.rooms);
    assert.deepEqual(after.items.filter((entry) =>
        !migrated.changedItemIds.includes(entry.id)),
    previous.items.filter((entry) => !migrated.changedItemIds.includes(entry.id)));
    assert.deepEqual(after.products.filter((entry) =>
        entry.id !== "sample-product-26"),
    previous.products.filter((entry) => entry.id !== "sample-product-26"));
    for (const id of ["balcony-washer", "balcony-water-heater"]) {
        assert.deepEqual({ ...item(sample, id), note: item(previous, id).note },
            item(previous, id));
    }
    for (const key of Object.keys(item(previous, "balcony-dryer"))) {
        if (["roomId", "orientation", "placement", "note"].includes(key)) continue;
        assert.deepEqual(dryer[key], item(previous, "balcony-dryer")[key], key);
    }
    const oldProduct = product(previous, dryer.productId);
    const newProduct = product(sample, dryer.productId);
    assert.deepEqual({ ...newProduct, note: oldProduct.note, name: oldProduct.name },
        oldProduct);
    assert(!itemListCsv(sample).includes("烘衣機已移至外推鐵窗"));
    assert(!itemListCsv(sample).includes("原外推鐵窗暫位不移"));
    assert.deepEqual(decodeSave(encodeSave(sample)).items, sample.items);
    assert.deepEqual(decodeSave(encodeSave(sample)).undo, null);
});

test("center, dimensions and warnings distinguish balcony floor from iron-frame legacy", () => {
    assert.deepEqual(markerPosition(dryer, balcony), {
        x: BALCONY_SINK.x + BALCONY_SINK.width / 2,
        y: BALCONY_SINK.y + BALCONY_SINK.height / 2,
    });
    assert.equal(dryer.orientation, 270);
    assert.equal(dryer.productId, "sample-product-26");
    assert.equal(dryer.unitPrice, 20599);
    const platform = roomGeometry(sample.rooms.find((room) =>
        room.id === "ac-platform"));
    assert.equal(markerPosition(sink, platform).x,
        balcony.x + balcony.width / 2);
    assert.equal(sink.placement.y, .5);
    assert(Math.abs(sink.placement.x - .8209823352) < 1e-9);
    assert(isConditionalFloorDryer(dryer));
    assert(isConditionalOutboardSink(sink));
    assert.match(conditionalGasDryerWarning(dryer), /約81cm.*轉向後機寬73.7cm/);
    assert.match(conditionalGasDryerWarning(dryer), /不可用軟管跨門/);
    assert.match(conditionalGasDryerWarning(dryer), /R33.*不自動移位/);
    assert(!conditionalGasDryerWarning(dryer).includes("5.9cm"));
    assert.match(conditionalGasDryerWarning(item(previous, dryer.id)), /5.9cm/);
    assert.match(BALCONY_BASIN_WARNING, /合法給排水.*護欄.*不能採用/);
});

test("only the tagged existing dryer bypasses old sink; walls and other IDs remain guarded", () => {
    const point = markerPosition(dryer, balcony);
    const size = itemFootprint(dryer, balcony);
    assert.equal(footprintFits(balcony, point.x, point.y,
        size.width, size.height), false);
    assert.equal(footprintFits(balcony, point.x, point.y,
        size.width, size.height, dryer), true);
    const r33 = previous.items.find((entry) => entry.outletPlanPointId === "R33");
    assert(r33);
    for (const other of [
        { ...dryer, id: "other-dryer" }, { ...dryer, note: "" },
        item(previous, "balcony-washer"), r33,
    ]) {
        assert.equal(footprintFits(balcony, point.x, point.y,
            size.width, size.height, other), false);
    }
    assert.equal(footprintFits(balcony, balcony.x, point.y,
        size.width, size.height, dryer), false);
    assert.deepEqual(nearestRoomCenter(balcony, point.x + 2, point.y,
        size.width, size.height, dryer), { x: point.x + 2, y: point.y });
    assert.deepEqual(BALCONY_SINK, { x: 582, y: 1757, width: 66, height: 62 });
    assert.deepEqual(HOUSE_ZONE_BY_ID.get("balcony").points, balcony.points);
});

test("edited or partially applied states fail without mutation; repeated migration preserves edits", () => {
    assert.deepEqual(migrateBalconySwap(sample), {
        state: sample, changed: false, changedItemIds: [],
    });
    const shifted = structuredClone(sample);
    item(shifted, dryer.id).placement.x = .2;
    assert.deepEqual(migrateBalconySwap(shifted).state, shifted);
    for (const change of [
        (s) => { item(s, dryer.id).placement.x = .8; },
        (s) => { item(s, dryer.id).unitPrice = 20000; },
        (s) => { item(s, "balcony-washer").placement.x = .8; },
        (s) => { item(s, "balcony-water-heater").placement.y = .4; },
        (s) => { item(s, "balcony-washer").note += "使用者編輯"; },
        (s) => { item(s, "balcony-water-heater").note += "使用者編輯"; },
        (s) => { item(s, dryer.id).note += BALCONY_SWAP_TAG; },
        (s) => { product(s, dryer.productId).name += "自訂"; },
        (s) => { s.items.push(structuredClone(sink)); },
        (s) => { s.items = s.items.filter((entry) => entry.id !== dryer.id); },
    ]) {
        const candidate = structuredClone(previous);
        change(candidate);
        const copy = structuredClone(candidate);
        assert.throws(() => migrateBalconySwap(candidate), /不同|缺漏|部分|修改/);
        assert.deepEqual(candidate, copy);
    }
    const missingBasin = structuredClone(sample);
    missingBasin.items = missingBasin.items.filter((entry) =>
        entry.id !== BALCONY_SINK_ID);
    assert.throws(() => migrateBalconySwap(missingBasin), /部分/);
});

test("new and old plans keep historical sink; only new plan marks conditional demolition", () => {
    for (const svg of [
        renderOverviewPlan(sample.rooms, sample.items),
        renderRoomPlan(sample.rooms.find((room) => room.id === "balcony"),
            sample.items.filter((entry) => entry.roomId === "balcony"),
            null, sample.items),
    ]) {
        assert.match(svg, /fixed-balcony-sink/);
        assert.match(svg, /data-demolition-status="proposed"/);
        assert.match(svg, /尚未拆除/);
        assert.match(svg, /conditional-floor-dryer/);
        assert(!/undefined|\bNaN\b/.test(svg));
        assert(!/<image|data:image/i.test(svg));
    }
    const oldSvg = renderOverviewPlan(previous.rooms, previous.items);
    assert.match(oldSvg, /fixed-balcony-sink/);
    assert(!oldSvg.includes('data-demolition-status="proposed"'));
    const platformSvg = renderRoomPlan(
        sample.rooms.find((room) => room.id === "ac-platform"), [sink], null,
        sample.items,
    );
    assert.match(platformSvg, /data-marker-id="balcony-outboard-sink"/);
    assert.match(platformSvg, /conditional-outboard-basin/);
    assert.match(platformSvg, /icon-basin/);
    assert(!platformSvg.includes('room-marker square-label'));
    assert.match(platformSvg, /獨立支撐/);
});

test("balcony comparison is original vector, visible by default and never embeds media", () => {
    const html = renderBalconyReference();
    assert.match(html, /^<figure class="balcony-reference">/);
    assert.match(html, /<svg\b[^>]*role="img"/);
    assert.match(html, /data-balcony-reference="vector"/);
    assert.match(html, /<title id="balcony-reference-title">/);
    assert.match(html, /<desc id="balcony-reference-desc">/);
    assert.match(html, /原槽擬拆・未核價/);
    assert.match(html, /外推區不是承重依據/);
    assert.match(html, /<details class="balcony-safety-details">\s*<summary>/);
    assert(html.indexOf("<svg ") < html.indexOf("<details "));
    assert(!/<(?:img|image|foreignObject|script)\b|data:image|base64,|https?:|file:/i.test(html));
    assert(!html.includes(["session", "state"].join("-")));
});

test("store retains one full Undo and rejects stale revision; sample itself has no history", async () => {
    const directory = await mkdtemp(join(tmpdir(), "public-balcony-test-"));
    try {
        const path = join(directory, "public.json");
        await writeFile(path, JSON.stringify(previous), "utf8");
        const store = createStore(path);
        const latest = await store.read();
        const reviewed = migrateBalconySwap(latest).state;
        const capabilities = {
            controlRelationsVersion: 1, doorAllocationVersion: 1,
            calendarFeatureVersion: 1, calendarAttendeesVersion: 1,
        };
        const written = await store.update(latest.revision, {
            ...reviewed, ...capabilities,
        });
        assert.deepEqual(written.items, reviewed.items);
        assert.deepEqual(written.products, reviewed.products);
        assert.deepEqual(written.undo, snapshot(latest));
        await assert.rejects(() => store.update(latest.revision, {
            ...reviewed, ...capabilities,
        }),
            (error) => error instanceof StoreError && error.status === 409);
        const undone = await store.update(written.revision, {
            version: 5, ...written.undo, undo: null,
            ...calendarFields(written), ...capabilities,
        });
        assert.deepEqual(snapshot(undone), snapshot(latest));
        assert.deepEqual(undone.constructionCalendar,
            latest.constructionCalendar);
        assert.equal(sample.undo, null);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
