import { assertReviewedPublicState } from "./door-migration.mjs";
import {
    CALENDAR_SEED, hasCalendar, SEED_EVENTS, validateCalendar,
} from "./assets/construction-calendar.js";

export function migrateConstructionCalendar(latest) {
    if (latest?.version !== 5) {
        throw new TypeError("行事曆遷移須使用最新的公開 v5 資料。");
    }
    assertReviewedPublicState(latest);
    if (hasCalendar(latest)) {
        if (latest.constructionCalendar.seed !== CALENDAR_SEED) {
            throw new TypeError("已有其他行事曆，拒絕覆蓋自訂工期。");
        }
        return { changed: false, state: structuredClone(latest) };
    }
    const state = structuredClone(latest);
    state.constructionCalendar = validateCalendar({
        version: 1,
        seed: CALENDAR_SEED,
        events: structuredClone(SEED_EVENTS),
        undo: [],
    });
    assertReviewedPublicState(state);
    return { changed: true, state };
}
