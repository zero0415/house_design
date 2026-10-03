import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { migrateConstructionCalendar } from
    "../extensions/renovation-equipment/calendar-migration.mjs";
import {
    addDays, CALENDAR_WORK_RULE, calendarCsv, calendarFields, CALENDAR_SEED,
    dateNumber, dateString, editCalendar, emptyCalendar, hasCalendar,
    isSunday, isSundayException, monthWeeks, SEED_EVENTS, taipeiToday,
    undoCalendar, validateCalendar,
} from "../extensions/renovation-equipment/assets/construction-calendar.js";
import {
    dayReference, lunarDate, lunarDay, REFERENCE_END, REFERENCE_START,
} from "../extensions/renovation-equipment/assets/calendar-reference.js";
import {
    calendarMonthRange, calendarUI, MAX_EXPANDED_MONTHS, renderCalendar,
} from "../extensions/renovation-equipment/assets/calendar-view.js";
import {
    createStore, StoreError, summarize, validateState,
} from "../extensions/renovation-equipment/state.mjs";
import {
    decodeSave, encodeSave, itemListCsv,
} from "../extensions/renovation-equipment/assets/file-actions.js";
import {
    electricalSheetData,
} from "../extensions/renovation-equipment/assets/electrical-sheets.js";
import { previewCircuitLinks } from
    "../extensions/renovation-equipment/assets/circuit-preview.js";

const file = new URL("../files/設備規劃.json", import.meta.url);
const raw = await readFile(file, "utf8");
const { managementCleaningFee: _fee, ...publicWithRoles } = JSON.parse(raw);
const sample = structuredClone(publicWithRoles);
sample.constructionCalendar = {
    version: 1, seed: publicWithRoles.constructionCalendar.seed,
    events: publicWithRoles.constructionCalendar.events.filter((event) =>
        event.id !== "construction-elevator-protection").map(
            ({ attendees: _attendees, ...event }) => event),
    undo: [],
};
const withoutCalendar = (source) => {
    const { constructionCalendar: _calendar, ...previous } = source;
    return previous;
};
const before = withoutCalendar(sample);
const equipment = (source) => ({
    rooms: source.rooms, items: source.items,
    products: source.products, undo: source.undo,
});
const capabilities = {
    controlRelationsVersion: 1, doorAllocationVersion: 1,
    robotFeatureVersion: 1, calendarFeatureVersion: 1,
};
const hash = (text) => createHash("sha256").update(text).digest("hex");

test("original 12-job calendar is exactly one additive field on the published robot edition", () => {
    assert.equal(hash(raw),
        "a0e9dec5cf9707262f10d2d18daadf3030943ba8e41fcd084ef5c30d13faf3a4");
    assert.equal(hash(JSON.stringify(sample, null, 2) + "\n"),
        "4c03f62e02c0d42ea5305f1310202e7fe4099d3e37e50475aad842f2c68eabc1");
    assert.equal(hash(JSON.stringify(before, null, 2) + "\n"),
        "b1c8a5dcd2a768acae1e99606a65caad44c53927fab5899053d44b84e685ffcc");
    assert.deepEqual(Object.keys(sample),
        [...Object.keys(before), "constructionCalendar"]);
    assert.deepEqual([sample.version, sample.revision, sample.undo,
        sample.rooms.length, sample.items.length, sample.products.length],
    [5, 0, null, 13, 182, 28]);
    assert.deepEqual(sample.constructionCalendar, validateCalendar({
        version: 1, seed: CALENDAR_SEED,
        events: [...SEED_EVENTS], undo: [],
    }));
    const normalized = validateState(sample);
    assert.deepEqual(normalized.constructionCalendar,
        sample.constructionCalendar);
    assert.deepEqual(normalized.rooms, before.rooms);
    assert.deepEqual(normalized.items, before.items);
    assert.deepEqual(normalized.undo, before.undo);
    const products = structuredClone(before.products);
    products.find((entry) =>
        entry.id === "sample-product-08").trackLengthCm = 150;
    assert.deepEqual(normalized.products, products);
    assert.equal(summarize(sample).originalQuoteTWD, 1_959_530);
    assert.equal(summarize(sample).overallTotals.TWD, 2_322_060.2);
    assert.equal(summarize(before).overallTotals.TWD, 2_322_060.2);
    assert.deepEqual(
        ["R", "B", "C"].map((letter) =>
            sample.items.filter((item) =>
                item.outletPlanPointId?.startsWith(letter)).length),
        [51, 9, 7]);
    assert.deepEqual([
        sample.items.filter((item) => item.lightType && item.placement).length,
        sample.items.filter((item) => item.switchType &&
            item.switchPlanStatus === "active").length,
        sample.items.filter((item) => item.switchType &&
            item.switchPlanStatus === "removed").length,
    ], [16, 14, 2]);
    assert.equal(electricalSheetData(sample).heads, 19);
    assert.deepEqual(previewCircuitLinks(sample.items), []);
});

