import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrateCalendarAttendees } from
    "../extensions/renovation-equipment/calendar-attendees-migration.mjs";
import {
    CALENDAR_SEED, calendarCsv, calendarFields, editCalendar,
    guardCalendarUpdate, importCalendarAttendees, monthWeeks,
    normalizeAttendeeRoles, undoCalendar, upgradeCalendarAttendees,
    validateAttendeeRoles, validateCalendar,
} from "../extensions/renovation-equipment/assets/construction-calendar.js";
import {
    createStore, StoreError, summarize, validateState,
} from "../extensions/renovation-equipment/state.mjs";
import {
    decodeSave, encodeSave, itemListCsv,
} from "../extensions/renovation-equipment/assets/file-actions.js";
import {
    calendarUI, renderCalendar,
} from "../extensions/renovation-equipment/assets/calendar-view.js";
import {
    electricalSheetData,
} from "../extensions/renovation-equipment/assets/electrical-sheets.js";

const file = new URL("../files/設備規劃.json", import.meta.url);
const raw = await readFile(file, "utf8");
const { managementCleaningFee: _fee, ...published } = JSON.parse(raw);
const sample = structuredClone(published);
sample.constructionCalendar.events =
    sample.constructionCalendar.events.filter((event) =>
        event.id !== "construction-elevator-protection");
sample.constructionCalendar.events.find((event) =>
    event.id === "construction-start").attendees = [];
sample.constructionCalendar.undo =
    sample.constructionCalendar.undo.map((event) =>
        ({ ...event, attendees: [] }));
const v1 = structuredClone(sample);
v1.constructionCalendar = {
    version: 1, seed: CALENDAR_SEED,
    events: sample.constructionCalendar.events.map(
        ({ attendees: _attendees, ...event }) => event),
    undo: [],
};
const sha = (text) => createHash("sha256").update(text).digest("hex");
const equipment = (state) => ({
    rooms: state.rooms, items: state.items, products: state.products,
    undo: state.undo,
});
const stripRoles = (events) => events.map(
    ({ attendees: _attendees, ...event }) => event);
const layout = (calendar) => calendar.events.find(
    (event) => event.id === "construction-layout");
const capabilities = {
    controlRelationsVersion: 1, doorAllocationVersion: 1,
    robotFeatureVersion: 1, calendarFeatureVersion: 1,
    calendarAttendeesVersion: 1,
};

test("public attendee v2 derives only approved three roles from anonymous v1 calendar", () => {
    assert.equal(sha(raw),
        "a0e9dec5cf9707262f10d2d18daadf3030943ba8e41fcd084ef5c30d13faf3a4");
    assert.equal(sha(JSON.stringify(sample, null, 2) + "\n"),
        "ba27bcb482e94ead02e291c74df49dd5c9ccb90b744e997139071436e4187c3d");
    assert.equal(sha(JSON.stringify(v1, null, 2) + "\n"),
        "4c03f62e02c0d42ea5305f1310202e7fe4099d3e37e50475aad842f2c68eabc1");
    const original = structuredClone(v1);
    const result = migrateCalendarAttendees(v1);
    assert.equal(result.changed, true);
    assert.deepEqual(v1, original);
    assert.deepEqual(result.state, sample);
    assert.deepEqual(equipment(sample), equipment(v1));
    assert.deepEqual([sample.version, sample.revision, sample.undo,
        sample.rooms.length, sample.items.length, sample.products.length],
    [5, 0, null, 13, 182, 28]);
    assert.equal(sample.constructionCalendar.version, 2);
    assert.deepEqual(layout(sample.constructionCalendar).attendees,
        ["屋主", "廚房工人", "系統櫃工人"]);
    assert.equal(sample.constructionCalendar.events.filter((event) =>
        event.attendees.length === 0).length, 11);
    assert.deepEqual(stripRoles(sample.constructionCalendar.events),
        v1.constructionCalendar.events);
    assert.equal(sample.constructionCalendar.undo.length, 12);
    assert.deepEqual(stripRoles(sample.constructionCalendar.undo),
        v1.constructionCalendar.events);
    assert(sample.constructionCalendar.undo.every((event) =>
        event.attendees.length === 0));
    assert.deepEqual(undoCalendar(sample.constructionCalendar).events,
        upgradeCalendarAttendees(v1.constructionCalendar).events);
    assert.deepEqual(validateState(sample).constructionCalendar,
        sample.constructionCalendar);
    assert.equal(summarize(sample).originalQuoteTWD, 1_959_530);
    assert.equal(summarize(sample).overallTotals.TWD, 2_322_060.2);
    assert.deepEqual(summarize(sample), summarize(v1));
    assert.equal(itemListCsv(sample), itemListCsv(v1));
    assert.deepEqual(electricalSheetData(sample), electricalSheetData(v1));
});

