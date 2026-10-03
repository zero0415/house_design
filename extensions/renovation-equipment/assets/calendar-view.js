import {
    CALENDAR_WORK_RULE, calendarCsv, calendarWorkRule, dateNumber, dateString,
    editCalendar, emptyCalendar, isSunday, isSundayException, MAX_DATE,
    MIN_DATE, monthWeeks, normalizeAttendeeRoles, SUNDAY_EXCEPTION_LABEL,
    SUNDAY_REST_LABEL, taipeiToday, undoCalendar,
} from "./construction-calendar.js";
import {
    dayReference, REFERENCE_END, REFERENCE_SOURCES, REFERENCE_START,
} from "./calendar-reference.js";
import { downloadFile } from "./file-actions.js";

const escape = (value) => String(value ?? "").replace(/[&<>"']/g,
    (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;",
        '"': "&quot;", "'": "&#39;" })[char]);

const statusName = (event) => event.status === "confirmed"
    ? "已確認（使用者標記）" : "暫排／待確認";

const ownerIcon = `<svg class="calendar-person-icon"
    viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
    <circle cx="8" cy="4" r="2.5" fill="none"
        stroke="currentColor" stroke-width="1.7"/>
    <path d="M3 14v-2a5 5 0 0 1 10 0v2" fill="none"
        stroke="currentColor" stroke-width="1.7"/></svg>`;

function rolePills(roles = []) {
    const labels = roles.map((role) => role.trim()).filter(Boolean);
    return labels.length
        ? labels.map((role) =>
            `<span class="calendar-role${role === "屋主"
                ? " calendar-owner" : ""}">${role === "屋主"
                ? ownerIcon : ""}${escape(role)}</span>`).join(" ")
        : '<span class="calendar-roles-empty">未指定</span>';
}

export function calendarUI() {
    return {
        month: null, expanded: false, selectedDay: null, draft: null,
        changed: false, error: "", busy: false,
    };
}

export const MAX_EXPANDED_MONTHS = 24;

export function calendarMonthRange(events) {
    if (!events.length) {
        return { start: null, end: null, count: 0, months: [], limited: false };
    }
    const dates = events.flatMap((event) => [event.start, event.end]);
    dates.forEach(dateNumber);
    dates.sort();
    const start = dates[0].slice(0, 7);
    const end = dates.at(-1).slice(0, 7);
    const index = (month) =>
        Number(month.slice(0, 4)) * 12 + Number(month.slice(5)) - 1;
    const count = index(end) - index(start) + 1;
    const limited = count > MAX_EXPANDED_MONTHS;
    const months = limited ? [] : Array.from({ length: count }, (_, offset) => {
        const value = index(start) + offset;
        return `${Math.floor(value / 12)}-` +
            String(value % 12 + 1).padStart(2, "0");
    });
    return { start, end, count, months, limited };
}

