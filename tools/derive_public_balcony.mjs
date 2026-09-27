import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { migrateBalconySwap } from "../extensions/renovation-equipment/assets/balcony-plan.js";
import { summarize, validateState } from "../extensions/renovation-equipment/state.mjs";

const mode = process.argv[2];
if (!["--check", "--write"].includes(mode) || process.argv.length !== 3) {
    throw new Error("Usage: node tools\\derive_public_balcony.mjs <--check|--write>");
}
const file = new URL("../files/設備規劃.json", import.meta.url);
const raw = await readFile(file, "utf8");
const before = JSON.parse(raw);
validateState(before);
assert.deepEqual(
    [before.version, before.revision, before.undo, before.rooms.length,
        before.items.length, before.products.length],
    [5, 0, null, 13, 179, 28],
    "Expected the preceding anonymous public sample, not private or edited data",
);
assert.equal(before.updatedAt, "2026-01-01T00:00:00.000Z");

const result = migrateBalconySwap(before);
assert.equal(result.changed, true);
assert.equal(result.addedItems, 1);
assert.equal(result.addedProducts, 0);
assert.deepEqual(result.changedItemIds, [
    "balcony-dryer", "balcony-washer", "balcony-water-heater", "balcony-outboard-sink",
]);
assert.deepEqual(result.changedProductIds, ["sample-product-26"]);
const after = { ...result.state, undo: null };
validateState(after);
assert.deepEqual(after.rooms, before.rooms);
assert.deepEqual(after.items.filter((item) => !result.changedItemIds.includes(item.id)),
    before.items.filter((item) => !result.changedItemIds.includes(item.id)));
assert.deepEqual(after.products.filter((product) => product.id !== "sample-product-26"),
    before.products.filter((product) => product.id !== "sample-product-26"));
assert.deepEqual([after.items.length, after.products.length, after.revision, after.undo],
    [180, 28, 0, null]);
assert.equal(summarize(before).originalQuoteTWD, 1_959_530);
assert.equal(summarize(before).overallTotals.TWD, 2_318_560.2);
assert.equal(summarize(after).overallTotals.TWD,
    summarize(before).overallTotals.TWD);
assert.equal(after.items.filter((item) => item.outletPlanPointId).length, 67);

if (mode === "--write") {
    assert.equal(await readFile(file, "utf8"), raw,
        "The anonymous public sample changed during derivation");
    await writeFile(file, JSON.stringify(after, null, 2) + "\n", "utf8");
}
console.log(JSON.stringify({
    mode, changedItemIds: result.changedItemIds,
    changedProductIds: result.changedProductIds,
    items: after.items.length, products: after.products.length,
    originalQuoteTWD: summarize(after).originalQuoteTWD,
    knownTotalTWD: summarize(after).overallTotals.TWD,
    revision: after.revision, undo: after.undo,
}, null, 2));