test("second approved kickoff roles and separate elevator job change only public calendar", () => {
    const beforeElevator = structuredClone(published);
    beforeElevator.constructionCalendar.events =
        beforeElevator.constructionCalendar.events.filter((event) =>
            event.id !== "construction-elevator-protection");
    beforeElevator.constructionCalendar.undo =
        beforeElevator.constructionCalendar.events.map((event) =>
            ({ ...event, attendees: event.id ===
                "construction-start" ? [] : [...event.attendees] }));
    assert.equal(sha(JSON.stringify(beforeElevator, null, 2) + "\n"),
        "3bf9099580221fb59eb69f994889b0e05fb07a9445f8f05b4c58da3cab4499bf");
    assert.deepEqual(equipment(published), equipment(sample));
    assert.deepEqual([published.version, published.revision, published.undo,
        published.rooms.length, published.items.length,
        published.products.length],
    [5, 0, null, 13, 182, 28]);
    const calendar = published.constructionCalendar;
    const start = calendar.events.find((event) =>
        event.id === "construction-start");
    const elevator = calendar.events.find((event) =>
        event.id === "construction-elevator-protection");
    const demolition = calendar.events.find((event) =>
        event.id === "construction-demolition");
    assert.deepEqual(start.attendees,
        ["屋主", "輕隔間廠商代表"]);
    assert.deepEqual(layout(calendar).attendees,
        ["屋主", "廚房工人", "系統櫃工人"]);
    assert.deepEqual([elevator.title, elevator.start, elevator.end,
        elevator.status, elevator.attendees],
    ["電梯走道保護", "2026-10-13", "2026-10-13",
        "tentative", []]);
    assert.match(elevator.note, /費用尚待核對.*不能推定原工程報價已含或免費/);
    assert.deepEqual([demolition.start, demolition.end],
        ["2026-10-13", "2026-10-16"]);
    assert.equal(calendar.events.length, 13);
    assert.equal(calendar.events.filter((event) =>
        event.attendees.length === 0).length, 11);
    assert.deepEqual(calendar.events.filter((event) =>
        event.id !== elevator.id), beforeElevator.constructionCalendar.events);
    assert.deepEqual(calendar.undo, beforeElevator.constructionCalendar.events);
    const overlaps = monthWeeks("2026-10", calendar.events).flatMap((week) =>
        week.segments).filter((segment) =>
        ["construction-elevator-protection",
            "construction-demolition"].includes(segment.event.id) &&
            segment.from === "2026-10-13");
    assert.equal(overlaps.length, 2);
    assert.equal(new Set(overlaps.map((segment) => segment.lane)).size, 2);
    assert.equal(overlaps.find((segment) =>
        segment.event.id === elevator.id).span, 1);
    const schedule = calendarCsv(calendar);
    assert.match(schedule, /電梯走道保護/);
    assert.match(schedule, /費用尚待核對/);
    assert.equal(schedule.split("\r\n").length, 15);
    assert.deepEqual(summarize(published), summarize(sample));
    assert.equal(itemListCsv(published), itemListCsv(sample));
    assert.deepEqual(electricalSheetData(published),
        electricalSheetData(sample));
    assert.deepEqual(migrateCalendarAttendees(published),
        { changed: false, state: published });
});

test("already-upgraded owner edits stay untouched; partial or unrelated seed refuses overwrite", () => {
    const edited = structuredClone(sample);
    edited.constructionCalendar = editCalendar(
        edited.constructionCalendar, {
            ...layout(edited.constructionCalendar),
            attendees: ["現場協調人員"],
        });
    assert.deepEqual(migrateCalendarAttendees(edited),
        { changed: false, state: edited });
    edited.constructionCalendar =
        undoCalendar(sample.constructionCalendar);
    assert.deepEqual(migrateCalendarAttendees(edited).state, edited);
    const otherSeed = structuredClone(v1);
    otherSeed.constructionCalendar.seed = null;
    assert.throws(() => migrateCalendarAttendees(otherSeed), /拒絕/);
    const noTarget = structuredClone(v1);
    noTarget.constructionCalendar.events =
        noTarget.constructionCalendar.events.filter((event) =>
            event.id !== "construction-layout");
    assert.throws(() => migrateCalendarAttendees(noTarget), /拒絕/);
    assert.throws(() => migrateCalendarAttendees({
        ...v1, unreviewed: true,
    }), /不能重設其他屋主欄位/);
});

