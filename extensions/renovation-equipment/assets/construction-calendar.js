export const CALENDAR_VERSION = 1;
export const CALENDAR_ATTENDEES_VERSION = 1;
export const CALENDAR_SEED = "public-construction-draft-2026-10-v1";
export const MIN_DATE = "1901-01-01";
export const MAX_DATE = "2099-12-31";

const DAY_MS = 86_400_000;
const own = (value, key) =>
    Object.prototype.hasOwnProperty.call(value ?? {}, key);

export const hasCalendar = (state) => own(state, "constructionCalendar");
export const hasCalendarAttendees = (state) =>
    state?.constructionCalendar?.version === 2;
export const calendarFields = (state) => hasCalendar(state)
    ? { constructionCalendar: structuredClone(state.constructionCalendar) } : {};

export function dateNumber(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
        value < MIN_DATE || value > MAX_DATE) {
        throw new TypeError("日期須為 1901–2099 年的 YYYY-MM-DD。");
    }
    const time = Date.parse(`${value}T00:00:00Z`);
    if (!Number.isFinite(time) ||
        new Date(time).toISOString().slice(0, 10) !== value) {
        throw new TypeError("日期不存在，請檢查月份、天數與閏年。");
    }
    return time / DAY_MS;
}

export function dateString(number) {
    if (!Number.isSafeInteger(number)) {
        throw new TypeError("日期序號須為完整的日數。");
    }
    return new Date(number * DAY_MS).toISOString().slice(0, 10);
}

export const addDays = (value, days) => dateString(dateNumber(value) + days);
export const isSunday = (value) =>
    new Date(dateNumber(value) * DAY_MS).getUTCDay() === 0;
export const isSundayException = (event) =>
    event.start === event.end && isSunday(event.start);
export const SUNDAY_REST_LABEL = "師傅固定休假";
export const SUNDAY_EXCEPTION_LABEL = "週日例外安排";
export const CALENDAR_WORK_RULE =
    "日期為原始含首尾範圍，非連續工作日；每週日師傅固定休假，" +
    "多日工項週日不顯示施工段落。週六及非週日假日不自動跳過，" +
    "起迄及完工日期不順延。";
export const calendarWorkRule = (event) => isSundayException(event)
    ? `${CALENDAR_WORK_RULE} 此筆為週日例外安排（使用者單日工項）。`
    : CALENDAR_WORK_RULE;

export function taipeiToday(now = new Date()) {
    const parts = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Taipei",
        year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(now);
    const part = (type) => parts.find((entry) => entry.type === type)?.value;
    if (!part("year") || !part("month") || !part("day")) {
        throw new RangeError("無法取得台北日期。");
    }
    return `${part("year")}-${part("month")}-${part("day")}`;
}

function exactObject(value, keys, label) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).some((key) => !keys.includes(key))) {
        throw new TypeError(`${label}格式或欄位無效。`);
    }
}

function text(value, max, label, required = false) {
    if (typeof value !== "string" || value.length > max ||
        (required && !value.trim())) {
        throw new TypeError(`${label}${required ? "不可空白且" : ""}須為最多 ${max} 字文字。`);
    }
    return value;
}

export function validateAttendeeRoles(roles) {
    if (!Array.isArray(roles) || roles.length > 20) {
        throw new TypeError("誰要出席須為最多 20 個角色標籤。");
    }
    const seen = new Set();
    return roles.map((role) => {
        text(role, 40, "出席角色", true);
        if (role !== role.trim() || /[\r\n\t]/.test(role)) {
            throw new TypeError("出席角色需去除前後空白，且每個標籤限一行。");
        }
        if (/\p{N}|[零〇一二三四五六七八九十百兩两]+[人位名]/u.test(role)) {
            throw new TypeError(
                "誰要出席只填角色，不填人數；例如可填「屋主」。"
            );
        }
        const key = role.toLocaleLowerCase("zh-TW");
        if (seen.has(key)) {
            throw new TypeError(`出席角色重複：${role}。請合併後再儲存。`);
        }
        seen.add(key);
        return role;
    });
}

export function normalizeAttendeeRoles(roles) {
    if (!Array.isArray(roles) ||
        roles.some((role) => typeof role !== "string")) {
        throw new TypeError("出席角色須為文字清單。");
    }
    return validateAttendeeRoles(roles.map((role) =>
        role.trim()).filter(Boolean));
}

