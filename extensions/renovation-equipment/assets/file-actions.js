import {
    installationSubtotal, isQuotedEquipment, itemSubtotal, spotlightSubtotal,
} from "./budget.js";
import { isSplitAirConditioner, outdoorACZone } from "./ac-outdoors.js";
import { planDisplayCategory } from "./plan-visibility.js";
import { roomGeometry } from "./floorplan.js";
import {
    isDedicatedCircuit, PLANNER_STATE_VERSION, SOCKET_PLAN_VERSION,
    upgradeLegacySocketPlan,
    isWeakCurrent, isPairedSocket,
} from "./socket-plan.js";
import { upgradeLegacyLightingState } from "./lighting-options.js";
import { lightDataStatus } from "./lighting-preview.js";
import {
    CONTROL_RELATIONS_CAUTION, hasControlRelations,
} from "./circuit-preview.js";
import {
    hasDoorAllocation, isQuotedDoor, isUnquotedBalconyDoor,
} from "./door-allocation.js";
import { hasRobotPlan } from "./robot-plan.js";
import { hasCalendar, validateCalendar } from "./construction-calendar.js";
import { isSlideTrack } from "./budget.js";
import { quoteProvenance } from "./quote-provenance.js";
import {
    BATHROOM_INSTALLATION_QUOTE, isBathroomInstallationIncluded,
} from "./bathroom-installation.js";

export const SAVE_FORMAT = "renovation-equipment-planner";
export const SAVE_FORMAT_VERSION = PLANNER_STATE_VERSION;
export const MAX_SAVE_BYTES = 4 * 1024 * 1024;

export function encodeSave(state, exportedAt = new Date().toISOString()) {
    if (!state || !Array.isArray(state.rooms) || !Array.isArray(state.items) ||
        !Array.isArray(state.products) || !Number.isSafeInteger(state.revision) ||
        state.version !== PLANNER_STATE_VERSION) {
        throw new TypeError("設備清單未完整載入，無法輸出存檔。");
    }
    const calendar = hasCalendar(state)
        ? { constructionCalendar: validateCalendar(state.constructionCalendar) } : {};
    return JSON.stringify({
        format: SAVE_FORMAT,
        formatVersion: hasCalendar(state)
            ? calendar.constructionCalendar.version === 2 ? 10 : 9 :
            hasRobotPlan(state) ? 8 :
            hasDoorAllocation(state) ? 7 :
            hasControlRelations(state) ? 6 : SAVE_FORMAT_VERSION,
        exportedAt,
        state: {
            version: PLANNER_STATE_VERSION,
            revision: state.revision,
            updatedAt: state.updatedAt,
            rooms: state.rooms,
            items: state.items,
            products: state.products,
            undo: state.undo ?? null,
            ...calendar,
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
        ![...versions, 6, 7, 8, 9, 10].includes(document?.formatVersion))) {
        throw new RangeError("存檔格式或版本不相容；請使用本規劃器匯出的 JSON。");
    }
    const imported = unwrapped ? document : document.state;
    if (!unwrapped && [9, 10].includes(document.formatVersion) &&
        (imported?.version !== PLANNER_STATE_VERSION ||
            !hasCalendar(imported))) {
        throw new RangeError(
            `容器 ${document.formatVersion} 存檔須包含 v5 資料及完整行事曆` +
                "（含獨立復原），現有規劃未變更。"
        );
    }
    if (hasCalendar(imported) &&
        imported.version !== PLANNER_STATE_VERSION) {
        throw new RangeError(
            "含行事曆的存檔須使用對應容器 9 或 10 及 v5 資料，現有規劃未變更。"
        );
    }
    const calendar = hasCalendar(imported)
        ? { constructionCalendar: validateCalendar(imported.constructionCalendar) } : {};
    if (hasCalendar(imported) && !unwrapped &&
        document.formatVersion !==
            (calendar.constructionCalendar.version === 2 ? 10 : 9)) {
        throw new RangeError(
            `行事曆版本不相容；此資料須使用容器 ` +
            `${calendar.constructionCalendar.version === 2 ? 10 : 9}，` +
            "現有規劃未變更。"
        );
    }
    if (!unwrapped && document.formatVersion === 6 &&
        (imported?.version !== PLANNER_STATE_VERSION ||
            !hasControlRelations(imported))) {
        throw new RangeError("新版開關對應存檔須含 v5 資料及完整對應欄位，未改動目前規劃。");
    }
    if (!unwrapped && document.formatVersion === 7 &&
        (imported?.version !== PLANNER_STATE_VERSION ||
            !hasDoorAllocation(imported))) {
        throw new RangeError("新版門片歸屬存檔須含 v5 資料及完整門片欄位，未改動目前規劃。");
    }
    if (!unwrapped && document.formatVersion === 8 &&
        (imported?.version !== PLANNER_STATE_VERSION ||
            !hasRobotPlan(imported))) {
        throw new RangeError("新版掃拖機存檔須含 v5 資料及完整規劃欄位，未改動目前規劃。");
    }
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
        ...calendar,
    };
}

