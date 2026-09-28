import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { migrateRobotPlan } from
    "../extensions/renovation-equipment/robot-migration.mjs";
import { ROBOT_ID } from
    "../extensions/renovation-equipment/assets/robot-plan.js";
import { calculateBudget } from
    "../extensions/renovation-equipment/assets/budget.js";
import { previewCircuitLinks } from
    "../extensions/renovation-equipment/assets/circuit-preview.js";
import { summarize, validateState } from
    "../extensions/renovation-equipment/state.mjs";

const mode = process.argv[2];
if (!["--check", "--write"].includes(mode) || process.argv.length !== 3) {
    throw new Error("Usage: node tools\\derive_public_robot.mjs <--check|--write>");
}
const file = new URL("../files/設備規劃.json", import.meta.url);
const raw = await readFile(file, "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");
assert.equal(sha(raw),
    "a427936df43e0ec5b487002306951b33a99c9d2497a265970f7a227f9edc33dd",
    "Only the reviewed anonymous public 181-item door release may be migrated");
const before = JSON.parse(raw);
assert.deepEqual([
    before.version, before.revision, before.undo, before.updatedAt,
    before.rooms.length, before.items.length, before.products.length,
], [5, 0, null, "2026-01-01T00:00:00.000Z", 13, 181, 28]);
assert(before.items.every((item) => !Object.hasOwn(item, "controlledLightIds")));
assert.equal(summarize(before).originalQuoteTWD, 1_959_530);
assert.equal(summarize(before).overallTotals.TWD, 2_322_060.2);
assert.equal(calculateBudget(before.items).quotedDoorTotal, 114_500);

const result = migrateRobotPlan(before);
assert.deepEqual([
    result.changed, result.addedItems, result.addedProducts,
    result.changedItemIds, result.deltaTWD,
], [true, 1, 0, [ROBOT_ID], 0]);
assert.deepEqual(result.state.undo, {
    rooms: before.rooms, items: before.items, products: before.products,
});
const after = { ...result.state, undo: null };
validateState(after);
assert.deepEqual(after.rooms, before.rooms);
assert.deepEqual(after.products, before.products);
assert.deepEqual(after.items.slice(0, -1), before.items);
assert.deepEqual([
    after.version, after.revision, after.undo, after.updatedAt,
    after.rooms.length, after.items.length, after.products.length,
], [5, 0, null, before.updatedAt, 13, 182, 28]);
const robot = after.items.at(-1);
assert.deepEqual([robot.id, robot.roomId, robot.kind, robot.quantity],
    [ROBOT_ID, "living-dining", "equipment", 1]);
for (const key of [
    "brandModel", "unitPrice", "productId",
    "widthCm", "depthCm", "heightCm", "installationUnitPrice",
    "outletCircuit", "circuitOutletId", "equipmentType",
]) {
    assert.equal(robot[key], null, `Unverified robot field must remain null: ${key}`);
}
assert.equal(robot.outletPlanPointId, undefined);
assert.equal(robot.switchType, null);
assert.equal(robot.lightType, null);
assert.deepEqual(
    ["R", "B", "C"].map((prefix) => after.items.filter((item) =>
        item.outletPlanPointId?.startsWith(prefix)).length),
    [51, 9, 7],
);
assert.deepEqual([
    after.items.filter((item) => item.lightType && item.placement).length,
    after.items.filter((item) => item.switchType &&
        item.switchPlanStatus === "active").length,
    after.items.filter((item) => item.switchType &&
        item.switchPlanStatus === "removed").length,
], [16, 14, 2]);
assert.deepEqual(previewCircuitLinks(after.items), []);
assert.equal(calculateBudget(after.items).quotedDoorTotal, 114_500);
assert.equal(after.items.filter((item) => item.trackDoorId).reduce(
    (total, item) => total +
        item.quotedQuantity * item.quotedUnitPrice, 0), 2_880);
assert.equal(summarize(after).originalQuoteTWD, 1_959_530);
assert.equal(summarize(after).overallTotals.TWD, 2_322_060.2);

const serialized = JSON.stringify(after, null, 2) + "\n";
if (mode === "--write") {
    assert.equal(await readFile(file, "utf8"), raw,
        "The anonymous public sample changed during robot derivation");
    await writeFile(file, serialized, "utf8");
}
console.log(JSON.stringify({
    mode, beforeSha256: sha(raw), resultSha256: sha(serialized),
    addedItemId: robot.id, items: after.items.length,
    products: after.products.length, revision: after.revision,
    undo: after.undo, originalQuoteTWD: summarize(after).originalQuoteTWD,
    knownTotalTWD: summarize(after).overallTotals.TWD,
}, null, 2));
