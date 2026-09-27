import {
    installationSubtotal, isQuotedEquipment, itemSubtotal, spotlightSubtotal,
} from "./budget.js";
import { outdoorACZone } from "./ac-outdoors.js";
import { planDisplayCategory } from "./plan-visibility.js";
import { roomGeometry } from "./floorplan.js";
import {
    isDedicatedCircuit, PLANNER_STATE_VERSION, SOCKET_PLAN_VERSION,
    upgradeLegacySocketPlan,
} from "./socket-plan.js";
import { upgradeLegacyLightingState } from "./lighting-options.js";
import { lightDataStatus } from "./lighting-preview.js";

export const SAVE_FORMAT = "renovation-equipment-planner";
export const SAVE_FORMAT_VERSION = PLANNER_STATE_VERSION;
export const MAX_SAVE_BYTES = 4 * 1024 * 1024;

export function encodeSave(state, exportedAt = new Date().toISOString()) {
    if (!state || !Array.isArray(state.rooms) || !Array.isArray(state.items) ||
        !Array.isArray(state.products) || !Number.isSafeInteger(state.revision) ||
        state.version !== PLANNER_STATE_VERSION) {
        throw new TypeError("設備清單未完整載入，無法輸出存檔。");
    }
    return JSON.stringify({
        format: SAVE_FORMAT,
        formatVersion: SAVE_FORMAT_VERSION,
        exportedAt,
        state: {
            version: PLANNER_STATE_VERSION,
            revision: state.revision,
            updatedAt: state.updatedAt,
            rooms: state.rooms,
            items: state.items,
            products: state.products,
            undo: state.undo ?? null,
        },
    }, null, 2) + "\n";
}

export function decodeSave(text) {
    if (typeof text !== "string" || new Blob([text]).size > MAX_SAVE_BYTES) {
        throw new RangeError("存檔必須是小於 4 MB 的 JSON 檔案。");
    }
    let document;
    try {
        document = JSON.parse(text);
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw new SyntaxError("存檔不是有效的 JSON，現有設備未變更。");
    }
    const versions = [1, SOCKET_PLAN_VERSION, 3, 4, PLANNER_STATE_VERSION];
    const unwrapped = versions.includes(document?.version) &&
        document?.format === undefined;
    if (!unwrapped && (document?.format !== SAVE_FORMAT ||
        !versions.includes(document?.formatVersion))) {
        throw new RangeError("存檔格式或版本不相容；請使用本規劃器匯出的 JSON。");
    }
    const imported = unwrapped ? document : document.state;
    if (!versions.includes(imported?.version) ||
        !Array.isArray(imported.rooms) ||
        !Array.isArray(imported.items) ||
        imported.products !== undefined && !Array.isArray(imported.products)) {
        throw new TypeError("存檔缺少完整房間、物件或商品資料，現有設備未變更。");
    }
    const upgraded = upgradeLegacySocketPlan(imported);
    const lighting = upgraded.version === PLANNER_STATE_VERSION ? upgraded :
        upgradeLegacyLightingState(upgraded.version === 4 ? upgraded :
            { ...upgraded, version: 4, undo: upgraded.version === 2
                ? null : upgraded.undo ?? null });
    return {
        rooms: lighting.rooms,
        items: lighting.items,
        products: lighting.products ?? [],
        undo: lighting.undo ?? null,
    };
}

function csvCell(value) {
    const text = String(value ?? "");
    const safe = /^\s*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
}

const CSV_COLUMNS = Object.freeze([
    "房間", "圖面分類", "名稱", "品牌／型號／規格", "數量", "單位",
    "商品單價", "幣別", "商品小計", "安裝小計（新台幣）",
    "軌道燈盞數", "軌道燈小計", "原報價基準（新台幣）",
    "原報價已含", "插座迴路", "對應插座 ID", "圖上 X（%）", "圖上 Y（%）",
    "室外機窗位（示意）", "室外機暫估尺寸（cm）", "價格來源", "備註",
    "天花淨高（cm）", "每盞瓦數（W）", "每盞光通量（lm）",
    "光束角（度）", "光學資料來源", "照度資料待補",
]);

export function itemListCsv(state) {
    if (!state || !Array.isArray(state.rooms) || !Array.isArray(state.items)) {
        throw new TypeError("無有效設備資料，無法輸出物件清單。");
    }
    const rooms = new Map(state.rooms.map((room) => [room.id, room]));
    const rows = state.items.filter((item) => item.placement != null &&
        item.kind !== "door" && item.acPlanStatus !== "excluded" &&
        item.switchPlanStatus !== "removed").map((item) => {
        if (!rooms.has(item.roomId)) {
            throw new RangeError(`物件「${item.name}」所屬房間不存在，未匯出清單。`);
        }
        const amount = itemSubtotal(item, state.items);
        const installation = installationSubtotal(item);
        const spotlights = spotlightSubtotal(item);
        const quote = isQuotedEquipment(item);
        return [
            rooms.get(item.roomId).name,
            isDedicatedCircuit(item) ? "專用迴路" :
                ({ furniture: "家具／其他", lights: "燈", switches: "開關",
                    outlets: "插座", structure: "門牆" })[planDisplayCategory(item)],
            item.name, item.brandModel, item.quantity ?? "待補", item.unit,
            item.unitPrice ?? "待補", item.priceCurrency, amount ?? "待補",
            installation === 0 ? "" : installation ?? "待補",
            item.lightType === "track" ? item.spotlightQuantity : "",
            item.lightType === "track" ? spotlights ?? "待補" : "",
            quote ? item.quotedQuantity * item.quotedUnitPrice : "",
            quote ? "是" : "否",
            item.outletCircuit ?? "",
            item.circuitOutletId ?? "",
            Math.round(item.placement.x * 1000) / 10,
            Math.round(item.placement.y * 1000) / 10,
            item.outdoorPlacement ? outdoorACZone(item).label : "",
            item.outdoorWidthCm && item.outdoorDepthCm
                ? `${item.outdoorWidthCm}×${item.outdoorDepthCm}` : "",
            item.priceSource, item.note,
            item.lightType ? rooms.get(item.roomId).ceilingHeightCm ?? "" : "",
            item.lightType ? item.lightWatts ?? "" : "",
            item.lightType ? item.lightLumens ?? "" : "",
            item.lightType ? item.beamAngleDeg ?? "" : "",
            item.lightType ? item.lightSpecSource ?? "" : "",
            item.lightType ? lightDataStatus(item,
                roomGeometry(rooms.get(item.roomId))).missing.join("、") : "",
        ].map(csvCell).join(",");
    });
    return "\ufeff" + [CSV_COLUMNS.map(csvCell).join(","), ...rows].join("\r\n") + "\r\n";
}

export function downloadFile(filename, contents, mimeType) {
    if (typeof document === "undefined") {
        throw new TypeError("下載檔案只能從規劃器頁面操作。");
    }
    const url = URL.createObjectURL(new Blob([contents], { type: mimeType }));
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.append(link);
    try {
        link.click();
    } finally {
        link.remove();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
    }
}