test("12 approved work dates are inclusive, distinct, tentative, and do not add private appointments", () => {
    assert.deepEqual(SEED_EVENTS.map(({ title, start, end }) =>
        [title, start, end]), [
        ["開工.拆除確認", "2026-10-09", "2026-10-09"],
        ["拆除施工", "2026-10-13", "2026-10-16"],
        ["水電放樣", "2026-10-17", "2026-10-17"],
        ["輕隔間隔單面牆", "2026-10-17", "2026-10-17"],
        ["水電施工", "2026-10-19", "2026-11-13"],
        ["泥作施工", "2026-11-16", "2026-12-11"],
        ["輕隔間及天花板", "2026-12-14", "2026-12-18"],
        ["油漆施工", "2026-12-21", "2027-01-15"],
        ["廚具.系統櫃體安裝", "2027-01-18", "2027-01-23"],
        ["水電自備項目安裝(燈具.衛浴設備等)", "2027-01-25", "2027-01-27"],
        ["全室清潔", "2027-01-28", "2027-01-29"],
        ["油漆最終收尾及完工點交", "2027-01-30", "2027-01-30"],
    ]);
    assert.deepEqual(sample.constructionCalendar.events, [...SEED_EVENTS]);
    assert(SEED_EVENTS.every((event) =>
        event.status === "tentative" &&
        event.id.startsWith("construction-") &&
        /暫排/.test(event.note)));
    assert.match(SEED_EVENTS.at(-1).note, /1 月 30 日單日暫排/);
    const serialized = JSON.stringify(sample.constructionCalendar);
    assert(!/[\w.+-]+@[\w.-]+\.[a-z]{2,}|09\d{8}/i.test(serialized));
});

test("guarded public migration preserves equipment, prices and owner edits without auto-seeding old saves", () => {
    assert.equal(hasCalendar(before), false);
    const original = structuredClone(before);
    const result = migrateConstructionCalendar(before);
    assert.equal(result.changed, true);
    assert.deepEqual(result.state, sample);
    assert.deepEqual(before, original);
    assert.deepEqual(equipment(result.state), equipment(before));
    assert.deepEqual(migrateConstructionCalendar(sample),
        { changed: false, state: sample });
    const edited = structuredClone(sample);
    edited.constructionCalendar = editCalendar(edited.constructionCalendar,
        null, "construction-wall");
    assert.deepEqual(migrateConstructionCalendar(edited),
        { changed: false, state: edited });
    assert.throws(() => migrateConstructionCalendar({
        ...before, constructionCalendar: emptyCalendar(),
    }), /已有其他行事曆/);
    assert.throws(() => migrateConstructionCalendar({
        ...before, privateExtra: "unreviewed",
    }), /不能重設其他屋主欄位/);
    const moved = structuredClone(before);
    moved.items.find((item) => item.id === "living-auto-water-robot").note +=
        " 使用者補充備註。";
    const extended = migrateConstructionCalendar(moved).state;
    assert.deepEqual(equipment(extended), equipment(moved));
});

test("Gregorian dates, Taiwan local day and cross-year segments do not depend on host timezone", () => {
    for (const date of [
        "2026-02-29", "2100-02-29", "2027-04-31",
        "2027-1-01", "2027-00-01", "2027-01-01T00:00:00Z",
    ]) assert.throws(() => dateNumber(date));
    assert.equal(addDays("2028-02-28", 1), "2028-02-29");
    assert.equal(addDays("2026-12-31", 1), "2027-01-01");
    assert.equal(taipeiToday(new Date("2026-10-08T16:00:00Z")),
        "2026-10-09");
    const originalTZ = process.env.TZ;
    try {
        for (const zone of [
            "Asia/Taipei", "America/New_York", "Pacific/Honolulu",
        ]) {
            process.env.TZ = zone;
            assert.equal(dateNumber("2027-03-15") -
                dateNumber("2027-03-13"), 2);
            assert.equal(monthWeeks("2027-01", SEED_EVENTS)
                .at(-1).days.at(-1), "2027-02-06");
        }
    } finally {
        if (originalTZ === undefined) delete process.env.TZ;
        else process.env.TZ = originalTZ;
    }
    for (const month of ["1901-01", "2000-02", "2028-02", "2099-12"]) {
        assert.doesNotThrow(() =>
            renderCalendar(emptyCalendar(), { ...calendarUI(), month }));
    }
});

