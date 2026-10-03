import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { assertReviewedPublicState } from
    "../extensions/renovation-equipment/door-migration.mjs";
import {
    CALENDAR_SEED, validateCalendar,
} from "../extensions/renovation-equipment/assets/construction-calendar.js";
import { summarize } from
    "../extensions/renovation-equipment/state.mjs";

const mode = process.argv[2];
if (!["--check", "--write"].includes(mode) || process.argv.length !== 3) {
    throw new Error(
        "Usage: node tools\\derive_public_calendar_start_attendees.mjs <--check|--write>"
    );
}
const file = new URL("../files/設備規劃.json", import.meta.url);
const raw = await readFile(file, "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");
assert.equal(sha(raw),
    "ba27bcb482e94ead02e291c74df49dd5c9ccb90b744e997139071436e4187c3d",
    "Only the reviewed anonymous public v2 calendar with one approved role list may be updated");
const before = JSON.parse(raw);
assertReviewedPublicState(before);
assert.deepEqual([
    before.version, before.revision, before.undo,
    before.rooms.length, before.items.length, before.products.length,
    before.constructionCalendar.version,
    before.constructionCalendar.seed,
    before.constructionCalendar.events.length,
    before.constructionCalendar.undo.length,
], [5, 0, null, 13, 182, 28, 2, CALENDAR_SEED, 12, 12]);
const event = (state, id) => state.constructionCalendar.events.find(
    (entry) => entry.id === id);
assert.deepEqual([
    event(before, "construction-start").title,
    event(before, "construction-start").start,
    event(before, "construction-start").end,
    event(before, "construction-start").status,
    event(before, "construction-start").attendees,
], ["開工.拆除確認", "2026-10-09", "2026-10-09", "tentative", []]);
assert.deepEqual(event(before, "construction-layout").attendees,
    ["屋主", "廚房工人", "系統櫃工人"]);
assert(before.constructionCalendar.events.filter((entry) =>
    entry.attendees.length === 0).length === 11);
assert(before.constructionCalendar.undo.every((entry) =>
    entry.attendees.length === 0));

const after = structuredClone(before);
after.constructionCalendar.undo =
    structuredClone(before.constructionCalendar.events);
event(after, "construction-start").attendees =
    ["屋主", "輕隔間廠商代表"];
after.constructionCalendar = validateCalendar(after.constructionCalendar);
assertReviewedPublicState(after);
for (const key of Object.keys(before).filter((name) =>
    name !== "constructionCalendar")) {
    assert.deepEqual(after[key], before[key], `Unrelated public state changed: ${key}`);
}
assert.deepEqual(after.constructionCalendar.undo,
    before.constructionCalendar.events);
assert.deepEqual(event(after, "construction-layout").attendees,
    ["屋主", "廚房工人", "系統櫃工人"]);
assert.deepEqual(event(after, "construction-start").attendees,
    ["屋主", "輕隔間廠商代表"]);
assert(after.constructionCalendar.events.filter((entry) =>
    entry.attendees.length === 0).length === 10);
assert.deepEqual(after.constructionCalendar.events.map((entry) =>
    [entry.id, entry.title, entry.start, entry.end, entry.status, entry.note]),
before.constructionCalendar.events.map((entry) =>
    [entry.id, entry.title, entry.start, entry.end, entry.status, entry.note]));
assert.equal(summarize(after).originalQuoteTWD, 1_959_530);
assert.equal(summarize(after).overallTotals.TWD, 2_322_060.2);
assert.deepEqual(summarize(after), summarize(before));

const serialized = JSON.stringify(after, null, 2) + "\n";
if (mode === "--write") {
    assert.equal(await readFile(file, "utf8"), raw,
        "Anonymous sample changed while deriving the second approved role list");
    await writeFile(file, serialized, "utf8");
}
console.log(JSON.stringify({
    mode, beforeSha256: sha(raw), resultSha256: sha(serialized),
    items: after.items.length, products: after.products.length,
    revision: after.revision, undo: after.undo,
    events: after.constructionCalendar.events.length,
    startRoles: event(after, "construction-start").attendees,
    layoutRoles: event(after, "construction-layout").attendees,
    unassignedEvents: after.constructionCalendar.events.filter((entry) =>
        entry.attendees.length === 0).length,
    calendarUndoEvents: after.constructionCalendar.undo.length,
    originalQuoteTWD: summarize(after).originalQuoteTWD,
    knownTotalTWD: summarize(after).overallTotals.TWD,
}, null, 2));