export function validateEvents(events, version = 1) {
    if (!Array.isArray(events) || events.length > 500) {
        throw new TypeError("行事曆最多 500 筆工項，且須為陣列。");
    }
    const ids = new Set();
    return events.map((event) => {
        exactObject(event, ["id", "title", "start", "end", "note", "status",
            ...(version === 2 ? ["attendees"] : [])], "工項");
        if (typeof event.id !== "string" ||
            !/^[a-zA-Z0-9_-]{1,80}$/.test(event.id) || ids.has(event.id)) {
            throw new TypeError("工項 ID 無效或重複。");
        }
        ids.add(event.id);
        if (dateNumber(event.start) > dateNumber(event.end)) {
            throw new TypeError("結束日期不得早於開始日期（含首尾日）。");
        }
        if (!["tentative", "confirmed"].includes(event.status)) {
            throw new TypeError("工項狀態須為暫排或已確認。");
        }
        return {
            id: event.id,
            title: text(event.title, 120, "工項名稱", true),
            start: event.start,
            end: event.end,
            note: text(event.note, 2000, "工項備註"),
            status: event.status,
            ...(version === 2 ? {
                attendees: validateAttendeeRoles(event.attendees),
            } : {}),
        };
    });
}

export function validateCalendar(value) {
    exactObject(value, ["version", "seed", "events", "undo"], "行事曆");
    if (![CALENDAR_VERSION, 2].includes(value.version) ||
        ![null, CALENDAR_SEED].includes(value.seed)) {
        throw new TypeError("行事曆版本或來源標記不相容。");
    }
    if (!own(value, "undo")) {
        throw new TypeError("行事曆缺少獨立復原欄位。");
    }
    return {
        version: value.version,
        seed: value.seed,
        events: validateEvents(value.events, value.version),
        undo: value.undo === null ? null :
            validateEvents(value.undo, value.version),
    };
}

export function guardCalendarUpdate(current, candidate) {
    if ((hasCalendar(current) || hasCalendar(candidate)) &&
        candidate?.calendarFeatureVersion !== CALENDAR_VERSION) {
        throw new TypeError(
            "此存檔含開工行事曆與獨立復原；舊版不能寫入，請重新載入新版。"
        );
    }
    if (hasCalendar(current) && !hasCalendar(candidate)) {
        throw new TypeError(
            "不得漏存既有行事曆；讀取舊檔時請保留目前的行事曆。"
        );
    }
    if (hasCalendarAttendees(current) || hasCalendarAttendees(candidate)) {
        if (candidate?.calendarAttendeesVersion !==
            CALENDAR_ATTENDEES_VERSION) {
            throw new TypeError(
                "此行事曆含出席角色（含復原）；舊版不能寫入，請重新載入支援角色的版本。"
            );
        }
        if (!hasCalendarAttendees(candidate)) {
            throw new TypeError(
                "不得降版或漏存出席角色與日曆復原。"
            );
        }
    }
}

export const emptyCalendar = () => ({
    version: CALENDAR_VERSION, seed: null, events: [], undo: null,
});

export function upgradeCalendarAttendees(current) {
    const calendar = validateCalendar(current);
    if (calendar.version === 2) return calendar;
    return {
        ...calendar, version: 2,
        events: calendar.events.map((event) =>
            ({ ...event, attendees: [] })),
        undo: calendar.undo?.map((event) =>
            ({ ...event, attendees: [] })) ?? null,
    };
}

export function importCalendarAttendees(current, imported) {
    const calendar = validateCalendar(imported);
    if (current?.version !== 2 || calendar.version === 2) return calendar;
    const upgraded = upgradeCalendarAttendees(calendar);
    return {
        ...upgraded,
        events: upgraded.events.map((event) => ({
            ...event,
            attendees: [...(current.events.find((previous) =>
                previous.id === event.id)?.attendees ?? [])],
        })),
    };
}

export function editCalendar(current, event, removeId = null) {
    let calendar = validateCalendar(current ?? emptyCalendar());
    if (!removeId && own(event, "attendees") && calendar.version === 1) {
        const roles = validateAttendeeRoles(event.attendees);
        if (roles.length) calendar = upgradeCalendarAttendees(calendar);
        else {
            const { attendees: _attendees, ...legacyEvent } = event;
            event = legacyEvent;
        }
    }
    if (removeId && !calendar.events.some((entry) => entry.id === removeId)) {
        throw new TypeError("找不到要刪除的工項。");
    }
    const events = calendar.events.filter((entry) =>
        entry.id !== (removeId ?? event?.id));
    if (!removeId) events.push(...validateEvents([event], calendar.version));
    return {
        ...calendar, events: validateEvents(events, calendar.version),
        undo: structuredClone(calendar.events),
    };
}