test("Sunday-first grid omits Sunday from multi-day bars but keeps inclusive dates and overlapping jobs", () => {
    const october = monthWeeks("2026-10", SEED_EVENTS);
    assert.equal(october[0].days[0], "2026-09-27");
    const sameDay = october.find((week) =>
        week.days.includes("2026-10-17")).segments.filter((segment) =>
        ["construction-wall", "construction-layout"].includes(
            segment.event.id));
    assert.equal(sameDay.length, 2);
    assert.equal(new Set(sameDay.map((segment) => segment.lane)).size, 2);
    const utilities = [
        ...october, ...monthWeeks("2026-11", SEED_EVENTS),
    ].flatMap((week) => week.segments).filter((segment) =>
        segment.event.id === "construction-utilities");
    assert(utilities.some((segment) =>
        segment.from === "2026-10-26" &&
        segment.to === "2026-10-31" && segment.span === 6 &&
        segment.column === 2));
    for (const rest of [
        "2026-10-25", "2026-11-01", "2026-11-08",
    ]) {
        const monday = addDays(rest, 1);
        assert(!utilities.some((segment) =>
            segment.from <= rest && rest <= segment.to), rest);
        assert(utilities.some((segment) =>
            segment.from <= monday && monday <= segment.to), monday);
    }
    assert(utilities.some((segment) =>
        segment.to === "2026-11-13" && !segment.after));
    const paint = monthWeeks("2027-01", SEED_EVENTS).flatMap((week) =>
        week.segments).find((segment) =>
        segment.event.id === "construction-paint");
    assert.equal(paint.from, "2026-12-28");
    assert.equal(paint.to, "2027-01-02");
    assert.equal(paint.span, 6);
    assert.equal(paint.before, true);
    for (const month of ["2026-10", "2026-11", "2026-12", "2027-01"]) {
        for (const segment of monthWeeks(month, SEED_EVENTS)
            .flatMap((week) => week.segments)) {
            if (segment.event.start === segment.event.end) continue;
            for (let day = dateNumber(segment.from);
                day <= dateNumber(segment.to); day++) {
                assert.equal(isSunday(dateString(day)), false,
                    `${segment.event.id} painted Sunday ${dateString(day)}`);
            }
        }
    }
    assert.deepEqual(
        [SEED_EVENTS[4].start, SEED_EVENTS[4].end],
        ["2026-10-19", "2026-11-13"]);
    const html = renderCalendar(sample.constructionCalendar, {
        ...calendarUI(), month: "2027-01",
    });
    assert.match(html, /師傅固定休假/);
    assert.match(html, /data-calendar-date="2027-02-05"[\s\S]*?除夕/);
    assert.match(html, /data-calendar-date="2027-02-06"[\s\S]*?春節初一/);
    assert.match(html, /data-calendar-event="construction-handover"/);
    assert.match(html, /完整工期（12 筆/);
    assert.doesNotMatch(html, /<\s*(?:img|image|foreignObject)\b|data:image/i);
});