function renderMonth(month, events, ui, today) {
    const weeks = monthWeeks(month, events);
    const focusDay = ui.selectedDay?.startsWith(month)
        ? ui.selectedDay : `${month}-01`;
    return `<section class="calendar-month-section"
        data-calendar-month-view="${month}"
        aria-labelledby="calendar-heading-${month}">
        <h3 id="calendar-heading-${month}" class="calendar-month-heading"
            ${ui.expanded ? "" : 'aria-live="polite"'}>
            ${escape(month.replace("-", "年"))}月</h3>
        <div class="calendar-scroll" tabindex="0" role="region"
            aria-label="${month}月份格線（可水平捲動，日期用方向鍵移動）">
            <div class="calendar-month" role="grid"
                aria-labelledby="calendar-heading-${month}">
                <div class="calendar-weekdays" role="row">
                    ${["日", "一", "二", "三", "四", "五", "六"]
                        .map((day) => `<span role="columnheader">週${day}</span>`)
                        .join("")}</div>
                ${weeks.map((week) => `<div class="calendar-week" role="row">
                    <div class="calendar-days">${week.days.map((date) => {
                        if (date < MIN_DATE || date > MAX_DATE) {
                            return '<div role="gridcell"></div>';
                        }
                        const ref = dayReference(date);
                        const announcements = [
                            ref.holiday, ref.term, ref.festival,
                            isSunday(date) ? SUNDAY_REST_LABEL : null,
                        ].filter(Boolean).join("、");
                        return `<div role="gridcell"
                            class="${date.slice(0, 7) !== month
                                ? "calendar-outside" : ""}
                                ${date === today ? "calendar-current-day" : ""}">
                            <button type="button" data-calendar-date="${date}"
                                tabindex="${date === focusDay ? 0 : -1}"
                                ${date === today ? 'aria-current="date"' : ""}
                                aria-label="${date}，農曆${escape(ref.lunar.full)}，
                                    ${escape(announcements)}，新增工項">
                                <span>${Number(date.slice(-2))}</span>
                                <small>${escape(ref.lunar.label)}</small>
                            </button>
                            ${isSunday(date) ? `<span class="calendar-sunday-rest">
                                ${SUNDAY_REST_LABEL}</span>` : ""}
                            ${ref.holiday ? `<span class="calendar-holiday"
                                title="政府辦公日曆參考，非本工地休工承諾">
                                ${escape(ref.holiday)}</span>` : ""}
                            ${ref.term ? `<span class="calendar-term">
                                ${escape(ref.term)}（節氣）</span>` : ""}
                            ${ref.festival ? `<span class="calendar-term">
                                ${escape(ref.festival)}</span>` : ""}
                        </div>`;
                    }).join("")}</div>
                    <div class="calendar-bars"
                        style="--calendar-lanes:${Math.max(week.lanes, 1)}">
                        ${week.segments.map((segment) =>
                            `<button type="button"
                                data-calendar-event="${escape(segment.event.id)}"
                                data-segment-start="${segment.from}"
                                data-segment-end="${segment.to}"
                                class="calendar-event ${segment.event.status}"
                                style="grid-column:${segment.column} / span ${segment.span};
                                    grid-row:${segment.lane + 1}"
                                aria-label="${escape(segment.event.title)}，
                                    ${segment.event.start}至${segment.event.end}原始含首尾日，
                                    ${statusName(segment.event)}，
                                    ${isSundayException(segment.event)
                                        ? SUNDAY_EXCEPTION_LABEL
                                        : segment.event.start === segment.event.end
                                            ? "單日工項"
                                            : "多日工項週日休假，日期不順延"}，
                                    預計出席：${escape(
                                        segment.event.attendees?.join("、") ||
                                        "未指定")}，編輯"
                                title="${escape(segment.event.title)}｜
                                    ${segment.event.start}～${segment.event.end}｜
                                    ${statusName(segment.event)}｜
                                    ${calendarWorkRule(segment.event)}">
                                <span class="calendar-event-title">
                                    ${segment.before ? "‹ " : ""}
                                    ${escape(segment.event.title)}
                                    ${segment.after ? " ›" : ""}
                                </span>
                                ${isSundayException(segment.event)
                                    ? `<span class="calendar-sunday-exception">
                                        ${SUNDAY_EXCEPTION_LABEL}</span>` : ""}
                                ${segment.event.attendees?.length
                                    ? `<span class="calendar-event-roles"
                                        aria-label="誰要出席（預計角色）">
                                        ${rolePills(segment.event.attendees)}
                                    </span>` : ""}
                            </button>`).join("")}
                    </div>
                </div>`).join("")}
            </div>
        </div>
    </section>`;
}

