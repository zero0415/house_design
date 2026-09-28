import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import {
    kitchenAdditions, migrateKitchenVLayout, renderKitchenReference,
} from "../extensions/renovation-equipment/assets/kitchen-plan.js";
import {
    calculateBudget, calculatePlanTotal, ORIGINAL_QUOTE_TWD,
} from "../extensions/renovation-equipment/assets/budget.js";
import {
    itemFootprint, kitchenShortWingFill, renderOverviewPlan, renderRoomPlan, roomGeometry,
} from "../extensions/renovation-equipment/assets/floorplan.js";
import { KITCHEN_V_LAYOUT_TAG } from "../extensions/renovation-equipment/assets/kitchen-icons.js";
import { validateState } from "../extensions/renovation-equipment/state.mjs";

test("three accessible vector projections keep the existing kitchen relationships", () => {
    const html = renderKitchenReference();
    assert.match(html, /^<details class="kitchen-reference">/);
    const views = [...html.matchAll(/<svg\b[\s\S]*?<\/svg>/g)].map((match) => match[0]);
    assert.equal(views.length, 3);
    assert.equal(new Set(views).size, 3);
    for (const [index, type] of ["isometric", "elevations", "top"].entries()) {
        const svg = views[index];
        assert(svg.includes(`data-kitchen-view="${type}"`));
        assert.match(svg, /role="img"[\s\S]*aria-labelledby="[^"]+"/);
        assert.match(svg, /<title id="[^"]+">[^<]+<\/title>/);
        assert.equal([...svg.matchAll(/data-kitchen-bay=/g)].length, 5);
        assert.equal([...svg.matchAll(/data-kitchen-object=/g)].length, 7);
        for (const relation of [
            'data-kitchen-object="dishwasher" data-bay="prep" data-layer="under"',
            'data-kitchen-object="hot-water" data-bay="sink" data-layer="under"',
            'data-kitchen-object="ih" data-bay="hob"',
            'data-kitchen-object="gas" data-bay="hob"',
            'data-kitchen-object="hood" data-bay="hob" data-layer="above"',
            'data-kitchen-bay="short-return"',
            'data-kitchen-bay="tower-short-end"',
        ]) assert(svg.includes(relation), relation);
        assert(!svg.includes('data-kitchen-bay="tower-main-right"'));
        assert(svg.includes('data-kitchen-fill="adjustable"'));
    }
    assert.match(views[1], /長牆正立面/);
    assert.match(views[1], /短牆正立面/);
    assert.match(views[0], /data-countertop-outline="single-L"/);
    const lShape = views[0].match(/data-countertop-outline="single-L"\s+points="([^"]+)"/);
    assert.equal(lShape[1].trim().split(/\s+/).length, 6);
    assert.equal([...views[0].matchAll(/data-countertop-outline=/g)].length, 1);
    assert.match(views[0], /data-corner-join="provisional"/);
    assert.match(views[1], /平台／高櫃／封板皆待丈量/);
    assert.match(views[2], /虛線＝櫃下；點線＝上方層/);
    assert(!/名義外寬(?:56|60|4)cm.*短翼/.test(html));
    assert(!/<(?:img|image|foreignObject|script)\b|\bhref=|data:image|https?:/i.test(html));
});

test("fixed drawing warns about unverified clearances without changing public data", async () => {
    const source = await readFile(new URL("../files/設備規劃.json", import.meta.url), "utf8");
    const state = JSON.parse(source);
    const before = structuredClone(state);
    const html = renderKitchenReference();
    for (const phrase of ["不隨拖曳", "非施工圖", "短翼最末端",
        "連續訂製備餐平台", "斜線＝訂製伸縮預留", "單片 L 形檯面",
        "59.8×深55×高81.5",
        "60–60.8", "81.5–87.5", "尚未證明有足夠內部淨寬", "洗碗機只在備餐檯下",
        "60.5cm僅內槽寬", "水槽櫃下", "價格以存檔為準", "排煙路徑是假設"]) {
        assert(html.includes(phrase), phrase);
    }
    assert.equal(renderKitchenReference(), html);
    assert.deepEqual(state, before);
    assert.equal(await readFile(new URL("../files/設備規劃.json", import.meta.url), "utf8"),
        source);
    assert.equal(state.revision, 0);
    assert.equal(state.undo, null);
    assert.equal(state.items.length, 181);
    assert.equal(state.products.length, 28);
    assert.equal(ORIGINAL_QUOTE_TWD, 1_959_530);
    assert.equal(calculatePlanTotal(calculateBudget(state.items, { wholePlan: true })).TWD,
        2_322_060.2);
});