test("expanded month range is event-derived, capped explicitly and view-only", () => {
    const pristine = structuredClone(publicWithRoles);
    const calendar = pristine.constructionCalendar;
    const ui = calendarUI();
    assert.equal(ui.expanded, false);
    assert.deepEqual(calendarMonthRange(calendar.events), {
        start: "2026-10", end: "2027-01", count: 4,
        months: ["2026-10", "2026-11", "2026-12", "2027-01"],
        limited: false,
    });
    assert.deepEqual(calendarMonthRange([]), {
        start: null, end: null, count: 0, months: [], limited: false,
    });
    assert.equal(MAX_EXPANDED_MONTHS, 24);
    ui.expanded = true;
    const html = renderCalendar(calendar, ui);
    assert.deepEqual([...html.matchAll(/data-calendar-month-view="(\d{4}-\d{2})"/g)]
        .map((match) => match[1]),
    ["2026-10", "2026-11", "2026-12", "2027-01"]);
    assert.equal((html.match(/class="calendar-scroll"/g) ?? []).length, 4);
    assert.match(html, /完整工期月份：2026-10～2027-01/);
    assert.match(html, /data-calendar-expand[\s\S]*?aria-pressed="true"/);
    assert.match(html, /data-calendar-event="construction-elevator-protection"/);
    assert.match(html, /class="calendar-person-icon"/);
    assert.deepEqual(pristine, publicWithRoles);
    const limited = calendarMonthRange([...calendar.events, {
        start: "2028-11-03", end: "2028-11-03",
    }]);
    assert.deepEqual([limited.start, limited.end, limited.count,
        limited.months.length, limited.limited],
    ["2026-10", "2028-11", 26, 0, true]);
    const capped = renderCalendar({
        ...calendar, events: [...calendar.events, {
            id: "far-away", title: "遠期工項", start: "2028-11-03",
            end: "2028-11-03", status: "tentative", note: "",
            attendees: [],
        }],
    }, ui);
    assert.match(capped, /2026-10～2028-11/);
    assert.match(capped, /超過完整展開上限 24 個月/);
    assert.doesNotMatch(capped, /data-calendar-month-view=/);
    ui.expanded = false;
    assert.equal((renderCalendar(calendar, ui)
        .match(/data-calendar-month-view=/g) ?? []).length, 1);
});

test("single-day Sunday exception is visible without changing stored dates or fee totals", () => {
    const special = {
        id: "manual-sunday", title: "臨時週日作業",
        start: "2026-10-25", end: "2026-10-25", status: "tentative",
        note: "", attendees: [],
    };
    const calendar = editCalendar(publicWithRoles.constructionCalendar,
        special);
    assert.equal(isSundayException(special), true);
    const sunday = monthWeeks("2026-10", calendar.events).flatMap((week) =>
        week.segments).find((segment) => segment.event.id === special.id);
    assert.deepEqual([sunday.from, sunday.to, sunday.column, sunday.span],
        ["2026-10-25", "2026-10-25", 1, 1]);
    assert.match(renderCalendar(calendar, {
        ...calendarUI(), month: "2026-10",
    }), /data-calendar-event="manual-sunday"[\s\S]*?週日例外安排/);
    assert.match(calendarCsv(calendar), /週日例外安排/);
    assert.match(calendarCsv(calendar), /原始日期與週日規則/);
    assert.match(calendarCsv(calendar), /起迄及完工日期不順延/);
    assert.match(CALENDAR_WORK_RULE, /週六及非週日假日不自動跳過/);
    assert.deepEqual(calendar.events.find((event) =>
        event.id === special.id), special);
    assert.equal(summarize({ ...publicWithRoles,
        constructionCalendar: calendar }).overallTotals.TWD, 2_322_060.2);
});

test("multi-day work starting or ending Sunday skips both Sunday edges across a year", () => {
    const boundary = {
        id: "cross-year", title: "跨年作業", start: "2026-12-27",
        end: "2027-01-03", status: "tentative", note: "",
    };
    assert.equal(isSundayException(boundary), false);
    for (const month of ["2026-12", "2027-01"]) {
        const segments = monthWeeks(month, [boundary]).flatMap((week) =>
            week.segments);
        assert.deepEqual(segments.map(({ from, to, column, span }) =>
            [from, to, column, span]),
        [["2026-12-28", "2027-01-02", 2, 6]]);
    }
    const weekend = {
        ...boundary, id: "weekend", start: "2026-10-24",
        end: "2026-10-25",
    };
    assert.deepEqual(monthWeeks("2026-10", [weekend]).flatMap((week) =>
        week.segments).map(({ from, to }) => [from, to]),
    [["2026-10-24", "2026-10-24"]]);
    assert.deepEqual([boundary.start, boundary.end],
        ["2026-12-27", "2027-01-03"]);
});

