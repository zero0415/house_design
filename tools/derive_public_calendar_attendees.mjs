import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { migrateCalendarAttendees } from
    "../extensions/renovation-equipment/calendar-attendees-migration.mjs";
import {
    CALENDAR_SEED, SEED_EVENTS,
} from "../extensions/renovation-equipment/assets/construction-calendar.js";
import { summarize, validateState } from
    "../extensions/renovation-equipment/state.mjs";

const mode = process.argv[2];
if (!["--check", "--write"].includes(mode) || process.argv.length !== 3) {
    throw new Error(
        "Usage: node tools\\derive_public_calendar_attendees.mjs <--check|--write>"
    );
}
const file = new URL("../files/設備規劃.json", import.meta.url);
const raw = await readFile(file, "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");
assert.equal(sha(raw),
    "4c03f62e02c0d42ea5305f1310202e7fe4099d3e37e50475aad842f2c68eabc1",
    "Only the reviewed public anonymous 182-item v1 calendar may gain attendee roles");
const before = JSON.parse(raw);
assert.deepEqual([
    before.version, before.revision, before.undo,
    before.rooms.length, before.items.length, before.products.length,
    before.constructionCalendar.version,
    before.constructionCalendar.seed,
    before.constructionCalendar.events.length,
    before.constructionCalendar.undo,
], [5, 0, null, 13, 182, 28, 1, CALENDAR_SEED, 12, []]);
assert.deepEqual(before.constructionCalendar.events, [...SEED_EVENTS]);
const result = migrateCalendarAttendees(before);
assert.equal(result.changed, true);
const after = result.state;
for (const key of Object.keys(before).filter((key) =>
    key !== "constructionCalendar")) {
    assert.deepEqual(after[key], before[key], `Non-calendar field changed: ${key}`);
}
assert.deepEqual([
    after.constructionCalendar.version,
    after.constructionCalendar.seed,
    after.constructionCalendar.events.length,
    after.constructionCalendar.undo.length,
], [2, CALENDAR_SEED, 12, 12]);
assert.deepEqual(after.constructionCalendar.events.map((event) => [
    event.id, event.title, event.start, event.end, event.note,
    event.status,
]), before.constructionCalendar.events.map((event) => [
    event.id, event.title, event.start, event.end, event.note,
    event.status,
]));
assert.deepEqual(after.constructionCalendar.events.find((event) =>
    event.id === "construction-layout").attendees,
["屋主", "廚房工人", "系統櫃工人"]);
assert(after.constructionCalendar.events.filter((event) =>
    event.attendees.length === 0).length === 11);
assert(after.constructionCalendar.undo.every((event) =>
    event.attendees.length === 0));
assert.equal(summarize(after).originalQuoteTWD, 1_959_530);
assert.equal(summarize(after).overallTotals.TWD, 2_322_060.2);
assert.deepEqual(summarize(after), summarize(before));
validateState(after);
const serialized = JSON.stringify(after, null, 2) + "\n";
if (mode === "--write") {
    assert.equal(await readFile(file, "utf8"), raw,
        "Public calendar changed while deriving approved role labels");
    await writeFile(file, serialized, "utf8");
}
console.log(JSON.stringify({
    mode, beforeSha256: sha(raw), resultSha256: sha(serialized),
    version: after.version, revision: after.revision,
    undo: after.undo, calendarVersion: after.constructionCalendar.version,
    events: after.constructionCalendar.events.length,
    roles: after.constructionCalendar.events.find((event) =>
        event.id === "construction-layout").attendees,
    emptyRoleEvents: after.constructionCalendar.events.filter((event) =>
        event.attendees.length === 0).length,
    originalQuoteTWD: summarize(after).originalQuoteTWD,
    knownTotalTWD: summarize(after).overallTotals.TWD,
}, null, 2));