function csvCell(value) {
    const text = String(value ?? "");
    const safe = /^\s*[=+\-@\t\r]/.test(text) ? `'${text}` : text;
    return `"${safe.replaceAll('"', '""')}"`;
}

const CSV_COLUMNS = Object.freeze([
    "房間", "圖面分類", "名稱", "品牌／型號／規格", "數量", "單位",
    "商品單價", "幣別", "商品小計", "安裝小計（新台幣）", "安裝費來源",
    "軌道燈盞數", "軌道燈小計", "原報價基準（新台幣）",
    "原報價已含", "插座迴路", "對應插座 ID", "圖上 X（%）", "圖上 Y（%）",
    "室外機窗位（示意）", "室外機暫估尺寸（cm）", "價格來源", "備註",
    "天花淨高（cm）", "每盞瓦數（W）", "每盞光通量（lm）",
    "光束角（度）", "光學資料來源", "照度資料待補",
    "來源標位 ID", "標位類型（示意，非施工核可）",
    "冷氣規劃狀態", "冷氣施工費（未核）", "單條燈軌長度（cm）",
    "面板對應燈具ID", "開關對應狀態（非施工）",
    "門位ID", "開門方式", "軌道對應門位", "歷史報價與歸屬說明",
]);

export function itemListCsv(state) {
    if (!state || !Array.isArray(state.rooms) || !Array.isArray(state.items)) {
        throw new TypeError("無有效設備資料，無法輸出物件清單。");
    }
    const rooms = new Map(state.rooms.map((room) => [room.id, room]));
    const rows = state.items.filter((item) =>
        (item.placement != null || item.kind === "door" || isSlideTrack(item)) &&
        item.acPlanStatus !== "excluded" &&
        item.switchPlanStatus !== "removed").map((item) => {
        if (!rooms.has(item.roomId)) {
            throw new RangeError(`物件「${item.name}」所屬房間不存在，未匯出清單。`);
        }
        const amount = itemSubtotal(item, state.items);
        const installation = installationSubtotal(item);
        const bathroomInstallationIncluded = isBathroomInstallationIncluded(item);
        const spotlights = spotlightSubtotal(item);
        const quote = isQuotedDoor(item) || isQuotedEquipment(item);
        const pending = isUnquotedBalconyDoor(item) ? "未計算" : "待補";
        return [
            rooms.get(item.roomId).name,
            isWeakCurrent(item) ? "弱電 C 埠（非電源）" :
            isDedicatedCircuit(item) ? "專用迴路（非實體端點）" :
                isPairedSocket(item, state.items) ? "專用實體電源" :
                ({ furniture: "家具／其他", lights: "燈", switches: "開關",
                    outlets: "插座", structure: "門牆" })[planDisplayCategory(item)],
            item.name, item.brandModel, item.quantity ?? "待補", item.unit,
            item.unitPrice ?? pending, item.priceCurrency, amount ?? pending,
            bathroomInstallationIncluded ? 0 : installation === 0 ? "" :
                installation ?? "待補",
            bathroomInstallationIncluded
                ? `原報價衛浴設備安裝 ${BATHROOM_INSTALLATION_QUOTE.suites} 套 × ` +
                    `NT$${BATHROOM_INSTALLATION_QUOTE.unitPriceTWD} 已含；改管補強另核`
                : "",
            item.lightType === "track" ? item.spotlightQuantity : "",
            item.lightType === "track" ? spotlights ?? "待補" : "",
            quote ? item.quotedQuantity * item.quotedUnitPrice : "",
            quote ? "是" : "否",
            item.outletCircuit ?? "",
            item.circuitOutletId ?? "",
            item.placement ? Math.round(item.placement.x * 1000) / 10 : "",
            item.placement ? Math.round(item.placement.y * 1000) / 10 : "",
            item.outdoorPlacement ? outdoorACZone(item).label :
                isSplitAirConditioner(item) ? "未確認室外機位／對外路徑，非可施工配置" : "",
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
            item.outletPlanPointId ?? "",
            item.outletPlanPointId ? ({ R: "一般電源", B: "專用供電端點", C: "弱電非電源" })[
                item.outletPlanPointId[0]] : "",
            isSplitAirConditioner(item) ? item.acPlanStatus ?? "active" : "",
            isSplitAirConditioner(item) ? "待報：人工、支架、冷媒管、排水、許可及電氣；不列入本體暫計" : "",
            item.lightType === "track" ? item.trackLengthCm ?? 150 : "",
            item.switchType ? (item.controlledLightIds ?? []).join(" | ") : "",
            item.switchType ? item.controlledLightIds?.length
                ? CONTROL_RELATIONS_CAUTION : "尚未設定對應" : "",
            item.doorId ?? "", item.doorOpeningKind ?? "",
            item.trackDoorId ?? "",
            item.kind === "door" || isSlideTrack(item)
                ? quoteProvenance(item) : "",
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