test("verified HKO lunar and Taiwan holiday anchors include January trailing February 5/6", () => {
    assert.deepEqual([REFERENCE_START, REFERENCE_END],
        ["2026-09-01", "2027-03-31"]);
    for (const [date, lunar] of [
        ["2026-10-09", "八月廿九"], ["2026-10-10", "九月初一"],
        ["2026-10-17", "九月初八"], ["2026-11-09", "十月初一"],
        ["2026-12-09", "十一月初一"], ["2026-12-22", "十一月十四"],
        ["2027-01-08", "十二月初一"],
        ["2027-02-05", "十二月廿九"],
        ["2027-02-06", "正月初一"],
    ]) assert.equal(lunarDate(date).full, lunar, date);
    assert.equal(lunarDay(30), "三十");
    assert.match(dayReference("2026-10-09").holiday, /補假/);
    assert.equal(dayReference("2026-12-22").term, "冬至");
    assert.equal(dayReference("2026-12-22").holiday, null);
    for (const date of [
        "2027-02-04", "2027-02-05", "2027-02-06",
        "2027-02-09", "2027-02-10", "2027-03-01",
    ]) assert(dayReference(date).holiday, date);
    assert.equal(dayReference("2027-02-04").term, "立春");
    assert.equal(dayReference("2027-02-05").holiday, "除夕");
    assert.equal(dayReference("2028-01-01").covered, false);
    assert.equal(dayReference("2028-01-01").holiday, null);
    const html = renderCalendar(sample.constructionCalendar, {
        ...calendarUI(), month: "2028-01",
    });
    assert.match(html, /目前月份在已核對的台灣假日及節氣範圍之外/);
});

test("edit, delete, calendar Undo and CSV are isolated from equipment and reject malformed data", () => {
    const original = structuredClone(sample.constructionCalendar);
    const added = {
        id: "test", title: "測試", start: "2028-02-29",
        end: "2028-03-02", note: "", status: "confirmed",
    };
    const created = editCalendar(original, added);
    const renamed = editCalendar(created, { ...added, title: "新名" });
    assert.equal(renamed.events.find((event) =>
        event.id === "test").title, "新名");
    assert.deepEqual(undoCalendar(renamed).events, created.events);
    const deleted = editCalendar(renamed, null, "test");
    assert.deepEqual(undoCalendar(deleted).events, renamed.events);
    assert.deepEqual(original, sample.constructionCalendar);
    assert.deepEqual(undoCalendar(original).events, []);
    assert.throws(() => undoCalendar(emptyCalendar()), /沒有/);
    assert.throws(() => editCalendar(original, null, "missing"), /找不到/);
    for (const change of [
        (calendar) => { calendar.events[0].start = "2027-02-29"; },
        (calendar) => { calendar.events[0].end = "2026-10-08"; },
        (calendar) => { calendar.events[0].title = " "; },
        (calendar) => { calendar.events[0].status = "done"; },
        (calendar) => { calendar.events.push(calendar.events[0]); },
        (calendar) => { calendar.events[0].unexpected = true; },
        (calendar) => { calendar.undo = [{}]; },
        (calendar) => { calendar.version = 2; },
        (calendar) => { calendar.seed = "unrecognized"; },
        (calendar) => { delete calendar.undo; },
    ]) {
        const value = structuredClone(original);
        change(value);
        assert.throws(() => validateCalendar(value), TypeError);
    }
    assert.throws(() =>
        validateState({ ...sample, constructionCalendar: null }),
    (error) => error instanceof StoreError && error.status === 400);
    const cloned = calendarFields(sample);
    cloned.constructionCalendar.events.pop();
    assert.equal(sample.constructionCalendar.events.length, 12);
    const csv = calendarCsv(original);
    assert.match(csv, /開工\.拆除確認/);
    assert.match(csv, /輕隔間隔單面牆/);
    assert.match(csv, /2027-01-30/);
    assert.equal(csv.split("\r\n").length, 14);
    const formula = editCalendar(original, {
        ...added, title: "=HYPERLINK(1,2)",
    });
    assert.match(calendarCsv(formula), /"'=HYPERLINK\(1,2\)"/);
});