export function undoCalendar(current) {
    const calendar = validateCalendar(current);
    if (!calendar.undo) throw new TypeError("沒有可還原的行事曆變更。");
    return { ...calendar, events: calendar.undo, undo: null };
}

const SEED_NOTE = "依使用者授權之工期清單暫排，未經承包商確認；" +
    "日期含首尾日，不自動避開週末或假日。";
export const SEED_EVENTS = Object.freeze([
    ["start", "開工.拆除確認", "2026-10-09", "2026-10-09"],
    ["demolition", "拆除施工", "2026-10-13", "2026-10-16"],
    ["layout", "水電放樣", "2026-10-17", "2026-10-17"],
    ["wall", "輕隔間隔單面牆", "2026-10-17", "2026-10-17"],
    ["utilities", "水電施工", "2026-10-19", "2026-11-13"],
    ["masonry", "泥作施工", "2026-11-16", "2026-12-11"],
    ["ceiling", "輕隔間及天花板", "2026-12-14", "2026-12-18"],
    ["paint", "油漆施工", "2026-12-21", "2027-01-15"],
    ["cabinets", "廚具.系統櫃體安裝", "2027-01-18", "2027-01-23"],
    ["owner-install", "水電自備項目安裝(燈具.衛浴設備等)", "2027-01-25", "2027-01-27"],
    ["clean", "全室清潔", "2027-01-28", "2027-01-29"],
    ["handover", "油漆最終收尾及完工點交", "2027-01-30", "2027-01-30"],
].map(([id, title, start, end]) => Object.freeze({
    id: `construction-${id}`, title, start, end,
    status: "tentative",
    note: SEED_NOTE + (id === "handover"
        ? "使用者指定 1 月 30 日單日暫排里程碑，實際完工日期仍待確認。"
        : ""),
})));

export function monthWeeks(month, events = []) {
    const version = events.some((event) =>
        own(event, "attendees")) ? 2 : 1;
    const validated = validateEvents(events, version);
    const first = dateNumber(`${month}-01`);
    const next = new Date(first * DAY_MS);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const last = next.getTime() / DAY_MS - 1;
    const start = first - new Date(first * DAY_MS).getUTCDay();
    const weeks = [];
    for (let day = start; day <= last; day += 7) {
        const occupied = [];
        const segments = validated.filter((event) =>
            dateNumber(event.start) <= day + 6 &&
            dateNumber(event.end) >= day).sort((a, b) =>
            a.start.localeCompare(b.start) ||
            b.end.localeCompare(a.end) ||
            a.id.localeCompare(b.id)).flatMap((event) => {
            const from = Math.max(day +
                (event.start === event.end ? 0 : 1),
            dateNumber(event.start));
            const to = Math.min(day + 6, dateNumber(event.end));
            if (from > to) return [];
            let lane = 0;
            while (occupied[lane]?.some(([a, b]) =>
                from <= b && to >= a)) lane++;
            (occupied[lane] ??= []).push([from, to]);
            return [{
                event, from: dateString(from), to: dateString(to),
                column: from - day + 1, span: to - from + 1, lane,
                before: event.start < dateString(from),
                after: event.end > dateString(to),
            }];
        });
        weeks.push({
            days: Array.from({ length: 7 }, (_, index) =>
                dateString(day + index)),
            segments, lanes: occupied.length,
        });
    }
    return weeks;
}

export function calendarCsv(calendar) {
    calendar = validateCalendar(calendar);
    const withRoles = calendar.version === 2;
    const cell = (value) => {
        const textValue = String(value ?? "");
        const safe = /^\s*[=+\-@\t\r]/.test(textValue)
            ? `'${textValue}` : textValue;
        return `"${safe.replaceAll('"', '""')}"`;
    };
    const rows = [
        ["工項ID", "名稱", "開始（台北日期）", "結束（含當日）",
            "狀態", "備註", "原始日期與週日規則",
            ...(withRoles ? ["誰要出席（預計角色）"] : [])],
        ...calendar.events.map((event) => [
            event.id, event.title, event.start, event.end,
            event.status === "tentative"
                ? "暫排（待確認）" : "已確認（使用者標記）",
            event.note, calendarWorkRule(event),
            ...(withRoles ? [event.attendees.length
                ? event.attendees.join("、") : "未指定"] : []),
        ]),
    ];
    return "\ufeff" + rows.map((row) =>
        row.map(cell).join(",")).join("\r\n") + "\r\n";
}
