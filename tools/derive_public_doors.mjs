import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { migrateDoorAllocation } from
    "../extensions/renovation-equipment/door-migration.mjs";
import { calculateBudget } from
    "../extensions/renovation-equipment/assets/budget.js";
import { previewCircuitLinks } from
    "../extensions/renovation-equipment/assets/circuit-preview.js";
import { summarize, validateState } from
    "../extensions/renovation-equipment/state.mjs";

const mode = process.argv[2];
if (!["--check", "--write"].includes(mode) || process.argv.length !== 3) {
    throw new Error("Usage: node tools\\derive_public_doors.mjs <--check|--write>");
}
const file = new URL("../files/設備規劃.json", import.meta.url);
const raw = await readFile(file, "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");
assert.equal(sha(raw),
    "6b7038729964496ea2d9efb9049f9b8e7b4cfb0c848eda877bb68c1a1ec9e601",
    "Only the reviewed anonymous public 180-item release may be migrated");
const before = JSON.parse(raw);
assert.deepEqual([
    before.version, before.revision, before.undo, before.updatedAt,
    before.rooms.length, before.items.length, before.products.length,
], [5, 0, null, "2026-01-01T00:00:00.000Z", 13, 180, 28]);
assert(before.items.every((item) => !Object.hasOwn(item, "controlledLightIds")));
assert.equal(summarize(before).originalQuoteTWD, 1_959_530);
assert.equal(summarize(before).overallTotals.TWD, 2_318_560.2);

const result = migrateDoorAllocation(before);
assert.equal(result.changed, true);
assert.equal(result.addedItems, 1);
assert.equal(result.addedProducts, 0);
assert.equal(result.deltaTWD, 3500);
assert.deepEqual(result.changedItemIds, [
    "door-balcony", "door-bedroom-2", "door-main-bath-master",
    "door-main-bath-hall", "track-main-bath-hall",
    "track-bedroom-3-studio", "door-bedroom-3-studio",
]);
assert.deepEqual(result.state.undo, {
    rooms: before.rooms, items: before.items, products: before.products,
});

const after = { ...result.state, undo: null };
validateState(after);
assert.deepEqual(after.rooms, before.rooms);
assert.deepEqual(after.products, before.products);
assert.deepEqual(after.items.filter((item) =>
    !result.changedItemIds.includes(item.id)),
before.items.filter((item) => !result.changedItemIds.includes(item.id)));
assert.deepEqual([
    after.version, after.revision, after.undo, after.updatedAt,
    after.rooms.length, after.items.length, after.products.length,
], [5, 0, null, before.updatedAt, 13, 181, 28]);
assert(after.items.every((item) => !Object.hasOwn(item, "controlledLightIds")));
assert.deepEqual([
    calculateBudget(after.items).quotedDoorTotal,
    after.items.filter((item) => item.trackDoorId).reduce(
        (total, item) => total +
            item.quotedQuantity * item.quotedUnitPrice, 0),
], [114500, 2880]);
assert.equal(summarize(after).originalQuoteTWD, 1_959_530);
assert.equal(summarize(after).overallTotals.TWD, 2_322_060.2);
assert.deepEqual(
    ["R", "B", "C"].map((prefix) => after.items.filter((item) =>
        item.outletPlanPointId?.startsWith(prefix)).length),
    [51, 9, 7],
);
const lights = after.items.filter((item) => item.lightType && item.placement);
assert.equal(lights.length, 16);
assert.equal(lights.reduce((total, item) =>
    total + (item.lightType === "track" ?
        item.spotlightQuantity : item.quantity), 0), 19);
assert.deepEqual([
    after.items.filter((item) => item.switchType &&
        item.switchPlanStatus === "active").length,
    after.items.filter((item) => item.switchType &&
        item.switchPlanStatus === "removed").length,
], [14, 2]);
assert.deepEqual(previewCircuitLinks(after.items), []);

const serialized = JSON.stringify(after, null, 2) + "\n";
if (mode === "--write") {
    assert.equal(await readFile(file, "utf8"), raw,
        "The public sample changed while deriving the door allocation");
    await writeFile(file, serialized, "utf8");
}
console.log(JSON.stringify({
    mode, beforeSha256: sha(raw), resultSha256: sha(serialized),
    changedItemIds: result.changedItemIds, items: after.items.length,
    products: after.products.length, revision: after.revision,
    undo: after.undo, originalQuoteTWD: summarize(after).originalQuoteTWD,
    knownTotalTWD: summarize(after).overallTotals.TWD,
}, null, 2));
