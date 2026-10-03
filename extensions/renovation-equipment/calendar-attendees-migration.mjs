import { assertReviewedPublicState } from "./door-migration.mjs";
import {
    CALENDAR_SEED, upgradeCalendarAttendees, validateCalendar,
} from "./assets/construction-calendar.js";

export function migrateCalendarAttendees(latest) {
    if (latest?.version !== 5) {
        throw new TypeError("出席角色遷移須使用最新的公開 v5 資料。");
    }
    assertReviewedPublicState(latest);
    const calendar = validateCalendar(latest.constructionCalendar);
    if (calendar.version === 2) {
        return { changed: false, state: structuredClone(latest) };
    }
    if (calendar.seed !== CALENDAR_SEED ||
        !calendar.events.some((event) =>
            event.id === "construction-layout")) {
        throw new TypeError(
            "找不到已核對來源的水電放樣工項；拒絕猜測或覆蓋其他行事曆。"
        );
    }
    const upgraded = upgradeCalendarAttendees(calendar);
    const state = structuredClone(latest);
    state.constructionCalendar = validateCalendar({
        ...upgraded,
        events: upgraded.events.map((event) =>
            event.id === "construction-layout"
                ? {
                    ...event,
                    attendees: ["屋主", "廚房工人", "系統櫃工人"],
                } : event),
        undo: structuredClone(upgraded.events),
    });
    assertReviewedPublicState(state);
    return { changed: true, state };
}