test("pure guarded public V migration changes only two anonymous cabinet records", async () => {
    const source = JSON.parse(await readFile(
        new URL("../files/設備規劃.json", import.meta.url), "utf8"));
    const ids = ["kitchen-plan-tower", "kitchen-plan-return"];
    const previous = source.items.filter((item) => ids.includes(item.id));
    if (previous.every((item) => item.note.includes(KITCHEN_V_LAYOUT_TAG))) {
        const tower = previous.find((item) => item.id === ids[0]);
        const platform = previous.find((item) => item.id === ids[1]);
        tower.name = "右端電器高櫃（暫估）";
        tower.note = "舊匿名高櫃配置示意，產品與價格待報。";
        tower.placement = { x: 238 / 289, y: 32 / 165 };
        platform.name = "L 型短邊訂製櫃（暫估）";
        platform.note = "右端向下轉折的短邊訂製櫃；寬 40、長 75cm 僅暫位，價格留白待報。";
        platform.placement = { x: 238 / 289, y: 99.5 / 165 };
    }
    validateState(source);
    const original = structuredClone(source);
    const outcome = migrateKitchenVLayout(source);
    assert.deepEqual(source, original);
    assert(outcome.changed);
    assert.deepEqual(outcome.changedItemIds, ids);
    assert.deepEqual([outcome.addedItems, outcome.addedProducts], [0, 0]);
    const next = outcome.state;
    validateState(next);
    assert.equal(next.items.length, 181);
    assert.equal(next.products.length, 28);
    assert.deepEqual(next.rooms, original.rooms);
    assert.deepEqual(next.products, original.products);
    assert.deepEqual(next.items.filter((item) => !ids.includes(item.id)),
        original.items.filter((item) => !ids.includes(item.id)));
    assert.deepEqual(next.undo, {
        rooms: original.rooms, items: original.items, products: original.products,
    });
    for (const [index, id] of ids.entries()) {
        const item = next.items.find((entry) => entry.id === id);
        const old = original.items.find((entry) => entry.id === id);
        assert.equal(item.productId, null);
        assert.equal(item.unitPrice, null);
        assert.equal(item.orientation, old.orientation);
        assert.equal(item.widthCm, old.widthCm);
        assert.equal(item.depthCm, old.depthCm);
        assert.deepEqual(item.placement, index === 0
            ? { x: .826, y: .675 } : { x: .824, y: .262 });
        assert(item.note.includes(KITCHEN_V_LAYOUT_TAG));
        assert(item.note.includes("非訂製尺寸"));
    }
    assert.deepEqual(
        calculatePlanTotal(calculateBudget(next.items, { wholePlan: true })),
        calculatePlanTotal(calculateBudget(source.items, { wholePlan: true })));
    assert.deepEqual(migrateKitchenVLayout(next).state, next);
    const shifted = structuredClone(next);
    shifted.items.find((item) => item.id === ids[0]).placement.x = .8;
    assert.deepEqual(migrateKitchenVLayout(shifted).state, shifted);
    const fresh = kitchenAdditions().items;
    for (const id of ids) {
        const newItem = next.items.find((item) => item.id === id);
        const template = fresh.find((item) => item.id === id);
        assert.deepEqual(newItem.placement, template.placement);
        assert.equal(newItem.name, template.name);
    }
    const geometry = roomGeometry(next.rooms.find((room) => room.id === "kitchen"));
    const fill = kitchenShortWingFill(next.items, geometry);
    assert(fill.valid);
    assert.equal(fill.y + fill.height, geometry.y + geometry.height);
    assert.match(fill.note, /不是另一個櫃體/);
    const roomSvg = renderRoomPlan(
        next.rooms.find((room) => room.id === "kitchen"),
        next.items.filter((item) => item.roomId === "kitchen"), null, next.items);
    const overviewSvg = renderOverviewPlan(next.rooms, next.items);
    for (const svg of [roomSvg, overviewSvg]) {
        assert(svg.includes('data-fill-band="short-wing"'));
        assert(!/NaN|undefined/.test(svg));
    }
    const hidden = renderRoomPlan(
        next.rooms.find((room) => room.id === "kitchen"),
        next.items.filter((item) => item.roomId === "kitchen"), null, next.items,
        false, null, { furniture: false, outlets: true, lights: true, switches: true });
    assert(!hidden.includes('data-fill-band="short-wing"'));
    const conflict = structuredClone(source);
    conflict.items.find((item) => item.id === ids[0]).orientation = 90;
    assert.throws(() => migrateKitchenVLayout(conflict), /衝突/);
    assert.deepEqual(source, original);
});

