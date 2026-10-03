import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { migrateConstructionCalendar } from
    "../extensions/renovation-equipment/calendar-migration.mjs";
import { SEED_EVENTS } from
    "../extensions/renovation-equipment/assets/construction-calendar.js";
import { summarize, validateState } from
    "../extensions/renovation-equipment/state.mjs";

const mode = process.argv[2];
if (!["--check", "--write"].includes(mode) || process.argv.length !== 3) {
    throw new Error("Usage: node tools\\derive_public_calendar.mjs <--check|--write>");
}
const file = new URL("../files/設備規劃.json", import.meta.url);
const raw = await readFile(file, "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");
assert.equal(sha(raw),
    "b1c8a5dcd2a768acae1e99606a65caad44c53927fab5899053d44b84e685ffcc",
    "Only the reviewed anonymous public 182-item robot release may be seeded");
const before = JSON.parse(raw);
assert.deepEqual([
    before.version, before.revision, before.undo, before.updatedAt,
    before.rooms.length, before.items.length, before.products.length,
], [5, 0, null, "2026-01-01T00:00:00.000Z", 13, 182, 28]);
const result = migrateConstructionCalendar(before);
assert.equal(result.changed, true);
const after = result.state;
assert.deepEqual(after.rooms, before.rooms);
assert.deepEqual(after.items, before.items);
assert.deepEqual(after.products, before.products);
assert.deepEqual(after.undo, before.undo);
assert.deepEqual([
    after.version, after.revision, after.updatedAt,
    after.rooms.length, after.items.length, after.products.length,
], [5, 0, before.updatedAt, 13, 182, 28]);
assert.deepEqual(after.constructionCalendar.events, [...SEED_EVENTS]);
assert.deepEqual(after.constructionCalendar.undo, []);
assert.equal(summarize(before).originalQuoteTWD, 1_959_530);
assert.equal(summarize(after).originalQuoteTWD, 1_959_530);
assert.equal(summarize(before).overallTotals.TWD, 2_322_060.2);
assert.equal(summarize(after).overallTotals.TWD, 2_322_060.2);
validateState(after);
const serialized = JSON.stringify(after, null, 2) + "\n";
if (mode === "--write") {
    assert.equal(await readFile(file, "utf8"), raw,
        "The public sample changed while preparing calendar data");
    await writeFile(file, serialized, "utf8");
}
console.log(JSON.stringify({
    mode, beforeSha256: sha(raw), resultSha256: sha(serialized),
    events: after.constructionCalendar.events.length,
    items: after.items.length, revision: after.revision,
    undo: after.undo, calendarUndo: after.constructionCalendar.undo,
    originalQuoteTWD: summarize(after).originalQuoteTWD,
    knownTotalTWD: summarize(after).overallTotals.TWD,
}, null, 2));
