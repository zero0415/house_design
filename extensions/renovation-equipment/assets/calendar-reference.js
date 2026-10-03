import { dateNumber } from "./construction-calendar.js";

export const REFERENCE_START = "2026-09-01";
export const REFERENCE_END = "2027-03-31";
export const REFERENCE_SOURCES = Object.freeze([
    ["行政院人事行政總處 115 年辦公日曆（2026）",
        "https://www.dgpa.gov.tw/information?uid=30&pid=12573"],
    ["行政院人事行政總處 116 年辦公日曆（2027）",
        "https://www.dgpa.gov.tw/information?uid=30&pid=12982"],
    ["香港天文台 2026 公農曆／節氣對照",
        "https://www.hko.gov.hk/tc/gts/time/calendar/text/files/T2026c.txt"],
    ["香港天文台 2027 公農曆／節氣對照",
        "https://www.hko.gov.hk/tc/gts/time/calendar/text/files/T2027c.txt"],
]);

const holidays = Object.freeze({
    "2026-09-25": "中秋節",
    "2026-09-28": "孔子誕辰紀念日／教師節",
    "2026-10-09": "國慶日補假",
    "2026-10-10": "國慶日",
    "2026-10-25": "臺灣光復暨金門古寧頭大捷紀念日",
    "2026-10-26": "光復暨古寧頭大捷紀念日補假",
    "2026-12-25": "行憲紀念日",
    "2027-01-01": "中華民國開國紀念日／元旦",
    "2027-02-04": "除夕前一日",
    "2027-02-05": "除夕",
    "2027-02-06": "春節初一",
    "2027-02-07": "春節初二",
    "2027-02-08": "春節初三",
    "2027-02-09": "春節補假",
    "2027-02-10": "春節補假",
    "2027-02-28": "和平紀念日",
    "2027-03-01": "和平紀念日補假",
});

const terms = Object.freeze({
    "2026-09-07": "白露",
    "2026-09-23": "秋分",
    "2026-10-08": "寒露",
    "2026-10-23": "霜降",
    "2026-11-07": "立冬",
    "2026-11-22": "小雪",
    "2026-12-07": "大雪",
    "2026-12-22": "冬至",
    "2027-01-05": "小寒",
    "2027-01-20": "大寒",
    "2027-02-04": "立春",
    "2027-02-19": "雨水",
    "2027-03-06": "驚蟄",
    "2027-03-21": "春分",
});

const lunarFormatter = new Intl.DateTimeFormat("zh-TW-u-ca-chinese", {
    timeZone: "Asia/Taipei", month: "long", day: "numeric",
});
const digits = ["", "一", "二", "三", "四", "五", "六", "七", "八", "九"];

// Month starts checked against the Hong Kong Observatory UTC+8 date tables.
const verifiedMonths = Object.freeze([
    ["2026-08-13", "七月"], ["2026-09-11", "八月"],
    ["2026-10-10", "九月"], ["2026-11-09", "十月"],
    ["2026-12-09", "十一月"], ["2027-01-08", "十二月"],
    ["2027-02-06", "正月"], ["2027-03-08", "二月"],
]);

export function lunarDay(day) {
    if (!Number.isInteger(day) || day < 1 || day > 30) {
        throw new TypeError("農曆日期資料不完整。");
    }
    if (day <= 9) return `初${digits[day]}`;
    if (day === 10) return "初十";
    if (day < 20) return `十${digits[day - 10]}`;
    if (day === 20) return "二十";
    if (day < 30) return `廿${digits[day - 20]}`;
    return "三十";
}

export function lunarDate(date) {
    dateNumber(date);
    if (date >= REFERENCE_START && date <= REFERENCE_END) {
        const [start, month] = verifiedMonths.findLast(([first]) => first <= date);
        const day = dateNumber(date) - dateNumber(start) + 1;
        const label = lunarDay(day);
        return {
            month, day, label: day === 1 ? month : label,
            full: `${month}${label}`,
        };
    }
    if (lunarFormatter.resolvedOptions().calendar !== "chinese") {
        throw new Error("此瀏覽器未支援農曆，請使用新版 Chrome 或 Edge。");
    }
    const parts = lunarFormatter.formatToParts(new Date(`${date}T04:00:00Z`));
    const month = parts.find((part) => part.type === "month")?.value
        .replace("冬月", "十一月").replace("臘月", "十二月");
    const day = Number(parts.find((part) => part.type === "day")?.value);
    if (!month) throw new Error("無法取得農曆月份。");
    const label = lunarDay(day);
    return {
        month, day, label: day === 1 ? month : label,
        full: `${month}${label}`,
    };
}

export function dayReference(date) {
    const covered = date >= REFERENCE_START && date <= REFERENCE_END;
    return {
        lunar: lunarDate(date),
        covered,
        holiday: covered ? holidays[date] ?? null : null,
        term: covered ? terms[date] ?? null : null,
        festival: date === "2026-10-18"
            ? "重陽節（非通用放假日）" : null,
    };
}