test("V migration preserves later owner moves and suppresses unsafe infill", async () => {
    const source = JSON.parse(await readFile(
        new URL("../files/設備規劃.json", import.meta.url), "utf8"));
    const tower = source.items.find((item) => item.id === "kitchen-plan-tower");
    const platform = source.items.find((item) => item.id === "kitchen-plan-return");
    if (tower.note.includes(KITCHEN_V_LAYOUT_TAG) &&
        platform.note.includes(KITCHEN_V_LAYOUT_TAG)) {
        tower.note = "訂製高櫃原暫位，價格待報。";
        platform.note = "原短邊平台暫位，尺寸與工資待核。";
    }
    tower.placement = { x: .82, y: .813 };
    platform.placement = { x: .82, y: .391 };
    const before = structuredClone(source);
    const result = migrateKitchenVLayout(source);
    assert.deepEqual(source, before);
    assert.equal(result.placementMode, "preserved-owner-placements");
    assert.deepEqual(result.state.items.find((item) => item.id === tower.id).placement,
        tower.placement);
    assert.deepEqual(result.state.items.find((item) => item.id === platform.id).placement,
        platform.placement);
    validateState(result.state);
    const geometry = roomGeometry(result.state.rooms.find((room) =>
        room.id === "kitchen"));
    assert(kitchenShortWingFill(result.state.items, geometry).valid);
    const moved = structuredClone(result.state);
    moved.items.find((item) => item.id === platform.id).placement.x = .2;
    const invalid = kitchenShortWingFill(moved.items, geometry);
    assert.equal(invalid.valid, false);
    const svg = renderRoomPlan(moved.rooms.find((room) => room.id === "kitchen"),
        moved.items.filter((item) => item.roomId === "kitchen"), null, moved.items);
    assert(svg.includes('data-kitchen-fill="needs-review"'));
    assert(!svg.includes('data-fill-band="short-wing"'));
    const missing = structuredClone(before);
    missing.items = missing.items.filter((item) => item.id !== platform.id);
    assert.throws(() => migrateKitchenVLayout(missing), /缺漏/);
    const partial = structuredClone(before);
    partial.items.find((item) => item.id === platform.id).note +=
        KITCHEN_V_LAYOUT_TAG;
    assert.throws(() => migrateKitchenVLayout(partial), /部分/);
});

test("explicitly unknown custom cabinet dimensions do not resurrect template sizes", async () => {
    const state = JSON.parse(await readFile(
        new URL("../files/設備規劃.json", import.meta.url), "utf8"));
    const geometry = roomGeometry(state.rooms.find((room) => room.id === "kitchen"));
    for (const id of ["kitchen-plan-tower", "kitchen-plan-return"]) {
        const item = state.items.find((entry) => entry.id === id);
        const known = itemFootprint(item, geometry);
        const unknown = { ...item, widthCm: null, depthCm: null };
        const iconSize = itemFootprint({ ...unknown, furnitureType: "no-template" }, geometry);
        assert.deepEqual(itemFootprint(unknown, geometry), iconSize);
        assert.notDeepEqual(itemFootprint(unknown, geometry), known);
        const legacy = { ...item };
        delete legacy.widthCm;
        delete legacy.depthCm;
        assert.deepEqual(itemFootprint(legacy, geometry), known);
    }
});
