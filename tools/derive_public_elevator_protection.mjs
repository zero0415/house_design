import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { assertReviewedPublicState } from
    "../extensions/renovation-equipment/door-migration.mjs";
import { validateCalendar } from
    "../extensions/renovation-equipment/assets/construction-calendar.js";
import { summarize } from
    "../extensions/renovation-equipment/state.mjs";

const mode = process.argv[2];
if (!["--check", "--write"].includes(mode) || process.argv.length !== 3) {
    throw new Error(
        "Usage: node tools\\derive_public_elevator_protection.mjs <--check|--write>"
    );
}
const file = new URL("../files/設備規劃.json", import.meta.url);
const raw = await readFile(file, "utf8");
const sha = (text) => createHash("sha256").update(text).digest("hex");
assert.equal(sha(raw),
    "3bf9099580221fb59eb69f994889b0e05fb07a9445f8f05b4c58da3cab4499bf",
    "Only the reviewed anonymous 12-job public calendar with two approved role lists may add this job");
const before = JSON.parse(raw);
assertReviewedPublicState(before);
assert.deepEqual([
    before.version, before.revision, before.undo,
    before.rooms.length, before.items.length, before.products.length,
    before.constructionCalendar.version,
    before.constructionCalendar.events.length,
    before.constructionCalendar.undo.length,
], [5, 0, null, 13, 182, 28, 2, 12, 12]);
const items = before.constructionCalendar.events;
const one = (state, id) => state.constructionCalendar.events.find(
    (entry) => entry.id === id);
assert.deepEqual(one(before, "construction-start").attendees,
    ["屋主", "輕隔間廠商代表"]);
assert.deepEqual(one(before, "construction-layout").attendees,
    ["屋主", "廚房工人", "系統櫃工人"]);
assert(items.filter((entry) => entry.attendees.length === 0).length === 10);
assert(!items.some((entry) =>
    entry.id === "construction-elevator-protection" ||
    entry.title === "電梯走道保護"));
const demolition = one(before, "construction-demolition");
assert.deepEqual([
    demolition.start, demolition.end, demolition.attendees,
], ["2026-10-13", "2026-10-16", []]);

const after = structuredClone(before);
after.constructionCalendar.undo =
    structuredClone(before.constructionCalendar.events);
const index = after.constructionCalendar.events.findIndex((entry) =>
    entry.id === "construction-demolition");
after.constructionCalendar.events.splice(index + 1, 0, {
    id: "construction-elevator-protection",
    title: "電梯走道保護",
    start: "2026-10-13",
    end: "2026-10-13",
    note: "電梯與走道保護一日條件式暫排；保護範圍、材料、管理許可、" +
        "拆裝工資與費用尚待核對。不能推定原工程報價已含或免費，" +
        "不自動延長或改期任何既有工項。",
    status: "tentative",
    attendees: [],
});
after.constructionCalendar = validateCalendar(after.constructionCalendar);
assertReviewedPublicState(after);
for (const key of Object.keys(before).filter((name) =>
    name !== "constructionCalendar")) {
    assert.deepEqual(after[key], before[key], `Unrelated public state changed: ${key}`);
}
assert.deepEqual(after.constructionCalendar.undo, items);
assert.deepEqual(after.constructionCalendar.events.filter((entry) =>
    entry.id !== "construction-elevator-protection"), items);
assert.deepEqual(one(after, "construction-start").attendees,
    ["屋主", "輕隔間廠商代表"]);
assert.deepEqual(one(after, "construction-layout").attendees,
    ["屋主", "廚房工人", "系統櫃工人"]);
assert.deepEqual([
    one(after, "construction-demolition").start,
    one(after, "construction-demolition").end,
], ["2026-10-13", "2026-10-16"]);
assert.equal(after.constructionCalendar.events.length, 13);
assert.equal(after.constructionCalendar.events.filter((entry) =>
    entry.attendees.length === 0).length, 11);
assert.equal(summarize(after).originalQuoteTWD, 1_959_530);
assert.equal(summarize(after).overallTotals.TWD, 2_322_060.2);
assert.deepEqual(summarize(after), summarize(before));

const serialized = JSON.stringify(after, null, 2) + "\n";
if (mode === "--write") {
    assert.equal(await readFile(file, "utf8"), raw,
        "Anonymous sample changed while deriving the additional job");
    await writeFile(file, serialized, "utf8");
}
console.log(JSON.stringify({
    mode, beforeSha256: sha(raw), resultSha256: sha(serialized),
    items: after.items.length, products: after.products.length,
    revision: after.revision, undo: after.undo,
    calendarVersion: after.constructionCalendar.version,
    events: after.constructionCalendar.events.length,
    elevator: one(after, "construction-elevator-protection"),
    startRoles: one(after, "construction-start").attendees,
    layoutRoles: one(after, "construction-layout").attendees,
    unassignedEvents: after.constructionCalendar.events.filter((entry) =>
        entry.attendees.length === 0).length,
    originalQuoteTWD: summarize(after).originalQuoteTWD,
    knownTotalTWD: summarize(after).overallTotals.TWD,
}, null, 2));