export function renderCalendar(value, ui) {
    const calendar = value ?? emptyCalendar();
    ui.month ??= calendar.events[0]?.start.slice(0, 7) ??
        taipeiToday().slice(0, 7);
    const today = taipeiToday();
    const range = ui.expanded ? calendarMonthRange(calendar.events) : null;
    const draft = ui.draft;
    const all = [...calendar.events].sort((a, b) =>
        a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
    const outside = ui.expanded
        ? range.start != null &&
            (range.start < REFERENCE_START.slice(0, 7) ||
                range.end > REFERENCE_END.slice(0, 7))
        : ui.month < REFERENCE_START.slice(0, 7) ||
            ui.month > REFERENCE_END.slice(0, 7);
    return `<section class="construction-calendar" aria-label="開工行事曆">
        <h2>開工行事曆</h2>
        <p>這是可修改的暫排工期草稿，非承包商承諾；日期採台北日曆日。
            「已確認」僅表示使用者自行標記。
            日曆復原與設備上一步各自獨立，不影響報價。</p>
        <p class="calendar-work-rule">${CALENDAR_WORK_RULE}
            使用者安排的單日週日工項仍顯示，標記
            「${SUNDAY_EXCEPTION_LABEL}」。</p>
        <p>出席角色為預計應到／待確認，非已確認出席或廠商承諾；
            未指定的工項不猜填人員。</p>
        ${!value ? `<p data-calendar-empty>此存檔尚未建立日曆；
            舊瀏覽器資料不會自動套用新版範例工期。可新增自己的工項，
            或先匯出舊存檔，再自行決定是否手動匯入新版匿名示例。</p>` : ""}
        <nav class="calendar-navigation" aria-label="切換月份">
            <button type="button" data-calendar-expand
                aria-pressed="${ui.expanded}" aria-controls="calendar-month-views">
                ${ui.expanded ? "返回單月檢視" : "完整展開"}</button>
            ${!ui.expanded ? `<button type="button" data-calendar-month="-1"
                ${ui.month === "1901-01" ? "disabled" : ""}
                aria-label="上一個月">← 上月</button>
                <label>月份 <input type="month" data-calendar-month-input
                    min="1901-01" max="2099-12"
                    value="${escape(ui.month)}"></label>
                <button type="button" data-calendar-month="1"
                    ${ui.month === "2099-12" ? "disabled" : ""}
                    aria-label="下一個月">下月 →</button>
                <button type="button" data-calendar-today>今天</button>` : ""}
            <button type="button" data-calendar-new>＋ 新增工項</button>
            <button type="button" data-calendar-undo
                ${calendar.undo === null ? "disabled" : ""}>還原日曆上一步</button>
            <button type="button" data-calendar-csv>匯出工期 CSV</button>
        </nav>
        <p class="calendar-error" role="alert">${escape(ui.error)}</p>
        ${draft ? `<form class="calendar-editor" data-calendar-form>
            <h3>${calendar.events.some((entry) =>
                entry.id === draft.id) ? "編輯" : "新增"}工項</h3>
            <label>名稱 <input name="title" maxlength="120" required
                value="${escape(draft.title)}"></label>
            <label>開始日期（原始） <input type="date" name="start"
                min="${MIN_DATE}" max="${MAX_DATE}" required
                value="${escape(draft.start)}"></label>
            <label>結束日期（原始含當日） <input type="date" name="end"
                min="${MIN_DATE}" max="${MAX_DATE}" required
                value="${escape(draft.end)}"></label>
            <label>狀態 <select name="status">
                <option value="tentative"
                    ${draft.status === "tentative" ? "selected" : ""}>
                    暫排（待確認）</option>
                <option value="confirmed"
                    ${draft.status === "confirmed" ? "selected" : ""}>
                    已確認（自行標記）</option>
            </select></label>
            <label class="calendar-note">備註 <textarea name="note"
                maxlength="2000" rows="3">${escape(draft.note)}</textarea></label>
            <p class="calendar-work-rule">${CALENDAR_WORK_RULE}
                單日週日工項會標為「${SUNDAY_EXCEPTION_LABEL}」。
                歷史備註保留原文；本頁只改施工段落顯示，
                不改寫原始日期或備註。</p>
            <label class="calendar-note">誰要出席（預計角色）
                <textarea name="attendees" rows="3" maxlength="1000"
                    placeholder="每行一個角色，例如：屋主"
                    aria-describedby="calendar-roles-help">${escape(
                        (draft.attendees ?? []).join("\n"))}</textarea>
            </label>
            <p id="calendar-roles-help">每行一個角色，可新增、修改或刪除整行；
                最多 20 個角色、每個 40 字，不填實際姓名或人數。
                空白＝未指定；這是預計出席，非回覆或到場承諾，
                也不改變工項暫排狀態。</p>
            <div class="calendar-role-preview" aria-label="誰要出席預覽">
                ${rolePills(draft.attendees)}
            </div>
            <div><button type="submit">儲存工項</button>
                <button type="button" data-calendar-cancel>取消編輯</button>
                ${calendar.events.some((entry) => entry.id === draft.id)
                    ? '<button type="button" data-calendar-delete>刪除此工項</button>'
                    : ""}</div>
            <p>表單送出前不會儲存；若儲存失敗會保留所填內容。
                設備的「還原上一步」不復原日曆。</p>
        </form>` : ""}
        <p class="calendar-coverage">${outside
            ? ui.expanded
                ? "展開的工期含未核對的台灣假日及節氣月份；空白不代表工作日。"
                : "目前月份在已核對的台灣假日及節氣範圍之外；空白不代表工作日。"
            : "相鄰月份格子如超出核對範圍，空白不代表工作日。"}
            假日／節氣核對範圍：${REFERENCE_START}～${REFERENCE_END}；
            農曆按台北日期顯示。</p>
        <p>虛線米色工項＝暫排；實線綠色工項＝使用者已確認。
            各月格線可各自左右捲動；完整名稱與原始日期列於下方清單。</p>
        <div id="calendar-month-views">
            ${ui.expanded ? `<p class="calendar-range" role="status">
                ${range.count
                    ? `完整工期月份：${range.start}～${range.end}（共
                        ${range.count} 個月）。`
                    : "尚無工項，沒有可展開的工期月份；可新增工項或返回單月檢視。"}
                ${range.limited
                    ? `超過完整展開上限 ${MAX_EXPANDED_MONTHS} 個月，
                        未顯示任何月份，沒有截短工期。
                        請返回單月檢視，使用月份選擇器查閱任意月份。`
                    : "各月依序向下排列，每張格線可各自左右捲動；此切換不儲存或更動工項。"}
            </p>` : ""}
            ${(ui.expanded ? range.months : [ui.month])
                .map((month) => renderMonth(month, calendar.events, ui, today))
                .join("")}
        </div>
        <section class="calendar-agenda" aria-label="完整工項清單">
            <h3>完整工期（${all.length} 筆；不只目前月份）</h3>
            ${all.length ? `<ol>${all.map((event) =>
                `<li><button type="button" data-calendar-event="${escape(event.id)}">
                    ${escape(event.title)}</button>
                    <span>${event.start} ～ ${event.end}（原始含首尾） ·
                        ${statusName(event)}</span>
                    <span class="calendar-work-rule">
                        ${isSundayException(event)
                            ? SUNDAY_EXCEPTION_LABEL
                            : "師傅固定休假：每週日；多日工項不含週日施工段落"}；
                        起迄日期不順延。
                    </span>
                    <div class="calendar-attendees"
                        aria-label="誰要出席（預計角色）">
                        誰要出席：${rolePills(event.attendees)}
                    </div></li>`).join("")}</ol>`
                : "<p>尚無工項。</p>"}
        </section>
        <details class="calendar-sources">
            <summary>台灣假日、農曆／節氣來源與範圍</summary>
            <p>政府行政機關休假／補假與節氣參考僅收錄
                ${REFERENCE_START} 至 ${REFERENCE_END}，
                範圍外未核對，空白不代表上班日。
                週日休假標記與多日工項週日不畫施工段落只是本示例的顯示規則；
                實際工地／民間企業休工須依合約、勞動法令與承包商安排，
                不由此表保證。
                重陽屬節日標記、冬至等屬節氣，均不據此宣稱放假。</p>
            <p>上述範圍的繁體農曆日／月採香港天文台 UTC+8
                已核對月首表；範圍外使用瀏覽器 Intl 中國曆與台北時區
                計算（未逐日核對）。全離線運算，無 Google 登入、
                同步或外部 API；來源連結只有手動開啟才連網。</p>
            <ul>${REFERENCE_SOURCES.map(([label, url]) =>
                `<li><a href="${escape(url)}" target="_blank"
                    rel="noopener noreferrer">${escape(label)}</a></li>`).join("")}</ul>
        </details>
    </section>`;
}

export function bindCalendar(root, calendar, ui, { render, save, report }) {
    const redraw = (focus) => {
        render();
        if (focus) document.querySelector(focus)?.focus();
    };
    const discard = () => !ui.changed ||
        window.confirm("捨棄尚未儲存的工項表單？");
    const begin = (date, event) => {
        if (!discard()) return;
        ui.draft = event ? structuredClone(event) : {
            id: `calendar-${crypto.randomUUID()}`, title: "",
            start: date, end: date, note: "", status: "tentative",
        };
        ui.draft.attendees ??= [];
        ui.changed = false;
        ui.error = "";
        redraw('[data-calendar-form] [name="title"]');
    };
    const persist = async (next) => {
        if (ui.busy) return;
        ui.busy = true;
        root.inert = true;
        try {
            await save(next);
            ui.draft = null;
            ui.changed = false;
            ui.error = "";
        } catch (error) {
            ui.error = error.message;
            report(error.message, "error");
        } finally {
            ui.busy = false;
            redraw(ui.error
                ? '[data-calendar-form] [name="title"]'
                : "[data-calendar-new]");
        }
    };
    root.addEventListener("input", (event) => {
        if (event.target.form?.matches("[data-calendar-form]")) {
            if (event.target.name === "attendees") {
                ui.draft.attendees = event.target.value.split(/\r?\n/);
                root.querySelector(".calendar-role-preview").innerHTML =
                    rolePills(ui.draft.attendees);
            } else {
                ui.draft[event.target.name] = event.target.value;
            }
            ui.changed = true;
        }
    });
    root.addEventListener("change", (event) => {
        if (!event.target.matches("[data-calendar-month-input]")) return;
        try {
            dateNumber(`${event.target.value}-01`);
            ui.month = event.target.value;
            ui.selectedDay = `${ui.month}-01`;
            ui.error = "";
        } catch (error) {
            ui.error = error.message;
        }
        redraw("[data-calendar-month-input]");
    });
    root.addEventListener("submit", (event) => {
        event.preventDefault();
        event.stopPropagation();
        try {
            void persist(editCalendar(calendar, {
                ...ui.draft,
                attendees: normalizeAttendeeRoles(ui.draft.attendees ?? []),
            }));
        } catch (error) {
            ui.error = error.message;
            redraw(/出席角色|誰要出席/.test(error.message)
                ? '[data-calendar-form] [name="attendees"]'
                : '[data-calendar-form] [name="start"]');
        }
    });
    root.addEventListener("click", (event) => {
        const button = event.target.closest("button");
        if (!button || ui.busy) return;
        try {
            if (button.hasAttribute("data-calendar-expand")) {
                ui.expanded = !ui.expanded;
                ui.error = "";
                redraw("[data-calendar-expand]");
            } else if (button.hasAttribute("data-calendar-event")) {
                const entry = calendar?.events.find((item) =>
                    item.id === button.dataset.calendarEvent);
                if (!entry) throw new Error("工項已不存在，請重新載入。");
                begin(entry.start, entry);
            } else if (button.hasAttribute("data-calendar-date")) {
                begin(button.dataset.calendarDate);
            } else if (button.hasAttribute("data-calendar-new")) {
                begin(ui.selectedDay ?? `${ui.month}-01`);
            } else if (button.hasAttribute("data-calendar-cancel")) {
                if (discard()) {
                    ui.draft = null;
                    ui.changed = false;
                    ui.error = "";
                    redraw("[data-calendar-new]");
                }
            } else if (button.hasAttribute("data-calendar-delete")) {
                if (window.confirm("刪除此工項？可用「還原日曆上一步」復原，不影響設備。")) {
                    void persist(editCalendar(calendar, null, ui.draft.id));
                }
            } else if (button.hasAttribute("data-calendar-undo")) {
                if (discard()) void persist(undoCalendar(calendar));
            } else if (button.hasAttribute("data-calendar-csv")) {
                downloadFile(`開工工期-${ui.month}.csv`,
                    calendarCsv(calendar ?? emptyCalendar()),
                    "text/csv;charset=utf-8");
            } else if (button.hasAttribute("data-calendar-month") ||
                button.hasAttribute("data-calendar-today")) {
                const date = new Date(`${ui.month}-01T00:00:00Z`);
                date.setUTCMonth(date.getUTCMonth() +
                    Number(button.dataset.calendarMonth ?? 0));
                ui.month = button.hasAttribute("data-calendar-today")
                    ? taipeiToday().slice(0, 7)
                    : date.toISOString().slice(0, 7);
                ui.selectedDay = `${ui.month}-01`;
                redraw("[data-calendar-month-input]");
            }
        } catch (error) {
            ui.error = error.message;
            report(error.message, "error");
            redraw();
        }
    });
    root.addEventListener("keydown", (event) => {
        const button = event.target.closest("[data-calendar-date]");
        if (!button || !["ArrowLeft", "ArrowRight", "ArrowUp",
            "ArrowDown", "Home", "End"].includes(event.key)) return;
        event.preventDefault();
        const date = dateNumber(button.dataset.calendarDate);
        const weekday = new Date(date * 86_400_000).getUTCDay();
        const offset = {
            ArrowLeft: -1, ArrowRight: 1,
            ArrowUp: -7, ArrowDown: 7,
            Home: -weekday, End: 6 - weekday,
        }[event.key];
        const next = dateString(date + offset);
        if (next < MIN_DATE || next > MAX_DATE) return;
        const nextMonth = next.slice(0, 7);
        const currentMonth = button.closest(
            "[data-calendar-month-view]")?.dataset.calendarMonthView;
        if (ui.expanded &&
            !root.querySelector(
                `[data-calendar-month-view="${nextMonth}"] ` +
                `[data-calendar-date="${next}"]`) &&
            !root.querySelector(
                `[data-calendar-month-view="${currentMonth}"] ` +
                `[data-calendar-date="${next}"]`)) return;
        ui.selectedDay = next;
        ui.month = nextMonth;
        render();
        const rendered = document.querySelector(".construction-calendar");
        const focusMonth = ui.expanded
            ? rendered?.querySelector(
                `[data-calendar-month-view="${ui.month}"]`) ??
                rendered?.querySelector(
                    `[data-calendar-month-view="${currentMonth}"]`)
            : rendered;
        focusMonth?.querySelector(
            `[data-calendar-date="${next}"]`)?.focus();
    });
}