test("role-only validation rejects counts, duplicates, malformed v2 events and Undo", () => {
    assert.deepEqual(normalizeAttendeeRoles([
        " 屋主 ", "", "廚房工人  ",
    ]), ["屋主", "廚房工人"]);
    for (const roles of [
        ["屋主", "屋主"], ["A", "a"], [" 屋主"], [""],
        [3], ["屋主" + String.fromCharCode(57) + "人"],
        ["屋主" + "十" + "人"],
        ["工人" + String.fromCharCode(0xff19) + "位"],
        ["角色\n姓名"], ["x".repeat(41)],
        Array.from({ length: 21 }, (_, i) => "x".repeat(i + 1)),
    ]) {
        assert.throws(() => validateAttendeeRoles(roles),
            TypeError, JSON.stringify(roles));
    }
    assert.throws(() => normalizeAttendeeRoles([
        " 屋主 ", "屋主",
    ]), /重複/);
    for (const change of [
        (calendar) => { delete calendar.events[0].attendees; },
        (calendar) => { calendar.events[0].attendees = null; },
        (calendar) => { calendar.undo[0].attendees =
            ["屋主", "屋主"]; },
        (calendar) => { calendar.events[0].headcount = 3; },
        (calendar) => { calendar.events[0].attendees =
            [{ role: "屋主", count: 3 }]; },
    ]) {
        const calendar = structuredClone(sample.constructionCalendar);
        change(calendar);
        assert.throws(() => validateCalendar(calendar), TypeError);
    }
    assert.deepEqual(validateCalendar(v1.constructionCalendar),
        v1.constructionCalendar);
});

test("role edits have independent Undo; v1 promotes only if a nonempty role is assigned", () => {
    const legacy = editCalendar(v1.constructionCalendar, {
        ...layout(v1.constructionCalendar), attendees: [],
    });
    assert.equal(legacy.version, 1);
    const promoted = editCalendar(v1.constructionCalendar, {
        ...layout(v1.constructionCalendar), attendees: ["屋主"],
    });
    assert.equal(promoted.version, 2);
    assert.deepEqual(stripRoles(promoted.undo),
        v1.constructionCalendar.events);
    const removed = editCalendar(promoted, {
        ...layout(promoted), attendees: [],
    });
    assert.equal(removed.version, 2);
    assert.deepEqual(undoCalendar(removed).events, promoted.events);
    assert.deepEqual(equipment(sample), equipment(v1));
});

test("container10 and v2 Undo remain strict; old calendar9 and robot8 stay importable", () => {
    assert.equal(JSON.parse(encodeSave(sample)).formatVersion, 10);
    assert.deepEqual(decodeSave(encodeSave(sample)).constructionCalendar,
        sample.constructionCalendar);
    assert.equal(JSON.parse(encodeSave(v1)).formatVersion, 9);
    assert.deepEqual(decodeSave(encodeSave(v1)).constructionCalendar,
        v1.constructionCalendar);
    const wrap = (state, version) => JSON.stringify({
        format: "renovation-equipment-planner",
        formatVersion: version, state,
    });
    for (const version of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
        assert.throws(() => decodeSave(wrap(sample, version)), /容器 10/);
    }
    assert.throws(() => decodeSave(wrap(v1, 10)), /須使用容器 9/);
    const noCalendar = structuredClone(v1);
    delete noCalendar.constructionCalendar;
    assert.throws(() => decodeSave(wrap(noCalendar, 10)), /完整行事曆/);
    assert.equal(JSON.parse(encodeSave(noCalendar)).formatVersion, 8);
    assert.deepEqual(decodeSave(wrap(noCalendar, 8)).items,
        noCalendar.items);
    for (const field of ["events", "undo"]) {
        const invalid = structuredClone(sample);
        delete invalid.constructionCalendar[field][0].attendees;
        assert.throws(() => decodeSave(wrap(invalid, 10)), /誰要出席/);
        assert.throws(() => encodeSave(invalid), /誰要出席/);
    }
    assert.deepEqual(decodeSave(JSON.stringify(sample)).constructionCalendar,
        sample.constructionCalendar);
    const imported = importCalendarAttendees(
        sample.constructionCalendar, v1.constructionCalendar);
    assert.equal(imported.version, 2);
    assert.deepEqual(layout(imported).attendees,
        layout(sample.constructionCalendar).attendees);
    const wiped = { ...sample,
        constructionCalendar: undoCalendar(sample.constructionCalendar) };
    assert.equal(JSON.parse(encodeSave(wiped)).formatVersion, 10);
});