test("container9 round-trips calendar and equipment Undo; historical 1–8 exports remain compatible", () => {
    const encoded = JSON.parse(encodeSave(sample));
    assert.equal(encoded.formatVersion, 9);
    assert.deepEqual(decodeSave(JSON.stringify(encoded)),
        { ...equipment(sample), constructionCalendar: sample.constructionCalendar });
    assert.equal(JSON.parse(encodeSave(before)).formatVersion, 8);
    const doorOnly = structuredClone(before);
    doorOnly.items = doorOnly.items.filter((item) =>
        item.id !== "living-auto-water-robot");
    assert.equal(JSON.parse(encodeSave(doorOnly)).formatVersion, 7);
    for (const version of [1, 2, 3, 4, 5]) {
        const older = {
            format: "renovation-equipment-planner",
            formatVersion: version,
            state: { version: 5, rooms: [], items: [], products: [], undo: null },
        };
        assert.doesNotThrow(() => decodeSave(JSON.stringify(older)));
    }
    const controlsOnly = structuredClone(doorOnly);
    controlsOnly.items.find((item) =>
        item.id === "quoted-switch-01").controlledLightIds =
        ["corridor-track-lighting"];
    for (const [formatVersion, state] of [
        [6, controlsOnly], [7, doorOnly], [8, before],
    ]) {
        assert.doesNotThrow(() => decodeSave(JSON.stringify({
            format: "renovation-equipment-planner",
            formatVersion, state,
        })));
    }
    for (const version of [1, 2, 3, 4, 5]) {
        assert.doesNotThrow(() => decodeSave(JSON.stringify({
            version, rooms: [], items: [], products: [],
        })));
    }
    assert.throws(() => decodeSave(JSON.stringify({
        ...encoded, state: before,
    })), /容器 9/);
    assert.throws(() => decodeSave(JSON.stringify({
        ...encoded, formatVersion: 8,
    })), /容器 9/);
    assert.throws(() => decodeSave(JSON.stringify({
        ...encoded, state: { ...sample, version: 4 },
    })), /v5/);
    assert.throws(() => encodeSave({
        ...sample, constructionCalendar: { ...sample.constructionCalendar,
            undo: [{}] },
    }), /工項/);
    assert.deepEqual(decodeSave(JSON.stringify(sample)).constructionCalendar,
        sample.constructionCalendar);
    assert.equal(itemListCsv(sample), itemListCsv(before));
});

test("temporary API store requires calendar writer capability, preserves both Undo paths and old data", async () => {
    const directory = await mkdtemp(join(tmpdir(), "public-calendar-"));
    try {
        const path = join(directory, "state.json");
        await writeFile(path, JSON.stringify(sample), "utf8");
        const store = createStore(path);
        const initial = await store.read();
        assert.deepEqual(initial.constructionCalendar,
            sample.constructionCalendar);
        const added = editCalendar(initial.constructionCalendar, {
            id: "test", title: "新增交付檢查", start: "2027-01-31",
            end: "2027-02-02", note: "", status: "tentative",
        });
        const candidate = { ...initial, constructionCalendar: added };
        await assert.rejects(() =>
            store.update(initial.revision - 1, {
                ...candidate, ...capabilities,
            }), (error) => error instanceof StoreError && error.status === 409);
        await assert.rejects(() =>
            store.update(initial.revision, {
                ...candidate, calendarFeatureVersion: undefined,
                controlRelationsVersion: 1, doorAllocationVersion: 1,
                robotFeatureVersion: 1,
            }), (error) => error instanceof StoreError &&
                error.status === 400 && /行事曆/.test(error.message));
        const saved = await store.update(initial.revision, {
            ...candidate, ...capabilities,
        });
        assert.equal(saved.revision, 1);
        assert.deepEqual(equipment(saved), equipment(initial));
        assert.equal(saved.constructionCalendar.events.length, 13);
        assert.deepEqual(saved.constructionCalendar.undo,
            initial.constructionCalendar.events);
        const bytes = await readFile(path, "utf8");
        await assert.rejects(() =>
            store.update(saved.revision, {
                ...withoutCalendar(saved), ...capabilities,
            }), (error) => error instanceof StoreError &&
                error.status === 400 && /漏存/.test(error.message));
        assert.equal(await readFile(path, "utf8"), bytes);
        const equipmentChanged = structuredClone(saved);
        equipmentChanged.rooms[0].name += "測試修改";
        equipmentChanged.undo = {
            rooms: saved.rooms, items: saved.items,
            products: saved.products,
        };
        const next = await store.update(saved.revision, {
            ...equipmentChanged, ...capabilities,
        });
        assert.deepEqual(next.constructionCalendar,
            saved.constructionCalendar);
        const equipmentRestored = await store.update(next.revision, {
            version: 5, ...next.undo, undo: null,
            ...calendarFields(next), ...capabilities,
        });
        assert.deepEqual(equipment(equipmentRestored),
            equipment(initial));
        assert.deepEqual(equipmentRestored.constructionCalendar,
            saved.constructionCalendar);
        const calendarRestored = await store.update(equipmentRestored.revision, {
            ...equipmentRestored,
            constructionCalendar: undoCalendar(
                equipmentRestored.constructionCalendar),
            ...capabilities,
        });
        assert.deepEqual(calendarRestored.constructionCalendar.events,
            initial.constructionCalendar.events);
        assert.deepEqual(equipment(calendarRestored),
            equipment(equipmentRestored));
        assert.equal(await readFile(file, "utf8"), raw);
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
});
