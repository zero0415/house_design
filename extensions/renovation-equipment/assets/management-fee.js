import { dateNumber } from "./construction-calendar.js";

export const MANAGEMENT_FEE_VERSION = 1;
export const MANAGEMENT_FEE_RECIPIENT = "管委會";
export const MANAGEMENT_FEE_LABEL = "管委會施工期間清潔費";
export const APPROVED_MANAGEMENT_FEE = Object.freeze({
    start: "2026-10-13", end: "2027-01-30", dailyRate: 100,
});

export const hasManagementFee = (state) =>
    Object.prototype.hasOwnProperty.call(state ?? {}, "managementCleaningFee");

function exactObject(value, keys, label) {
    if (!value || typeof value !== "object" || Array.isArray(value) ||
        Object.keys(value).length !== keys.length ||
        keys.some((key) => !Object.hasOwn(value, key))) {
        throw new TypeError(`${label}欄位不完整或含未知欄位。`);
    }
}

export function validateFeePeriod(value) {
    exactObject(value, ["start", "end", "dailyRate"], "管委會清潔費");
    if (dateNumber(value.start) > dateNumber(value.end)) {
        throw new TypeError("清潔費結束日期不得早於開始日期。");
    }
    if (typeof value.dailyRate !== "number" ||
        !Number.isFinite(value.dailyRate) ||
        value.dailyRate < 0 || value.dailyRate > 1_000_000_000 ||
        Math.round(value.dailyRate * 100) / 100 !== value.dailyRate) {
        throw new TypeError(
            "清潔費每日費率須為 0 至 1,000,000,000 元、最多兩位小數，不可留白。"
        );
    }
    return {
        start: value.start, end: value.end, dailyRate: value.dailyRate,
    };
}

export function validateManagementFee(value) {
    exactObject(value, ["version", "fee", "undo"], "管委會清潔費");
    if (value.version !== MANAGEMENT_FEE_VERSION) {
        throw new TypeError("管委會清潔費版本不相容。");
    }
    if (value.undo !== null) exactObject(value.undo, ["fee"], "清潔費復原");
    return {
        version: MANAGEMENT_FEE_VERSION,
        fee: value.fee === null ? null : validateFeePeriod(value.fee),
        undo: value.undo === null ? null : {
            fee: value.undo.fee === null
                ? null : validateFeePeriod(value.undo.fee),
        },
    };
}

export const managementFeeFields = (state) => hasManagementFee(state)
    ? { managementCleaningFee: validateManagementFee(
        state.managementCleaningFee) }
    : {};

export function managementFeeSummary(value) {
    const fee = value === undefined
        ? null : validateManagementFee(value).fee;
    if (!fee) return { fee: null, days: 0, sundays: 0, totalTWD: 0 };
    const first = dateNumber(fee.start);
    const days = dateNumber(fee.end) - first + 1;
    const firstSunday = (7 -
        new Date(first * 86_400_000).getUTCDay()) % 7;
    const sundays = firstSunday >= days ? 0 :
        1 + Math.floor((days - firstSunday - 1) / 7);
    return {
        fee, days, sundays,
        totalTWD: Math.round(fee.dailyRate * 100) * days / 100,
    };
}

export function editManagementFee(current, fee) {
    const previous = current === undefined
        ? null : validateManagementFee(current).fee;
    return validateManagementFee({
        version: MANAGEMENT_FEE_VERSION, fee, undo: { fee: previous },
    });
}

export function undoManagementFee(current) {
    const value = validateManagementFee(current);
    if (value.undo === null) {
        throw new TypeError("沒有可還原的管委會清潔費變更。");
    }
    return {
        version: MANAGEMENT_FEE_VERSION, fee: value.undo.fee, undo: null,
    };
}

export function guardManagementFeeUpdate(current, candidate) {
    if ((hasManagementFee(current) || hasManagementFee(candidate)) &&
        candidate?.managementFeeVersion !== MANAGEMENT_FEE_VERSION) {
        throw new TypeError(
            "此存檔含管委會清潔費及獨立復原；舊版不能寫入，請載入新版。"
        );
    }
    if (hasManagementFee(current) && !hasManagementFee(candidate)) {
        throw new TypeError(
            "不得漏存管委會清潔費；移除請使用費用編輯器。"
        );
    }
    if (hasManagementFee(candidate)) {
        validateManagementFee(candidate.managementCleaningFee);
    }
}

export function importManagementFee(currentState, importedState) {
    if (!hasManagementFee(importedState)) {
        return managementFeeFields(currentState);
    }
    const imported = validateManagementFee(importedState.managementCleaningFee);
    if (!currentState) return { managementCleaningFee: imported };
    const current = hasManagementFee(currentState)
        ? validateManagementFee(currentState.managementCleaningFee)
        : undefined;
    if (JSON.stringify(current?.fee ?? null) === JSON.stringify(imported.fee)) {
        return { managementCleaningFee: current ?? imported };
    }
    return {
        managementCleaningFee: editManagementFee(current, imported.fee),
    };
}

export function managementFeeCsv(value) {
    const { fee, days, sundays, totalTWD } = managementFeeSummary(value);
    const rows = [[
        "項目", "收款對象", "開始（含）", "結束（含）", "日曆天數",
        "其中週日（照計）", "每日費率（TWD）", "小計（TWD）",
        "計費規則", "原工程基準關係",
    ]];
    if (fee) {
        rows.push([
            MANAGEMENT_FEE_LABEL, MANAGEMENT_FEE_RECIPIENT,
            fee.start, fee.end, days, sundays, fee.dailyRate, totalTWD,
            "含首尾日、所有週日與假日；不隨工項改期",
            "原報價外另計；不取代原工程清潔 NT$35,000",
        ]);
    }
    return "\ufeff" + rows.map((row) =>
        row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`)
            .join(",")).join("\r\n") + "\r\n";
}