test("CSV and visible month bars expose every approved role with a person badge", () => {
    const csv = calendarCsv(sample.constructionCalendar);
    assert.match(csv, /誰要出席（預計角色）/);
    assert.match(csv, /原始日期與週日規則/);
    assert.match(csv, /屋主、廚房工人、系統櫃工人/);
    assert.doesNotMatch(csv, /屋主[0-9]+人/);
    assert.equal(csv.split("\r\n").length, 14);
    const html = renderCalendar(published.constructionCalendar, calendarUI());
    assert.match(html, /calendar-owner[\s\S]*?<svg/);
    const bar = (id) => html.match(new RegExp(
        `<button type="button"\\s+data-calendar-event="${id}"` +
        "[\\s\\S]*?<\\/button>"))?.[0];
    const kickoff = bar("construction-start");
    const layoutBar = bar("construction-layout");
    assert(kickoff && layoutBar);
    assert.match(kickoff, /class="calendar-person-icon"/);
    assert.match(kickoff, /calendar-owner[\s\S]*?屋主/);
    assert.match(kickoff, /calendar-role[\s\S]*?輕隔間廠商代表/);
    for (const role of ["屋主", "廚房工人", "系統櫃工人"]) {
        assert.match(layoutBar, new RegExp(role));
    }
    assert.equal((layoutBar.match(/class="calendar-role(?: calendar-owner)?"/g)
        ?? []).length, 3);
    assert.match(html, /預計出席：[\s\S]*?屋主、廚房工人、系統櫃工人/);
    assert.match(html, /誰要出席：[\s\S]*?屋主/);
    const edited = editCalendar(sample.constructionCalendar, {
        ...layout(sample.constructionCalendar),
        attendees: ['<角色>&"', '=ROLE("x")'],
    });
    const escaped = renderCalendar(edited, calendarUI());
    assert.match(escaped, /&lt;角色&gt;&amp;&quot;/);
    assert.doesNotMatch(escaped, /<角色>/);
    assert.match(calendarCsv(editCalendar(
        sample.constructionCalendar, {
            ...layout(sample.constructionCalendar),
            attendees: ['=ROLE("x")'],
        })), /'=ROLE/);
    assert.equal(monthWeeks("2027-01",
        sample.constructionCalendar.events).length, 6);
});

test("server rejects stale and old writers; valid v2 changes retain equipment Undo", async () => {
    const directory = await mkdtemp(join(tmpdir(), "public-attendees-"));
    try {
        const path = join(directory, "state.json");
        await writeFile(path, JSON.stringify(v1), "utf8");
        const store = createStore(path);
        const old = await store.read();
        const candidate = migrateCalendarAttendees(old).state;
        await assert.rejects(() => store.update(old.revision - 1, {
            ...candidate, ...capabilities,
        }), (error) => error instanceof StoreError &&
            error.status === 409);
        await assert.rejects(() => store.update(old.revision, {
            ...candidate, ...capabilities,
            calendarAttendeesVersion: undefined,
        }), (error) => error instanceof StoreError &&
            error.status === 400 && /出席角色/.test(error.message));
        const saved = await store.update(old.revision, {
            ...candidate, ...capabilities,
        });
        assert.deepEqual(equipment(saved), equipment(old));
        assert.equal(saved.revision, 1);
        await assert.rejects(() => store.update(saved.revision, {
            ...v1, ...capabilities,
        }), (error) => error instanceof StoreError &&
            error.status === 400 && /降版/.test(error.message));
        assert.throws(() => guardCalendarUpdate(sample, {
            ...v1, calendarFeatureVersion: 1,
            calendarAttendeesVersion: undefined,
        }), /出席角色/);
        const restored = await store.update(saved.revision, {
            ...saved,
            constructionCalendar: undoCalendar(saved.constructionCalendar),
            ...capabilities,
        });
        assert.deepEqual(restored.undo, old.undo);
        assert.equal(restored.constructionCalendar.events.length, 12);
        assert(restored.constructionCalendar.events.every(
            (event) => event.attendees.length === 0));
        assert.deepEqual(calendarFields(restored).constructionCalendar,
            restored.constructionCalendar);
        assert.equal(JSON.parse(await readFile(path, "utf8")).revision, 2);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
