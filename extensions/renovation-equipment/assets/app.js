import {
    doorsForRoom, isBalconyHeaterPlaceholder, knownRoomIds, markerPosition,
    placementFootprint, renderOverviewPlan, renderReferenceSvg, renderRoomPlan,
    roomGeometry, windowsForRoom,
} from "./floorplan.js";
import { FURNITURE_TEMPLATES } from "./furniture.js";
import { KITCHEN_SAFETY, renderKitchenReference } from "./kitchen-plan.js";
import { OUTLET_POINT_WARNINGS } from "./outlet-diagram.js";
import { objectIconKind } from "./plan-icons.js";
import {
    catalogType, customEquipment, equipmentCatalog,
    equipmentFromTemplate,
} from "./equipment-catalog.js";
import {
    applyProductToItem, equipmentFromProduct, productAllowedInRoom,
    productCompatibleWithItem, productFromDraft, productLabel, productTypeForItem,
    productUnit, PRODUCT_ENVIRONMENTS, PRODUCT_TYPES,
} from "./product-database.js";
import {
    circuitPlacement, DEDICATED_CIRCUIT_UNIT_PRICE_TWD, isDedicatedCircuit,
    isQuotedCircuit, isQuotedOutlet, isSocket, PLANNER_STATE_VERSION,
    QUOTED_DEDICATED_COUNT, QUOTED_SOCKET_COUNT, SOCKET_UNIT_PRICE_TWD,
    isWeakCurrent, isPairedSocket, electricalPointCounts,
} from "./socket-plan.js";
import { planDisplayCategory } from "./plan-visibility.js";
import {
    previewCircuitLinks, previewControlledLights, previewTargetRoomId,
} from "./circuit-preview.js";
import {
    estimateRoomIlluminance, ILLUSTRATIVE_LIGHT_RANGE_CM, isPlacedLight,
    LIGHT_PREVIEW_PLANES_CM, lightDataStatus, lightSourcesForRoom,
    renderLightingPreview,
} from "./lighting-preview.js";
import { DOOR_OPTIONS } from "./door-options.js";
import {
    ORIGINAL_QUOTE_TWD, calculateBudget, calculatePlanTotal, isQuotedEquipment,
    installationSubtotal, isSlideTrack, itemSubtotal as subtotal, spotlightSubtotal,
    slideTrackNeeded, unquotedTrackCost,
} from "./budget.js";
import { materialIncludesTrack, SLIDE_TRACK_RATE_TWD } from "./slide-tracks.js";
import {
    BEDROOM2_PARTITION_ID, BEDROOM2_PARTITION_OPTIONS, BEDROOM2_PARTITION_QUOTED_AREA,
} from "./partition-options.js";
import {
    OUTDOOR_SWITCH_TYPES, SWITCH_QUOTED_UNIT_PRICE_TWD, SWITCH_TYPES,
    switchOptionFor,
} from "./switch-options.js";
import {
    isBathGrabBar, isFreshAirUnit, isHeatedTowelRail, isToiletRinseKit,
    RINSE_KIT_REFERENCE_PRICE_TWD,
} from "./bathroom-fixtures.js";
import { CEILING_LIGHT_INSTALL_UNIT_PRICE_TWD } from "./ceiling-lights.js";
import {
    CEILING_LIGHT_OPTIONS, DOWNLIGHT_FIXTURE_ESTIMATE_TWD,
    DOWNLIGHT_INSTALL_ESTIMATE_TWD, DOWNLIGHT_OPTIONS, installedDownlightUnitPrice,
    TRACK_RAIL_OPTIONS, TRACK_SPOTLIGHT_OPTIONS,
} from "./lighting-options.js";
import {
    CORRIDOR_TRACK_ID, CORRIDOR_TRACK_INSTALL_PRICE_TWD, CORRIDOR_TRACK_LENGTH_CM,
} from "./track-lighting.js";
import { renderSurvey } from "./survey.js";
import {
    PLAN_PIXELS_PER_CM, ROOM_DRAWING_DIMENSIONS, footprintFits, nearestRoomCenter, pointInZone,
} from "./house-geometry.js";
import {
    isActiveSplitAirConditioner, isSplitAirConditioner, outdoorACFootprint,
    outdoorACPosition, outdoorACSceneConflict, outdoorACZone, outdoorACZoneChoices,
    OUTDOOR_AC_ANCHOR,
    OUTDOOR_AC_ESTIMATED_SIZE_CM, OUTDOOR_AC_SIZE_BOUNDS_CM, OUTDOOR_AC_ZONES,
} from "./ac-outdoors.js";
import {
    decodeSave, downloadFile, encodeSave, itemListCsv, MAX_SAVE_BYTES,
} from "./file-actions.js";
import {
    isPortableMode, readPlannerState, writePlannerState,
} from "./state-transport.js";

const content = document.querySelector("#content");
const status = document.querySelector("#save-status");
const reloadButton = document.querySelector("#reload");
const undoButton = document.querySelector("#undo-last");
const toolbar = document.querySelector(".toolbar");
const currency = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 2 });
const currencySymbols = { TWD: "NT$", JPY: "¥", USD: "US$" };

let state;
let view = "plan";
let showSourceOverlay = false;
let lightingPreview = false;
let lightingPlaneCm = LIGHT_PREVIEW_PLANES_CM.desk;
let litItemIds = new Set();
let focusedCircuitId = null;
let circuitListOpen = false;
let furnitureTemplatesOpen = false;
const visiblePlanLayers = {
    furniture: true, lights: true, switches: true, outlets: true,
};
const survey = { zoom: "fit", grid: true, windows: true, doors: true, exteriorRail: true };
let planRoomId = null;
let selectedPlanItemId = null;
let rotateHandleHidden = false;
let pendingDeleteId = null;
let pendingMoveOutletId = null;
let pendingObject = null;
let pendingNewItem = null;
let newItemOriginView = null;
let pendingProduct = null;
let pendingProductDeleteId = null;
let furnitureDrag = null;
let outdoorDrag = null;
let suppressClick = false;
let dirty = false;
let saving = false;
let conflicted = false;
let undoing = false;
let saveTimer;
let saveFinished = Promise.resolve();
let lastActionState = null;
let inputGroupKey = null;
let inputGroupBefore = null;
const expandedItems = new Set();
const openDoorRooms = new Set();
const openDeviceGroups = new Set(["circuits", "light:ceiling"]);
const invalidInputs = new Set();
let rendering = false;
let rerenderQueued = false;

function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
    })[character]);
}

function setStatus(message, kind = "info") {
    status.textContent = message;
    status.dataset.kind = kind;
}

function stateSnapshot(source = state) {
    return structuredClone({
        rooms: source.rooms, items: source.items, products: source.products,
    });
}

function updateUndoButton() {
    undoButton.disabled = !state?.undo || conflicted || undoing;
    content.inert = undoing;
    toolbar.inert = undoing;
}

function resetActionTracking() {
    lastActionState = stateSnapshot();
    inputGroupKey = null;
    inputGroupBefore = null;
    updateUndoButton();
}

function formattedAmount(item, amount) {
    return `${currencySymbols[item.priceCurrency]}${currency.format(amount)}`;
}

function formattedTotals(totals) {
    const amounts = Object.entries(totals)
        .filter(([, amount]) => amount !== 0)
        .map(([code, amount]) => `${currencySymbols[code]}${currency.format(amount)}`);
    return amounts.length ? amounts.join(" · ") : "NT$0";
}

function isAirConditioner(item) {
    return isSplitAirConditioner(item) ||
        planDisplayCategory(item) !== "outlets" && item.name.includes("冷氣");
}

function isShowerDoor(item) {
    return item.kind === "door" &&
        (item.doorId === "main-shower" || item.doorId === "guest-shower");
}

function isSwitch(item) {
    return item.kind === "equipment" && item.switchType != null;
}

function isQuotedSwitch(item) {
    return isSwitch(item) && isQuotedEquipment(item);
}

function isOutdoorSwitch(item) {
    return isSwitch(item) && item.switchEnvironment === "outdoor";
}

function isQuotedDownlight(item) {
    return isDownlight(item) && isQuotedEquipment(item);
}

function isDownlight(item) {
    return item.kind === "equipment" && item.lightType === "recessed";
}

function isCeilingLight(item) {
    return item.kind === "equipment" && item.lightType === "ceiling";
}

function isTrackLighting(item) {
    return item.kind === "equipment" && item.lightType === "track";
}

function isProvisionalFreshAirInstallation(item) {
    return item.kind === "equipment" &&
        ["bath-main-heater-install", "bath-guest-heater-install"].includes(item.id);
}

function quotedSwitchOption(item) {
    const option = switchOptionFor(item);
    if (!option) throw new RangeError(`無效的單／雙開關型式：${item.id}`);
    return option;
}

function isPlaceableItem(item) {
    return item.kind !== "door" &&
        !(isSplitAirConditioner(item) && item.acPlanStatus === "excluded") &&
        !(isSwitch(item) && item.switchPlanStatus === "removed") &&
        (!isQuotedEquipment(item) || isQuotedSwitch(item) ||
            isQuotedDownlight(item) || isQuotedOutlet(item) || isQuotedCircuit(item) || isWeakCurrent(item));
}

function quotedTrackForDoor(doorId) {
    return state.items.find((item) => isSlideTrack(item) && item.trackDoorId === doorId);
}

function itemAmountLabel(item) {
    if (isSplitAirConditioner(item) && item.acPlanStatus === "excluded") {
        return "暫不裝分離式";
    }
    if (isQuotedSwitch(item) && item.switchPlanStatus === "removed") {
        return `已移除規劃 · 暫減 NT$${currency.format(item.quotedUnitPrice)}`;
    }
    const amount = subtotal(item, state.items);
    if (isFreshAirUnit(item) && amount === null) return "新風機本體待報";
    if (isHeatedTowelRail(item) && amount === null) return "電熱毛巾架待報";
    if (isBathGrabBar(item) && amount === null) return "防滑扶手待報";
    if (isTrackLighting(item)) {
        const spotlights = spotlightSubtotal(item);
        const installation = installationSubtotal(item);
        return `軌道 ${amount === null ? "待補" : formattedAmount(item, amount)} · ` +
            `${item.spotlightQuantity} 燈 ${spotlights === null ? "待補" :
                formattedAmount(item, spotlights)} · ` +
            `安裝 ${installation === null ? "待補" : `NT$${currency.format(installation)}`}`;
    }
    if (isCeilingLight(item)) {
        const installation = installationSubtotal(item);
        return `${amount === null ? "燈具待補" : `燈具 ${formattedAmount(item, amount)}`} · ` +
            `${installation === null ? "安裝待補" : `安裝 NT$${currency.format(installation)}`}`;
    }
    if (isQuotedDownlight(item) && amount === null) return "換款待報 · 原 NT$950 已含";
    if (isDownlight(item) && amount === null) return "新增崁燈本體／安裝待報";
    if (amount === null) return "待補數量／單價";
    if (isSlideTrack(item) && amount === 0) return "NT$0（軌道暫未使用）";
    return formattedAmount(item, amount);
}

function downlightPriceBreakdown(item) {
    const component = (price) => price === null ? "待補" : `NT$${currency.format(price)}`;
    const selected = subtotal(item, state.items);
    const estimate = `燈具 ${component(item.fixtureUnitPrice)} ＋ 配線與安裝
        ${component(item.installationUnitPrice)}`;
    if (selected === null) {
        return `${estimate}；${isQuotedDownlight(item)
            ? "新款總價待補，原報價每顆 NT$950 仍作基準。"
            : "新增崁燈總價待補，不占用原報 6 顆額度。"}`;
    }
    if (!isQuotedDownlight(item)) {
        return `${estimate} ＝每顆 NT$${currency.format(selected)}，` +
            "全額列原報價外追加試算。";
    }
    const baseline = item.quotedUnitPrice * item.quotedQuantity;
    const difference = selected - baseline;
    return `${estimate} ＝目前每顆 NT$${currency.format(selected)}；
        ${difference === 0 ? "與原報價相同" : difference > 0
        ? `暫列追加 NT$${currency.format(difference)}` :
            `暫列減項 NT$${currency.format(-difference)}`}。`;
}

function partitionOption(item) {
    const option = BEDROOM2_PARTITION_OPTIONS[item.partitionMaterial];
    if (!option) throw new RangeError("臥室2輕隔間做法無效，無法呈現規劃單價。");
    return option;
}

function partitionBudgetLabel(item) {
    const baseline = item.quotedQuantity * item.quotedUnitPrice;
    const selected = subtotal(item, state.items);
    if (selected === null) return `規劃坪數或單價待補；原報價 NT$${currency.format(baseline)} 仍作基準。`;
    const difference = selected - baseline;
    return `目前 NT$${currency.format(selected)} · ${difference < 0
        ? `暫列減項 NT$${currency.format(-difference)}` :
        difference > 0 ? `暫列追加 NT$${currency.format(difference)}` : "與原報價相同"}`;
}

function roomName(roomId) {
    return state.rooms.find((room) => room.id === roomId)?.name ?? "未知房間";
}

function summary(items) {
    return calculateBudget(items, { wholePlan: items === state.items });
}

function renderTotals() {
    const totals = summary(state.items);
    const overall = calculatePlanTotal(totals);
    const socketCount = state.items.filter(isSocket).length;
    const circuitCount = state.items.filter(isDedicatedCircuit).length;
    const points = electricalPointCounts(state.items);
    const foreign = Object.entries(overall.foreignTotals)
        .filter(([, amount]) => amount !== 0)
        .map(([code, amount]) => `${currencySymbols[code]}${currency.format(amount)}`)
        .join(" · ");
    document.querySelector("#quote-baseline").textContent = `NT$${currency.format(ORIGINAL_QUOTE_TWD)}`;
    document.querySelector("#overall-total").textContent = `NT$${currency.format(overall.TWD)}`;
    document.querySelector("#overall-note").textContent = [
        points.weak || state.items.some((item) => item.outletPlanPointId)
            ? `實體電源 ${points.power}（一般 ${points.general}＋已配專用 ${points.dedicated}），` +
                `另 ${points.weak} 弱電 C 埠（非電源，原報7條×3,000額度不重複追加）。來源標位／電壓仍待現勘` : null,
        foreign ? `另有 ${foreign} 未換算` : null,
        totals.pendingCount ? `${totals.pendingCount} 項價格待補` : null,
        state.items.some((item) => isQuotedSwitch(item) &&
            item.switchPlanStatus === "removed")
            ? "開關移除的減項尚待廠商確認" : null,
        socketCount !== QUOTED_SOCKET_COUNT
            ? `目前 ${socketCount} 個插座與原報 ${QUOTED_SOCKET_COUNT} 個不同；
                每個暫按 NT$${currency.format(SOCKET_UNIT_PRICE_TWD)} 增減，
                數量和工資須與廠商確認`.replace(/\s+/g, " ") : null,
        circuitCount !== QUOTED_DEDICATED_COUNT
            ? `目前 ${circuitCount} 條專用迴路（原報 ${QUOTED_DEDICATED_COUNT} 條）；
                每條暫按 NT$${currency.format(DEDICATED_CIRCUIT_UNIT_PRICE_TWD)} 試算，
                ${circuitCount < QUOTED_DEDICATED_COUNT
                    ? "少於 7 條可能使高負載共線跳電，建議維持至少 7 條；" : ""}
                配電容量、跳電風險與實價須電工核對`.replace(/\s+/g, " ") : null,
        "追加監工與稅另計",
    ].filter(Boolean).join(" · ");
    document.querySelector("#priced-total").textContent = formattedTotals(totals.pricedTotals);
    document.querySelector("#additional-total").textContent = formattedTotals(totals.additionalTotals);
    document.querySelector("#reduction-total").textContent = `NT$${currency.format(totals.reductionTWD)}`;
    document.querySelector("#pending-count").textContent = String(totals.pendingCount);
    for (const element of content.querySelectorAll("[data-total-id]")) {
        const item = state.items.find((entry) => entry.id === element.dataset.totalId);
        if (!item) throw new RangeError(`找不到計價項目：${element.dataset.totalId}`);
        element.textContent = itemAmountLabel(item);
    }
    for (const element of content.querySelectorAll("[data-track-cost-door-id]")) {
        const door = state.items.find((item) => item.kind === "door" &&
            item.doorId === element.dataset.trackCostDoorId);
        if (!door) throw new RangeError(`找不到軌道門位：${element.dataset.trackCostDoorId}`);
        const amount = unquotedTrackCost(door, state.items);
        element.textContent = amount === null ? "軌道長度待量、暫不計價" :
            `軌道追加 NT$${currency.format(amount)}`;
    }
    for (const element of content.querySelectorAll("[data-partition-budget]")) {
        const partition = state.items.find((item) => item.id === BEDROOM2_PARTITION_ID);
        if (!partition) throw new RangeError("找不到臥室2輕隔間報價明細。");
        element.textContent = partitionBudgetLabel(partition);
    }
    for (const element of content.querySelectorAll("[data-track-budget-id]")) {
        const track = state.items.find((item) => item.id === element.dataset.trackBudgetId);
        if (!track || !isTrackLighting(track)) {
            throw new RangeError(`找不到走廊軌道燈組：${element.dataset.trackBudgetId}`);
        }
        element.textContent = trackBudgetLabel(track);
    }
    for (const element of content.querySelectorAll("[data-downlight-breakdown-id]")) {
        const light = state.items.find((item) => item.id === element.dataset.downlightBreakdownId);
        if (!light || !isDownlight(light)) {
            throw new RangeError(`找不到崁燈：${element.dataset.downlightBreakdownId}`);
        }
        element.textContent = downlightPriceBreakdown(light);
    }
    for (const element of content.querySelectorAll("[data-light-summary-id]")) {
        const light = state.items.find((item) => item.id === element.dataset.lightSummaryId);
        if (!light || !isCeilingLight(light)) {
            throw new RangeError(`找不到客廳吸頂燈：${element.dataset.lightSummaryId}`);
        }
        element.textContent = itemAmountLabel(light);
    }
    for (const element of content.querySelectorAll("[data-light-install-id]")) {
        const light = state.items.find((item) => item.id === element.dataset.lightInstallId);
        if (!light || !(isCeilingLight(light) || isTrackLighting(light))) {
            throw new RangeError(`找不到照明安裝項目：${element.dataset.lightInstallId}`);
        }
        const amount = installationSubtotal(light);
        element.textContent = amount === null ? "待補安裝單價" : `NT$${currency.format(amount)}`;
    }
    for (const element of content.querySelectorAll("[data-room-subtotal]")) {
        const roomItems = state.items.filter((item) => item.roomId === element.dataset.roomSubtotal);
        const totalsForRoom = summary(roomItems);
        element.textContent = `${roomItems.length} 項 · 小計 ${formattedTotals(totalsForRoom.pricedTotals)}` +
            ` · 追加 ${formattedTotals(totalsForRoom.additionalTotals)}` +
            (totalsForRoom.reductionTWD ? ` · 減項 NT$${currency.format(totalsForRoom.reductionTWD)}` : "") +
            (totalsForRoom.pendingCount ? ` · ${totalsForRoom.pendingCount} 項待補` : "");
    }
}

function field(item, name, label, options = {}) {
    const id = escapeHtml(item.id);
    const value = escapeHtml(item[name] ?? "");
    const cssClass = options.cssClass ?? "";
    if (name === "roomId") {
        const product = state.products.find((entry) => entry.id === item.productId);
        const rooms = isOutdoorSwitch(item)
            ? state.rooms.filter((room) => room.id === "balcony")
            : isSwitch(item)
            ? state.rooms.filter((room) => room.id !== "balcony" && room.id !== "ac-platform")
            : product ? state.rooms.filter((room) =>
                productAllowedInRoom(product, room.id)) : state.rooms;
        const choices = rooms.map((room) =>
            `<option value="${escapeHtml(room.id)}" ${room.id === item.roomId ? "selected" : ""}>` +
                `${escapeHtml(room.name)}</option>`,
        ).join("");
        return `<label class="${cssClass}">${label}<select data-item-id="${id}"
            data-field="roomId" ${isCeilingLight(item) || isTrackLighting(item) ||
                isDedicatedCircuit(item) ||
                isSocket(item) && state.items.some((entry) =>
                    isDedicatedCircuit(entry) && entry.circuitOutletId === item.id) ||
                isFreshAirUnit(item) || isToiletRinseKit(item) ||
                isHeatedTowelRail(item) || isBathGrabBar(item) ||
                isSplitAirConditioner(item) || isOutdoorSwitch(item) ||
                (isQuotedEquipment(item) && !isSwitch(item))
                ? "disabled" : ""}>${choices}</select></label>`;
    }
    if (name === "circuitOutletId") {
        const choices = state.items.filter((socket) =>
            isSocket(socket) && socket.roomId === item.roomId &&
            (socket.id === item.circuitOutletId ||
                socket.placement && !state.items.some((entry) =>
                    isDedicatedCircuit(entry) && entry.circuitOutletId === socket.id)))
            .map((socket) => `<option value="${escapeHtml(socket.id)}"
                ${socket.id === item.circuitOutletId ? "selected" : ""}>
                ${escapeHtml(socket.name)}${socket.placement ? "" : "（待標位）"}</option>`)
            .join("");
        return `<label class="${cssClass}">對應的實體插座
            <select data-item-id="${id}" data-field="circuitOutletId"
                required>${choices}</select></label>`;
    }
    if (name === "priceCurrency") {
        const choices = [["TWD", "新台幣"], ["JPY", "日圓"], ["USD", "美元"]].map(([code, text]) =>
            `<option value="${code}" ${code === item.priceCurrency ? "selected" : ""}>${text}</option>`
        ).join("");
        return `<label class="${cssClass}">${label}<select data-item-id="${id}"
            data-field="priceCurrency" ${item.kind === "door" ||
                isSplitAirConditioner(item) && item.acPlanStatus === "excluded" ||
                isQuotedEquipment(item) || isSwitch(item) || isTrackLighting(item) ||
                isDedicatedCircuit(item) ||
                item.productId != null ||
                isDownlight(item) || item.outletCircuit?.startsWith("additional-") ||
                isCeilingLight(item) &&
                    !["custom", "outdoor-custom"].includes(item.lightSelection)
                ? "disabled" : ""}>${choices}</select></label>`;
    }
    if (name === "doorMaterial") {
        const glass = item.doorId === "main-shower" || item.doorId === "guest-shower";
        const choices = Object.entries(DOOR_OPTIONS)
            .filter(([code]) => glass ? code === "shower-glass" || code === "custom"
                : code !== "shower-glass")
            .map(([code, option]) =>
            `<option value="${code}" ${code === item.doorMaterial ? "selected" : ""}>${escapeHtml(option.label)}</option>`
        ).join("");
        return `<label class="${cssClass}">${label}<select data-item-id="${id}"
            data-field="doorMaterial">${choices}</select></label>`;
    }
    if (name === "partitionMaterial") {
        if (item.id !== BEDROOM2_PARTITION_ID) {
            throw new RangeError("只有臥室2輕隔間能切換隔間做法。");
        }
        const choices = Object.entries(BEDROOM2_PARTITION_OPTIONS)
            .map(([code, option]) =>
                `<option value="${code}" ${code === item.partitionMaterial ? "selected" : ""}>
                    ${escapeHtml(option.label)} · NT$${currency.format(option.unitPrice)}／坪</option>`)
            .join("");
        return `<label class="${cssClass}">${label}<select data-item-id="${id}"
            data-field="partitionMaterial">${choices}</select></label>`;
    }
    if (name === "lightSelection" || name === "trackSelection" ||
        name === "spotlightSelection") {
        const options = name === "lightSelection"
            ? isDownlight(item) ? DOWNLIGHT_OPTIONS : CEILING_LIGHT_OPTIONS
            : name === "trackSelection" ? TRACK_RAIL_OPTIONS : TRACK_SPOTLIGHT_OPTIONS;
        if (name === "lightSelection" && !(isDownlight(item) || isCeilingLight(item)) ||
            name !== "lightSelection" && !isTrackLighting(item)) {
            throw new RangeError("此項目沒有可切換的燈具或軌道選項。");
        }
        const legacy = item[name] == null
            ? '<option value="" selected>目前已儲存設定（尚未選款）</option>' : "";
        const choices = Object.entries(options)
            .filter(([code]) => {
                if (name !== "lightSelection" || !isCeilingLight(item)) return true;
                return item.roomId === "balcony"
                    ? ["outdoor-pending", "outdoor-custom"].includes(code)
                    : !["outdoor-pending", "outdoor-custom"].includes(code);
            })
            .map(([code, option]) =>
            `<option value="${code}" ${item[name] === code ? "selected" : ""}>
                ${escapeHtml(option.label)}</option>`).join("");
        return `<label class="${cssClass}">${label}<select data-item-id="${id}"
            data-field="${name}" ${item.productId ? "disabled" : ""}>
            ${legacy}${choices}</select></label>`;
    }
    if (name === "switchType") {
        if (!isSwitch(item)) throw new RangeError("此項目不是單／雙開關。");
        const options = isOutdoorSwitch(item) ? OUTDOOR_SWITCH_TYPES : SWITCH_TYPES;
        const choices = Object.entries(options).map(([code, option]) =>
            `<option value="${code}" ${item.switchType === code ? "selected" : ""}>
                ${escapeHtml(option.label)}</option>`).join("");
        return `<label class="${cssClass}">${label}<select data-item-id="${id}"
            data-field="switchType" ${item.productId ? "disabled" : ""}>
            ${choices}</select></label>`;
    }
    if (name === "doorOpeningKind") {
        return `<label class="${cssClass}">${label}<select data-item-id="${id}"
            data-field="doorOpeningKind">
            <option value="swing" ${item.doorOpeningKind === "swing" ? "selected" : ""}>平開門</option>
            <option value="slide" ${item.doorOpeningKind === "slide" ? "selected" : ""}>拉門</option>
        </select></label>`;
    }
    if (name === "note") {
        return `<label class="${cssClass}">${label}<textarea data-item-id="${id}" data-field="note" ` +
            `maxlength="1000" rows="2">${value}</textarea></label>`;
    }
    const outdoorDimension = name === "outdoorWidthCm" || name === "outdoorDepthCm";
    const dimension = name === "widthCm" || name === "depthCm" ||
        name === "heightCm" || outdoorDimension;
    const lightNumber = name === "lightWatts" || name === "lightLumens" ||
        name === "beamAngleDeg";
    const trackLength = name === "trackLengthM" || name === "quantity" && isSlideTrack(item);
    const spotCount = name === "spotlightQuantity";
    const numeric = dimension || lightNumber || trackLength || spotCount || name === "quantity" ||
        name === "unitPrice" || name === "installationUnitPrice" ||
        name === "fixtureUnitPrice" || name === "spotlightUnitPrice";
    const lightMinimum = name === "lightWatts" ? .1 : 1;
    const lightMaximum = name === "lightWatts" ? 1000 :
        name === "lightLumens" ? 200000 : 180;
    const inputType = numeric
        ? `type="number" min="${name === "outdoorWidthCm"
            ? OUTDOOR_AC_SIZE_BOUNDS_CM.minWidth : name === "outdoorDepthCm"
                ? OUTDOOR_AC_SIZE_BOUNDS_CM.minDepth :
                dimension ? 0.1 : lightNumber ? lightMinimum : trackLength ? 0.01 : 0}"
            ${name === "outdoorWidthCm" ? `max="${OUTDOOR_AC_SIZE_BOUNDS_CM.maxWidth}"` :
                name === "outdoorDepthCm" ? `max="${OUTDOOR_AC_SIZE_BOUNDS_CM.maxDepth}"` :
                lightNumber ? `max="${lightMaximum}"` :
                trackLength ? 'max="100"' : spotCount ? 'max="12"' : ""}
            step="${spotCount ? 1 : "any"}"` : 'type="text"';
    const maxlength = numeric ? "" : `maxlength="${name === "name" ? 120 :
        name === "unit" ? 16 : name === "priceSource" ||
            name === "spotlightPriceSource" || name === "lightSpecSource" ? 500 : 200}"`;
    const fixedLightWatts = name === "lightWatts" &&
        (item.lightType === "track"
            ? TRACK_SPOTLIGHT_OPTIONS[item.spotlightSelection]?.wattageW != null
            : (item.lightType === "ceiling"
                ? CEILING_LIGHT_OPTIONS : DOWNLIGHT_OPTIONS)[item.lightSelection]
                    ?.wattageW != null);
    const fixedQuoteLabel =
        ((isCeilingLight(item) || isTrackLighting(item) ||
            isDownlight(item) || item.outletCircuit?.startsWith("additional-") ||
            isFreshAirUnit(item) || isToiletRinseKit(item) ||
            isHeatedTowelRail(item) || isBathGrabBar(item)) &&
            (name === "quantity" || name === "unit")) ||
        (isSwitch(item) &&
            (name === "quantity" || name === "unit" ||
                name === "brandModel" && !isOutdoorSwitch(item) &&
                    item.markerStyle !== "square-label")) ||
        (isQuotedOutlet(item) &&
            (name === "quantity" || name === "unit")) ||
        ((isDedicatedCircuit(item) || isWeakCurrent(item)) && (name === "quantity" || name === "unit")) ||
        (isSplitAirConditioner(item) && (name === "quantity" || name === "unit")) ||
        (isQuotedEquipment(item) &&
            (name === "unit" || name === "brandModel" &&
                !isQuotedDownlight(item) && !isQuotedOutlet(item) &&
                    !isQuotedCircuit(item) ||
                name === "name" && !isQuotedSwitch(item) &&
                    !isQuotedOutlet(item) && !isQuotedCircuit(item) ||
                name === "quantity" && (isQuotedSwitch(item) || isQuotedDownlight(item)))) ||
        item.productId != null && ([
            "unit", "unitPrice", "installationUnitPrice", "fixtureUnitPrice",
            "brandModel", "priceSource", "spotlightModel", "spotlightQuantity",
            "spotlightUnitPrice", "spotlightPriceSource", "lightWatts",
            "lightLumens", "beamAngleDeg", "lightSpecSource",
        ].includes(name) || ["widthCm", "depthCm"].includes(name) &&
            state.products.find((entry) => entry.id === item.productId)?.[name] != null) ||
        fixedLightWatts;
    return `<label class="${cssClass}">${label}<input ${inputType} ${maxlength} ` +
        `${fixedQuoteLabel ? "readonly" : ""}
        ${outdoorDimension ? "required" : ""}
        ${isSplitAirConditioner(item) && item.acPlanStatus === "excluded" &&
            name === "unitPrice" ? "disabled" : ""} data-item-id="${id}" ` +
        `data-field="${name}" value="${value}"></label>`;
}

function lightSpecificationNote(item) {
    const room = state.rooms.find((entry) => entry.id === item.roomId);
    const { mode, missing } = lightDataStatus(item, roomGeometry(room), lightingPlaneCm);
    return mode === "lux-estimate"
        ? `已填流明、光束角、來源與房高；可估算${lightingPlaneCm === 80
            ? "80cm 桌面" : "地板"}上的近似直射照度，不含反射或遮蔽。`
        : `無完整資料，照度估算可能不準：缺${missing.join("、")}；${
            item.lightWatts == null
                ? "瓦數也未確認，沿用原光圈示意。"
                : `以${item.lightWatts}W 的相對光圈示意，不換算為流明或 lux。`}`;
}

function lightListStatus(item) {
    const room = state.rooms.find((entry) => entry.id === item.roomId);
    const { missing } = lightDataStatus(item, roomGeometry(room), lightingPlaneCm);
    const watt = item.lightWatts == null ? "瓦數待查" : `每盞 ${item.lightWatts}W`;
    return `${watt} · ${missing.length
        ? `無完整資料，照度估算可能不準（缺${missing.join("、")}）`
        : "可試算近似直射照度（非照明設計）"}`;
}

function renderLightSpecificationFields(item) {
    const perLamp = item.lightType === "track" ? "每盞軌道燈" : "每盞燈具";
    return `${field(item, "lightWatts", `${perLamp}瓦數（W）`, { cssClass: "light-spec-number" })}
        ${field(item, "lightLumens", `${perLamp}光通量（lm）`,
            { cssClass: "light-spec-number" })}
        ${field(item, "beamAngleDeg", "光束角（度）",
            { cssClass: "light-spec-number" })}
        ${field(item, "lightSpecSource", "光學規格來源（型號對應的官方規格／實測來源）",
            { cssClass: "source" })}
        <p class="light-spec-note" data-light-spec-id="${escapeHtml(item.id)}">${
            escapeHtml(lightSpecificationNote(item))}</p>`;
}

function renderDeleteConfirmation(item) {
    if (!item || pendingDeleteId !== item.id) return "";
    const paired = isSocket(item) ? state.items.find((entry) =>
        isDedicatedCircuit(entry) && entry.circuitOutletId === item.id) : null;
    if (paired) return `<div class="delete-confirmation" role="alert">
        <strong>「${escapeHtml(item.name)}」對應「${escapeHtml(paired.name)}」；
            請先將專用迴路改綁其他插座或刪除迴路，才能刪除此插座。</strong>
        <button type="button" data-action="show-paired-circuit"
            data-item-id="${escapeHtml(paired.id)}">調整專用迴路</button>
        <button type="button" data-action="cancel-remove-item">取消</button>
    </div>`;
    const originalSwitch = isQuotedSwitch(item);
    const originalOutlet = isQuotedOutlet(item);
    const circuit = isDedicatedCircuit(item);
    return `<div class="delete-confirmation" role="alert">
        <strong>${originalSwitch
            ? `確定從規劃移除「${escapeHtml(item.name)}」？原報價的 15 個開關基準保留，
                暫按此個 NT$${currency.format(item.quotedUnitPrice)} 列減項，
                實際扣款待廠商確認；日後可恢復。`
            : `確定刪除「${escapeHtml(item.name)}」？
                ${originalOutlet ? "原報仍以 50 個 × NT$1,800 作基準，本次暫列減項。" : ""}
                ${circuit ? `原報 7 條 × NT$4,500 作基準，
                    ${isQuotedCircuit(item) ? "本次暫列減項；" : "刪除此追加項；"}
                    高負載共線可能跳電，建議維持至少 7 條。` : ""}
                ${isSocket(item) || circuit ? "數量、配線與實際扣款請電工核對。" : ""}`}</strong>
        <button type="button" class="confirm-danger" data-action="confirm-remove-item"
            data-item-id="${escapeHtml(item.id)}">${originalSwitch ? "確認移除" : "確認刪除"}</button>
        <button type="button" data-action="cancel-remove-item">取消</button>
    </div>`;
}

function renderMoveOutletConfirmation(item) {
    if (!isQuotedOutlet(item) || pendingMoveOutletId !== item.id) return "";
    const id = escapeHtml(item.id);
    const rooms = state.rooms.filter((room) =>
        room.id !== item.roomId && room.id !== "ac-platform");
    const replacements = state.items.filter((entry) =>
        entry.outletCircuit === "additional-general" && entry.placement &&
        rooms.some((room) => room.id === entry.roomId));
    return `<div class="delete-confirmation outlet-move" role="alert">
        <strong>將「${escapeHtml(item.name)}」移出${escapeHtml(roomName(item.roomId))}？
            可改放其他房間；若要直接減少總數，請改按「刪除」。</strong>
        <label>改放到
            <select data-outlet-move-target>
                <option value="">請選擇新房間或已新增的一般插座</option>
                ${replacements.map((entry) =>
                    `<option value="replace:${escapeHtml(entry.id)}">
                        ${escapeHtml(roomName(entry.roomId))}：取代「${escapeHtml(entry.name)}」
                        （合併為一個，沿用其位置與目前規格／價格）</option>`).join("")}
                ${rooms.map((room) =>
                    `<option value="room:${escapeHtml(room.id)}">
                        ${escapeHtml(room.name)}（先暫標位置，之後可拖曳）</option>`).join("")}
            </select>
        </label>
        <small>對應的專用迴路若有，會一同移到新房；若取代的新增插座也已配迴路，
            須先改綁或刪除其中一條。連動資料庫的新增點合併後會解除連動，
            保留當前規格／價格。實際供電、跳電風險及陽台防水需電工核對。</small>
        <button type="button" data-action="confirm-move-quoted-outlet"
            data-item-id="${id}">確認移轉</button>
        <button type="button" data-action="cancel-move-outlet">取消</button>
    </div>`;
}

function renderQuotedTrackControls(track) {
    return `<div class="track-controls" role="group" aria-label="${escapeHtml(track.name)}">
        <strong>${escapeHtml(track.name)}（原報價已含 0.8 米）</strong>
        <div class="fields">
            ${field(track, "quantity", "暫定軌道長度（米）", { cssClass: "track-length" })}
            <span data-total-id="${escapeHtml(track.id)}">${itemAmountLabel(track)}</span>
        </div>
        <small>每米 NT$${currency.format(SLIDE_TRACK_RATE_TWD)}；
            ${slideTrackNeeded(track.trackDoorId, state.items)
                ? "超過原報價 0.8 米的價差才算追加，實際長度待量。"
                : "目前門型不另用軌道，原報價減項仍須廠商確認。"}</small>
    </div>`;
}

function renderDoorTrackControls(door) {
    const quote = quotedTrackForDoor(door.doorId);
    if (quote) return renderQuotedTrackControls(quote);
    if (door.doorOpeningKind !== "slide") return "";
    if (materialIncludesTrack(door.doorMaterial)) {
        return `<p class="quoted-baseline">原木纖滑門單價已含國產五金、緩衝軌道與軌道盒；
            不另外以每米 NT$${currency.format(SLIDE_TRACK_RATE_TWD)} 計費。</p>`;
    }
    const amount = unquotedTrackCost(door, state.items);
    return `<div class="track-controls" role="group"
        aria-label="${escapeHtml(door.name)}的未報價滑門軌道">
        <strong>滑門軌道（另估）</strong>
        <div class="fields">
            ${field(door, "trackLengthM", "軌道長度（米）", { cssClass: "track-length" })}
            <span data-track-cost-door-id="${escapeHtml(door.doorId)}">
                ${amount === null ? "軌道長度待量、暫不計價" :
                    `軌道追加 NT$${currency.format(amount)}`}</span>
        </div>
        <small>暫按原報價 NT$${currency.format(SLIDE_TRACK_RATE_TWD)}／米試算；
            實際長度、型式及是否適用此單價須請廠商重報。</small>
    </div>`;
}

function renderItemProductSelection(item) {
    const type = productTypeForItem(item);
    const variants = type ? state.products.filter((product) =>
        productCompatibleWithItem(product, item)) : [];
    if (!variants.length && !item.productId) return "";
    const selected = state.products.find((product) => product.id === item.productId);
    if (item.productId && !selected) {
        throw new RangeError(`找不到物件「${item.name}」連動的資料庫商品。`);
    }
    return `<div class="item-product-selection">
        <label>物件資料庫款式
            <select data-item-product-id="${escapeHtml(item.id)}">
                <option value="" ${item.productId ? "" : "selected"}>
                    ${item.productId ? "解除資料庫連動，保留目前規劃價" :
                        "維持此物件原選款（不連動）"}</option>
                ${variants.map((product) =>
                    `<option value="${escapeHtml(product.id)}"
                        ${item.productId === product.id ? "selected" : ""}>
                        ${escapeHtml(productLabel(product))}
                    </option>`).join("")}
            </select>
        </label>
        <small>${item.productId
            ? `已連動「${escapeHtml(selected.brandModel || selected.name)}」；
                型號與售價請到物件資料庫編輯，這裡的商品欄位唯讀。
                改選另一款會更新規劃價；解除連動後可自行改價。`
            : `選擇資料庫款式會更新規劃型號與售價；
                ${isQuotedEquipment(item) ? "原 PDF 報價基準保留，僅試算差額。" :
                    "尚未列價者會加入追加試算。"}
                施工及實際採購仍須確認。`}</small>
        ${selected?.note ? `<small>資料庫備註：${escapeHtml(selected.note)}</small>` : ""}
    </div>`;
}

function renderItem(item, { displayName = null, circuitNumber = null } = {}) {
    const id = escapeHtml(item.id);
    const amountLabel = itemAmountLabel(item);
    const showerDoor = isShowerDoor(item);
    const quotedEquipment = isQuotedEquipment(item);
    const quoted = item.kind === "door" || quotedEquipment;
    const partition = item.id === BEDROOM2_PARTITION_ID;
    const quotedOutlet = isQuotedOutlet(item);
    const socket = isSocket(item);
    const circuit = isDedicatedCircuit(item);
    const quotedCircuit = isQuotedCircuit(item);
    const pairedCircuit = socket ? state.items.find((entry) =>
        isDedicatedCircuit(entry) && entry.circuitOutletId === item.id) : null;
    const linkedSocket = circuit ? state.items.find((entry) =>
        entry.id === item.circuitOutletId) : null;
    const switchItem = isSwitch(item);
    const originalSwitch = isQuotedSwitch(item);
    const removedSwitch = originalSwitch && item.switchPlanStatus === "removed";
    const downlight = isDownlight(item);
    const ceilingLight = isCeilingLight(item);
    const trackLighting = isTrackLighting(item);
    const freshAir = isFreshAirUnit(item);
    const rinseKit = isToiletRinseKit(item);
    const towelRail = isHeatedTowelRail(item);
    const grabBar = isBathGrabBar(item);
    const fanInstallation = isProvisionalFreshAirInstallation(item);
    const splitAC = isSplitAirConditioner(item);
    const excludedAC = splitAC && item.acPlanStatus === "excluded";
    const displayCategory = planDisplayCategory(item);
    const linkedProduct = item.productId
        ? state.products.find((product) => product.id === item.productId) : null;
    if (item.productId && !linkedProduct) {
        throw new RangeError(`找不到物件「${item.name}」連動的資料庫商品。`);
    }
    const visualFurniture = displayCategory === "furniture" &&
        (item.kind === "furniture" || Boolean(item.placement && isPlaceableItem(item)));
    const lightInstallation = ceilingLight || trackLighting ? installationSubtotal(item) : null;
    const details = [
        view === "device" ? roomName(item.roomId) : null,
        linkedProduct ? `資料庫款：${linkedProduct.brandModel || linkedProduct.name}` : null,
        visualFurniture ? "家具 · 可拖曳" : null,
        item.kind === "equipment" && !isAirConditioner(item) && item.orientation !== null
            ? `已轉 ${item.orientation}°` : null,
        fanInstallation ? "原暖風機安裝額度暫借 · 廠商待核" :
        showerDoor ? "玻璃門位｜乾濕分離與防爆膜費用見設備明細" :
            quoted ? `報價已含 NT$${currency.format(item.quotedUnitPrice * item.quotedQuantity)}` : null,
        partition ? `對客廳與走廊共用 ${partitionOption(item).label}` : null,
        quotedOutlet ? "實體電源 · 原報價 50 個中的一個 · 可拖曳標位" : null,
        item.outletCircuit === "additional-general"
            ? "新增實體電源 · 每個暫按 NT$1,800 與原報數量對照" : null,
        pairedCircuit ? `已配「${pairedCircuit.name}」` : null,
        isWeakCurrent(item) ? "弱電 C 埠 · 非電源插座 · 原報弱電7條額度之一，不重複追加" : null,
        item.outletPlanPointId ? `來源標位 ${item.outletPlanPointId}（位置配準待核）` : null,
        circuit ? `專用迴路 · 對應「${linkedSocket?.name ?? "插座待核"}」 ·
            ${quotedCircuit ? "原報 7 條之一" : "另列追加"} · 可拖曳標位` : null,
        switchItem ? removedSwitch ? "原報開關已從規劃移除 · 暫估減項待核" :
            `${quotedSwitchOption(item).label} · ${originalSwitch ? "已報價" : "追加暫估"} ·
                ${isOutdoorSwitch(item) ? "戶外防潮規格與補差待核" : "可拖曳標位"}` : null,
        downlight ? `${isQuotedDownlight(item) ? "原報內" : "新增另計"} · ` +
            "含燈具、配線與安裝 · 天花位置可拖動" : null,
        ceilingLight ? `${item.unitPrice == null ? "燈具本體待報" :
            "燈具本體另計"} · 安裝另計` : null,
        trackLighting ? `1 條 1.5 米軌道 · ${item.spotlightQuantity} 盞軌道燈 · 可拖動整組` : null,
        freshAir ? "室外進氣 · 機型與本體價格待核" :
            rinseKit ? "馬桶旁三叉管＋沖洗器 · 安裝待核" : null,
        towelRail ? "衛浴乾區牆面暫位 · 電源、防潮及安裝待核" :
            grabBar ? "浴缸牆面暫位 · 固定承重待核" : null,
        excludedAC ? "臥室2無可確認室外機路徑 · 原室內標位已保留" :
            splitAC ? `室外機同套暫位：${item.outdoorPlacement
                ? outdoorACZone(item).label : "位置待現勘"} ·
                長 ${item.outdoorWidthCm}×短 ${item.outdoorDepthCm}cm 暫估，
                轉向 ${item.outdoorOrientation ?? 0}°，不另重算本體` : null,
        isSlideTrack(item) && !slideTrackNeeded(item.trackDoorId, state.items)
            ? "目前未使用軌道，減項待廠商確認" : null,
        item.kind === "door" && item.doorOpeningKind === "slide"
            ? materialIncludesTrack(item.doorMaterial) ? "門片單價已含軌道" :
                quotedTrackForDoor(item.doorId) ? "軌道已列原報價" :
                    "軌道另按 NT$1,800／米試算" : null,
        item.placement ? "圖上已標位置" : null,
    ].filter(Boolean).join(" · ");
    return `<details class="equipment" data-id="${id}" ${expandedItems.has(item.id) ? "open" : ""}>
        <summary class="item-summary">
            <span><strong data-item-name="${id}"
                ${circuitNumber === null ? "" :
                    `data-circuit-number="${circuitNumber}"
                    data-paired-socket-id="${escapeHtml(item.circuitOutletId)}"`}>${
                    escapeHtml(displayName ?? (item.name || "未命名設備"))}</strong>
                ${details ? `<small>${escapeHtml(details)}</small>` : ""}
                ${item.lightType ? `<small class="light-inline-status"
                    data-light-status-id="${id}">${
                        escapeHtml(lightListStatus(item))}</small>` : ""}</span>
            <span class="item-amount ${ceilingLight || trackLighting ? "light-assembly-amount" : ""}"
                data-total-id="${id}">
                ${amountLabel}
            </span>
            ${quoted ? `<span class="quoted-tag">${removedSwitch ? "原額度保留／暫減待核" :
                fanInstallation ? "額度待核" :
                showerDoor ? "已報價內門位" : "已含報價"}</span>
                ${originalSwitch ? `<button type="button" class="quick-delete"
                    data-action="${removedSwitch ? "restore-switch" : "request-remove-item"}"
                    data-item-id="${id}">${removedSwitch ? "恢復" : "移除配置"}</button>` :
                    quotedOutlet || quotedCircuit ? `<button type="button" class="quick-delete"
                    data-action="request-remove-item" data-item-id="${id}">刪除</button>` : ""}
                ${quotedOutlet ? `<button type="button" class="quick-delete quoted-outlet-move"
                    data-action="request-move-outlet" data-item-id="${id}">移至別房</button>` : ""}` :
                `<button type="button" class="quick-delete" data-action="request-remove-item"
                    data-item-id="${id}" aria-label="刪除${escapeHtml(item.name)}">刪除</button>`}
        </summary>
        <div class="item-editor">
        ${quoted ? `<p class="quoted-baseline">${fanInstallation
            ? `原報價是「暖風機安裝」1 組 × NT$2,500，
                依你的指示暫拿此額度規劃新風機安裝，
                <strong>並非廠商已報新風機安裝</strong>。
                外牆進氣開孔、管路、防潮與電路須重新估價，
                是否能折抵原項目待確認。`
            : showerDoor
            ? "本房乾濕分離（一字）22,000 元與防爆膜（一字）3,000 元已各列在設備明細，這筆只記玻璃門位；門型變動的額外費用須重新報價。"
            : partition
                ? "原輕隔間報價：臥室2兩道牆合計 5 坪 × NT$7,000＝NT$35,000（雙面雙層）。另兩種做法原表未填數量、未計價；切換時僅用同一 5 坪試算價差，施工範圍待廠商核對。"
            : originalSwitch
                ? `原水電報價：單／雙開關 15 個 × NT$${currency.format(
                    SWITCH_QUOTED_UNIT_PRICE_TWD)}＝NT$33,750；此處按 1 個計，
                    ${removedSwitch ? "本次規劃已移除，暫按 NT$2,250 試算減項，須廠商確認能否扣款。" :
                        "目前型式依下方欄位。"}
                    切換單／雙不自行變動原報單價，規格與價格仍須電工確認。`
            : quotedOutlet
                ? `原水電報價插座迴路共 ${QUOTED_SOCKET_COUNT} 個 ×
                    NT$${currency.format(SOCKET_UNIT_PRICE_TWD)}＝NT$90,000；
                    本插座僅占其中 1 個，專用迴路另以獨立物件計價。
                    插座數量如非 50 個，先按每個 NT$1,800 試算增減，
                    實際扣款、配線和安裝高度仍需向廠商確認。`
            : quotedCircuit
                ? `原水電報價專屬迴路 ${QUOTED_DEDICATED_COUNT} 條 ×
                    NT$${currency.format(DEDICATED_CIRCUIT_UNIT_PRICE_TWD)}＝NT$31,500；
                    本迴路只占其中一條，另與「${escapeHtml(linkedSocket?.name ?? "插座待核")}」
                    配對，不是第二個實體插座。增減每條暫按 NT$4,500 試算；
                    高負載共線可能跳電，建議維持至少 7 條並由電工核對。`
            : downlight
                ? `原水電報價：廚房及兩間衛浴共 6 個 × NT$950＝NT$5,700，
                    每顆已含燈具、配線及安裝。暫按原款燈具約 NT$${currency.format(
                    DOWNLIGHT_FIXTURE_ESTIMATE_TWD)}＋配線安裝約 NT$${currency.format(
                    DOWNLIGHT_INSTALL_ESTIMATE_TWD)} 拆估，非廠商實際拆價；
                    換款以每顆 NT$950 為基準試算價差，雙入組的單顆均攤價不等於
                    零售單買價格。濕區規格、開孔與原燈具折抵須核對。`
            : isSlideTrack(item)
                ? `原輕隔間報價「主浴.工作室」合計 1.6 米 × NT$1,800；
                    這道門先分攤 ${item.quotedQuantity} 米 × NT$${currency.format(item.quotedUnitPrice)}
                    ＝NT$${currency.format(item.quotedQuantity * item.quotedUnitPrice)}。
                    改長度或單價只計價差；若改平開／改用含軌道門片，減項待廠商確認。`
            : `原報價：${item.quotedQuantity} ${escapeHtml(item.unit)} × NT$${currency.format(item.quotedUnitPrice)}；
                規劃單價或數量如有變動，只計入與原報價的價差。`}
        </p>` : ""}
        ${item.outletCircuit === "additional-general" ? `<p class="quoted-baseline">
            此為<strong>原報 50 個插座以外的新增插座</strong>；
            單價先估 NT$1,800，與刪減原報插座的減項共同對照實際總數。
            專用迴路須另建物件並配對；電壓、負載、防護及施工位置待核。
        </p>` : ""}
        ${circuit && !quotedCircuit ? `<p class="quoted-baseline">
            此為原報 7 條之外另列的專用迴路，暫依每條 NT$4,500 估價。
            ${linkedSocket ? `目前對應「${escapeHtml(linkedSocket.name)}」。` : ""}
            須核對總電流、保護開關及跳電風險；建議至少維持 7 條。
        </p>` : ""}
        ${switchItem && !originalSwitch ? `<p class="quoted-baseline">
            此為原報價 15 個以外新增的開關，${item.unitPrice == null
                ? "單價尚未填寫" : `暫按 NT$${currency.format(item.unitPrice)}／個`}
            作<strong>原報價外追加試算</strong>；型式、配線、施工與實際單價待廠商重報。
            ${isOutdoorSwitch(item) ? `此筆是陽台戶外防潮款暫位，不是原報價的室內
                Risna 開關；防雨蓋、進線防水、適用防護等級、漏電保護、
                安裝位置與施工補差另列待報，不能假定原 NT$2,250 足夠。`
                : "可修改單價，未標位前仍會計入規劃中的新增設備。"}</p>` : ""}
        ${freshAir ? `<p class="quoted-baseline">
            目前為<strong>真正引入室外空氣的新風機</strong>，先前的 Panasonic 暖風乾燥機
            不是這種設備，其 NT$6,600 不能沿用。新風機本體型號、衛浴適用性、
            外牆進氣路徑與價格均待核；圖上標記僅作位置示意。</p>` : ""}
        ${rinseKit ? `<p class="quoted-baseline">
            三叉管及馬桶沖洗器一組暫依你提供的特力屋價格
            NT$${currency.format(RINSE_KIT_REFERENCE_PRICE_TWD)}，不含另確認的安裝工；
            須核對馬桶與免治便座進水接頭、防回流與水壓。</p>` : ""}
        ${towelRail ? `<p class="quoted-baseline">
            原報價未明列電熱毛巾架本體或專用供電，不能當作已含；
            既有迴路可否利用及新增的配線、固定安裝費待廠商確認。
            牆面圖示只是暫位，不是施工尺寸。防潮與漏電保護、
            供電迴路、牆體承重及壁面防水收邊須由專業人員核對。</p>` : ""}
        ${grabBar ? `<p class="quoted-baseline">
            原報價未明列客浴浴缸牆面防滑扶手本體、安裝或承重補強；
            圖上的短條只是位置示意，牆體錨固與防水收邊須現場核定。</p>` : ""}
        ${splitAC ? `<p class="quoted-baseline">${excludedAC
            ? "臥室2無可確認的對外窗與通往後方鐵窗的管路；依屋主決定暫不裝分離式冷氣，原標位與方向已保留供日後重啟，不計入待報空調台數。"
            : `圖上的室內機與「外」室外機屬同一套分離式冷氣，
                <strong>室外機不可再重複加一筆本體費</strong>。${item.outdoorPlacement
                    ? outdoorACZone(item).label : "室外機位置待勘"}；
                室外機先按機身長邊 ${item.outdoorWidthCm}cm、
                短邊 ${item.outdoorDepthCm}cm 的<strong>俯視占地比例</strong>繪製，
                預設長邊沿牆，目前轉向 ${item.outdoorOrientation ?? 0}°；
                不是選定實機的寬深或機身高度。${item.outdoorPlacement &&
                    windowsForRoom(item.roomId)
                    .some((window) => window.id === outdoorACZone(item).windowId &&
                        window.widthCm < item.outdoorWidthCm)
                    ? "現況窗洞小於暫估機長，不能假定可由該窗搬運或吊裝；" : ""}
                ${item.outdoorPlacement && outdoorACSceneConflict(item)
                    ? "目前暫估輪廓超出圖示外側範圍，須調整位置或機型；" : ""}
                固定、鐵窗承重、散熱、排水、施工出入與管線都需現場核對。`}</p>` : ""}
        ${downlight && !isQuotedDownlight(item) ? `<p class="quoted-baseline">
            這顆崁燈為原報 6 顆以外新增，燈具本體與安裝拆價合併計算追加；
            原 6 顆的 NT$950 額度不增加。燈具規格、濕區防護、開孔和實際工資待核。
        </p>` : ""}
        ${ceilingLight ? `<p class="quoted-baseline">
            原報價「吸頂燈安裝」單價 NT$${currency.format(CEILING_LIGHT_INSTALL_UNIT_PRICE_TWD)}／個，
            但數量未填、原工程款計 0 元；本盞配線及安裝暫列
            <strong data-light-install-id="${id}">${lightInstallation === null
                ? "待補安裝單價" : `NT$${currency.format(lightInstallation)}`}</strong> 追加。
            燈具本體${item.unitPrice === null ? "型號與價格待選" :
                "按目前選款參考價另外計算"}，未計入原報價；
            若現場改價，請修改下方單價。
        </p>` : ""}
        ${trackLighting ? `<p class="quoted-baseline">
            ${escapeHtml(roomName(item.roomId))} ${CORRIDOR_TRACK_LENGTH_CM}cm 軌道及
            ${item.spotlightQuantity} 盞所選軌道燈；
            ${item.id === CORRIDOR_TRACK_ID
                ? "原選款參考價格由你提供；" :
                    "此為原報價以外另建的軌道燈組；"}
            替代款商品售價與軌道接頭相容性仍待核。
            原報價「軌道燈安裝」僅列 NT$${currency.format(
                CORRIDOR_TRACK_INSTALL_PRICE_TWD)}／條，數量未填、本次計 0 元；
            此組配線及安裝 <strong data-light-install-id="${id}">${
                lightInstallation === null ? "待補安裝單價" :
                    `NT$${currency.format(lightInstallation)}`}</strong> 屬追加，不含於原報價。
            商品連結、天花固定與實際施工價待核。
        </p>` : ""}
        ${renderItemProductSelection(item)}
        <div class="fields">
            ${field(item, "name", item.kind === "door" ? "門位" :
                isSlideTrack(item) ? "門相關費用" : visualFurniture ? "家具" :
                    circuit ? "專用迴路" :
                    displayCategory === "lights" ? "燈具" :
                        displayCategory === "switches" ? "開關" :
                            displayCategory === "outlets" ? "插座" : "設備／家具",
                { cssClass: "name" })}
            ${field(item, "roomId", "裝在哪", { cssClass: "room-field" })}
            ${circuit ? field(item, "circuitOutletId", "對應插座",
                { cssClass: "room-field" }) : ""}
            ${item.kind === "door" ? field(item, "doorMaterial", "門片材質", { cssClass: "door-material" }) +
                field(item, "doorOpeningKind", "開門方式", { cssClass: "door-kind" }) : ""}
            ${partition ? field(item, "partitionMaterial", "輕隔間做法",
                { cssClass: "partition-material" }) : ""}
            ${switchItem ? field(item, "switchType", "開關型式",
                { cssClass: "switch-type" }) : ""}
            ${downlight || ceilingLight ? field(item, "lightSelection", "燈具款式",
                { cssClass: "light-selection" }) : ""}
            ${trackLighting ? field(item, "trackSelection", "軌道款式",
                { cssClass: "light-selection" }) +
                field(item, "spotlightSelection", "軌道燈款式",
                    { cssClass: "light-selection" }) : ""}
            ${field(item, "quantity", "數量", { cssClass: "quantity" })}
            ${field(item, "unit", "單位", { cssClass: "unit" })}
            ${downlight ? field(item, "fixtureUnitPrice", "燈具拆估單價（元／顆）",
                { cssClass: "price" }) +
                field(item, "installationUnitPrice", "配線與安裝拆估（元／顆）",
                    { cssClass: "installation-price" }) +
                `<p class="downlight-breakdown" data-downlight-breakdown-id="${id}">
                    ${downlightPriceBreakdown(item)}</p>` :
                field(item, "unitPrice", showerDoor ? "額外門型價差" :
                    ceilingLight ? "燈具本體單價（待選）" :
                        trackLighting ? "軌道單價（1.5 米）" :
                            circuit ? "專用迴路單價（暫估 4,500）" :
                                socket ? "插座單價（暫估 1,800）" : "單價",
                    { cssClass: "price" })}
            ${trackLighting ? field(item, "spotlightModel", "軌道燈型號（可修改）",
                { cssClass: "model" }) +
                field(item, "spotlightQuantity", "軌道燈數量（盞）",
                    { cssClass: "spotlight-count" }) +
                field(item, "spotlightUnitPrice", "軌道燈單價（元／盞）",
                    { cssClass: "spotlight-price" }) : ""}
            ${item.lightType ? renderLightSpecificationFields(item) : ""}
            ${ceilingLight || trackLighting ? field(item, "installationUnitPrice",
                "配線及安裝單價（另計）", { cssClass: "installation-price" }) : ""}
            ${field(item, "priceCurrency", "幣別", { cssClass: "currency-field" })}
            ${field(item, "brandModel", downlight ? "燈具型號（可修改）" : "品牌／型號",
                { cssClass: "model" })}
            ${item.kind === "door" || quotedEquipment || switchItem || downlight ||
                ceilingLight || trackLighting || displayCategory === "outlets" ? "" :
                field(item, "widthCm", item.kind === "furniture"
                    ? "外形寬度（cm，可修改）" : "實際寬度（cm）", { cssClass: "dimension" }) +
                field(item, "depthCm", item.kind === "furniture"
                    ? "外形深度（cm，可修改）" : "實際深度（cm）", { cssClass: "dimension" })}
            ${item.kind === "door" ? field(item, "widthCm", "門洞淨寬（cm）", { cssClass: "dimension" }) +
                field(item, "heightCm", "門洞淨高（cm）", { cssClass: "dimension" }) : ""}
            ${splitAC ? field(item, "outdoorWidthCm", "室外機機身長邊（cm，暫估）",
                { cssClass: "dimension" }) +
                field(item, "outdoorDepthCm", "室外機機身短邊（cm，暫估）",
                    { cssClass: "dimension" }) : ""}
            ${field(item, "priceSource", trackLighting ? "軌道價格來源" :
                "價格來源（商家或商品連結）", { cssClass: "source" })}
            ${trackLighting ? field(item, "spotlightPriceSource", "軌道燈價格來源",
                { cssClass: "source" }) : ""}
            ${field(item, "note", "備註", { cssClass: "note" })}
        </div>
        ${item.kind === "door" ? renderDoorTrackControls(item) : ""}
        ${quotedEquipment && !switchItem && !downlight && !socket && !circuit
            ? "" : `<div class="equipment-foot">
            <button type="button" data-action="${removedSwitch ? "restore-switch" :
                excludedAC ? "restore-split-ac" : "place-item"}"
                data-item-id="${id}">${removedSwitch ? "恢復此開關" :
                    excludedAC ? "重新評估分離式冷氣" : "在格局圖定位"}</button>
        </div>`}
        </div>
    </details>${renderDeleteConfirmation(item)}${renderMoveOutletConfirmation(item)}`;
}

function renderRoomView() {
    const socketCount = state.items.filter(isSocket).length;
    const circuitCount = state.items.filter(isDedicatedCircuit).length;
    const navigation = state.rooms.map((room) =>
        `<a href="#room-${escapeHtml(room.id)}">${escapeHtml(room.name)}</a>`,
    ).join("");
    const rooms = state.rooms.map((room) => {
        const items = state.items.filter((item) => item.roomId === room.id);
        return `<section class="room" id="room-${escapeHtml(room.id)}">
            <div class="room-head">
                <div><h2>${escapeHtml(room.name)}</h2>
                    <span class="room-count" data-room-subtotal="${escapeHtml(room.id)}"></span></div>
                <div class="room-actions">
                    <button type="button" data-action="add-item" data-room-id="${escapeHtml(room.id)}">＋ 設備</button>
                    ${room.id === "ac-platform" ? "" :
                        `<button type="button" data-action="add-switch"
                            data-room-id="${escapeHtml(room.id)}">＋ 開關</button>
                        <button type="button" data-action="add-socket"
                            data-room-id="${escapeHtml(room.id)}">＋ 插座</button>
                        <button type="button" data-action="add-dedicated-circuit"
                            data-room-id="${escapeHtml(room.id)}">＋ 專用迴路</button>`}
                    <button type="button" data-action="rename-room" data-room-id="${escapeHtml(room.id)}">改名</button>
                    ${knownRoomIds.has(room.id) ? "" :
                        `<button type="button" data-action="remove-room"
                            data-room-id="${escapeHtml(room.id)}">刪除房間</button>`}
                </div>
            </div>
            ${room.id === "ac-platform" ? "" : `<label class="room-height-field">
                天花至地板淨高（cm，實量後填，空白不估照度）
                <input type="number" min="180" max="600" step="any"
                    data-room-dimension="ceilingHeightCm"
                    data-room-id="${escapeHtml(room.id)}"
                    value="${escapeHtml(room.ceilingHeightCm ?? "")}"></label>`}
            ${items.length ? items.map((item) => renderItem(item)).join("") :
                '<p class="empty">尚未列設備，可按「＋ 設備」新增。</p>'}
        </section>`;
    }).join("");
    return `<nav class="room-nav" aria-label="跳至房間">${navigation}</nav>
        ${socketCount !== QUOTED_SOCKET_COUNT || circuitCount !== QUOTED_DEDICATED_COUNT
            ? `<p class="plan-overlap-alert" role="alert">目前 ${socketCount} 個插座
                （原報 50 個）、${circuitCount} 條專用迴路（原報 7 條）。
                增減暫按 NT$1,800／個及 NT$4,500／條試算；
                ${circuitCount < QUOTED_DEDICATED_COUNT
                    ? "迴路少於 7 條可能造成高負載共線跳電，建議至少保留 7 條。" : ""}
                數量與實際配線請電工核對。</p>` : ""}${rooms}`;
}

function socketListName(item) {
    if (!isSocket(item)) throw new TypeError("只有插座可列在一般插座清單。");
    const name = item.name.replace(/^新增(?=一般插座)/, "").trim();
    if (item.outletPlanPointId) return name;
    return name.startsWith("一般插座") ? name : `一般插座－${name}`;
}

function placedItemGroup(item) {
    if (isWeakCurrent(item)) return { key: "weak-current", title: "弱電／網路 C 埠（非電源）" };
    const lightNames = { ceiling: "吸頂燈", recessed: "崁燈", track: "軌道燈組" };
    if (item.lightType && lightNames[item.lightType]) {
        return { key: `light:${item.lightType}`, title: lightNames[item.lightType] };
    }
    if (item.switchType) return { key: "switches", title: "開關" };
    if (isSplitAirConditioner(item)) return { key: "air-conditioner", title: "冷氣" };
    const equipmentNames = {
        "fresh-air": "新風機", "rinse-kit": "三叉管＋沖洗器",
        "heated-towel-rail": "電熱毛巾架", "bath-grab-bar": "防滑扶手",
    };
    if (item.equipmentType && equipmentNames[item.equipmentType]) {
        return { key: `equipment:${item.equipmentType}`,
            title: equipmentNames[item.equipmentType] };
    }
    const icon = objectIconKind(item);
    const iconNames = {
        toilet: "馬桶", bathtub: "浴缸", faucet: "龍頭",
        basin: "面盆／浴櫃", shower: "淋浴設備",
        urinal: "小便斗", "water-heater": "熱水器",
    };
    if (icon) {
        const title = FURNITURE_TEMPLATES[icon]?.name ?? iconNames[icon];
        if (title) return { key: `object:${icon}`, title };
    }
    const title = item.name.trim() || "未命名設備";
    return { key: `name:${title}`, title };
}

function renderDeviceView() {
    const placed = state.items.filter((item) => item.placement && isPlaceableItem(item));
    const roomOrder = new Map(state.rooms.map((room, index) => [room.id, index]));
    const byRoomThenName = (a, b) => roomOrder.get(a.roomId) - roomOrder.get(b.roomId) ||
        a.name.localeCompare(b.name, "zh-Hant") || a.id.localeCompare(b.id);
    const sockets = placed.filter(isSocket).sort(byRoomThenName);
    const circuits = placed.filter(isDedicatedCircuit).sort(byRoomThenName);
    const byType = new Map();
    for (const item of placed.filter((entry) =>
        !isSocket(entry) && !isDedicatedCircuit(entry))) {
        const { key, title } = placedItemGroup(item);
        if (!byType.has(key)) byType.set(key, { title, items: [] });
        byType.get(key).items.push(item);
    }
    const groups = [...byType].sort(([, a], [, b]) =>
        a.title.localeCompare(b.title, "zh-Hant"));
    if (!placed.length) {
        return '<p class="empty">尚無已標位物件；請從「依房間」或格局圖選擇設備後定位。</p>';
    }
    const socketGroup = sockets.length ? `<details class="device-group grouped-device-group"
        data-device-group="sockets" ${openDeviceGroups.has("sockets") ? "open" : ""}>
        <summary class="group-head"><strong class="device-group-title">實體電源插座</strong>
            <span class="room-count">已放置 ${sockets.length} 個 ·
                一般 ${sockets.filter((item) => !isPairedSocket(item, state.items)).length} ·
                已配專用 ${sockets.filter((item) => isPairedSocket(item, state.items)).length} ·
                規劃總數 ${state.items.filter(isSocket).length} 個</span></summary>
        <p class="muted">原報價按 50 個 × NT$1,800 計算；目前總數若非 50 個，
            增減單價與點位須再確認。最後需要多少個插座、多少條迴路，
            仍須依設備負載與施工配置請電工核對。</p>
        ${sockets.map((item) => renderItem(item, {
            displayName: socketListName(item),
        })).join("")}
    </details>` : "";
    const circuitGroup = circuits.length ? `<details class="device-group grouped-device-group"
        data-device-group="circuits" ${openDeviceGroups.has("circuits") ? "open" : ""}>
        <summary class="group-head"><strong class="device-group-title">專用迴路</strong>
            <span class="room-count">已放置 ${circuits.length} 條 ·
                規劃總數 ${state.items.filter(isDedicatedCircuit).length} 條</span></summary>
        <p class="muted">每條迴路對應下列一個實體供電端點，不是另一顆插座；原報價為 7 條 × NT$4,500。
            最後共需幾條迴路、配電容量及跳電風險仍須請電工確認，
            建議至少維持 7 條。此處編號只是清單順序，不是已核定的電路編號。</p>
        ${circuits.map((item, index) => {
            const socket = state.items.find((entry) =>
                entry.id === item.circuitOutletId && isSocket(entry));
            if (!socket) throw new RangeError(`專用迴路「${item.name}」缺少對應插座。`);
            return renderItem(item, {
                displayName: `專用迴路${index + 1}－${socketListName(socket)}`,
                circuitNumber: index + 1,
            });
        }).join("")}
    </details>` : "";
    return `<p class="muted">只列已在格局圖標位的物件；尚未標位設備及原報價施工明細仍可在「依房間」查看。</p>` +
        socketGroup + circuitGroup +
        groups.map(([key, { title, items }]) =>
            `<details class="device-group grouped-device-group"
                data-device-group="${escapeHtml(key)}"
                ${openDeviceGroups.has(key) ? "open" : ""}>
                <summary class="group-head"><strong class="device-group-title">${
                    escapeHtml(title)}</strong>
                    <span class="room-count">${items.length} 件</span></summary>
                ${items.map((item) => renderItem(item)).join("")}
            </details>`).join("");
}

function productDraft(product = null) {
    return {
        id: product?.id ?? null,
        type: product?.type ?? "",
        environment: product?.environment ?? "indoor",
        name: product?.name ?? "",
        brandModel: product?.brandModel ?? "",
        unit: product?.unit ?? "組",
        unitPrice: String(product?.unitPrice ?? ""),
        installationUnitPrice: String(product?.installationUnitPrice ?? ""),
        priceCurrency: product?.priceCurrency ?? "TWD",
        priceSource: product?.priceSource ?? "",
        note: product?.note ?? "",
        widthCm: String(product?.widthCm ?? ""),
        depthCm: String(product?.depthCm ?? ""),
        spotlightModel: product?.spotlightModel ?? "",
        spotlightQuantity: String(product?.spotlightQuantity ?? 3),
        spotlightUnitPrice: String(product?.spotlightUnitPrice ?? ""),
        lightWatts: String(product?.lightWatts ?? ""),
        lightLumens: String(product?.lightLumens ?? ""),
        beamAngleDeg: String(product?.beamAngleDeg ?? ""),
        lightSpecSource: product?.lightSpecSource ?? "",
    };
}

function productDraftChanged(draft) {
    const original = productDraft(draft.id
        ? state.products.find((product) => product.id === draft.id) : null);
    return Object.keys(original).some((key) => draft[key] !== original[key]);
}

function productPriceSummary(product) {
    const amount = (value, code = "TWD") => value == null
        ? "待補" : `${currencySymbols[code]}${currency.format(value)}`;
    if (product.type === "ceiling") {
        return `本體 ${amount(product.unitPrice, product.priceCurrency)} ＋ 安裝
            ${amount(product.installationUnitPrice)}`;
    }
    if (product.type === "recessed") {
        const total = installedDownlightUnitPrice(
            product.unitPrice, product.installationUnitPrice
        );
        return `燈具 ${amount(product.unitPrice)} ＋ 安裝
            ${amount(product.installationUnitPrice)}＝每顆 ${amount(total)}`;
    }
    if (product.type === "track") {
        const spots = product.spotlightQuantity === 0 ? 0 :
            product.spotlightUnitPrice == null ? null :
                product.spotlightQuantity * product.spotlightUnitPrice;
        return `軌道 ${amount(product.unitPrice)} ＋
            ${product.spotlightQuantity} 盞燈 ${amount(spots)} ＋
            安裝 ${amount(product.installationUnitPrice)}`;
    }
    return `商品 ${amount(product.unitPrice, product.priceCurrency)}／${product.unit}`;
}

function renderProductForm() {
    const draft = pendingProduct;
    const type = draft.type;
    const lighting = ["ceiling", "recessed", "track"].includes(type);
    const environmentChoices = type === "equipment"
        ? ["indoor", "balcony", "any"]
        : ["recessed", "track"].includes(type)
            ? ["indoor"] : ["indoor", "balcony"];
    const priceLabel = type === "recessed" ? "每顆燈具本體單價" :
        type === "ceiling" ? "每盞燈具本體單價" :
            type === "track" ? "每條 1.5 米軌道單價" :
                type === "outlet-general" ? "每個一般插座單價（暫估 1,800）" :
                    type === "dedicated-circuit"
                        ? "每條專用迴路單價（暫估 4,500）" : "商品單價";
    return `<section class="product-form-panel" aria-label="${draft.id
        ? "編輯資料庫商品" : "新增資料庫商品"}">
        <h3>${draft.id ? "編輯商品規格與售價" : "新增商品款式"}</h3>
        <p class="muted">資料庫裡可先存多款規格，還未放入房間時不計價。
            更新售價會同步更新選用本款的規劃物件，但不改原報價基準。</p>
        <form id="product-form">
            <div class="fields">
                <label class="name">物件種類
                    <select data-product-type required ${draft.id ? "disabled" : ""}>
                        <option value="">請選擇物件種類</option>
                        ${Object.entries(PRODUCT_TYPES).map(([key, label]) =>
                            `<option value="${key}" ${key === type ? "selected" : ""}>
                                ${escapeHtml(label)}</option>`).join("")}
                    </select></label>
                ${type ? `<label class="room-field">適用環境
                    <select data-product-environment ${draft.id ? "disabled" : ""}>
                        ${environmentChoices.map((key) =>
                            `<option value="${key}"
                                ${key === draft.environment ? "selected" : ""}>
                                ${escapeHtml(PRODUCT_ENVIRONMENTS[key])}</option>`).join("")}
                    </select></label>
                    <label class="name">商品名稱（例如：吸頂燈）
                        <input type="text" data-product-field="name" maxlength="120" required
                            value="${escapeHtml(draft.name)}"></label>
                    <label class="model">品牌／型號／規格${type === "equipment"
                        ? "（可留白）" : "（必填，例如 32W 調光款）"}
                        <input type="text" data-product-field="brandModel" maxlength="200"
                            ${type === "equipment" ? "" : "required"}
                            value="${escapeHtml(draft.brandModel)}"></label>
                    <label class="unit">單位
                        <input type="text" data-product-field="unit" maxlength="16"
                            value="${escapeHtml(draft.unit)}" required
                            ${type === "equipment" ? "" : "readonly"}></label>
                    ${["equipment", "ceiling"].includes(type)
                        ? `<label class="currency-field">商品幣別
                            <select data-product-field="priceCurrency">
                                ${[["TWD", "新台幣"], ["JPY", "日圓"], ["USD", "美元"]]
                                    .map(([code, label]) => `<option value="${code}"
                                        ${draft.priceCurrency === code ? "selected" : ""}>
                                        ${label}</option>`).join("")}
                            </select></label>` : ""}
                    <label class="price">${priceLabel}（可留白待報）
                        <input type="number" data-product-field="unitPrice" min="0"
                            step="any" value="${escapeHtml(draft.unitPrice)}"></label>
                    ${lighting ? `<label class="installation-price">安裝單價（另計，可留白）
                        <input type="number" data-product-field="installationUnitPrice"
                            min="0" step="any"
                            value="${escapeHtml(draft.installationUnitPrice)}"></label>` : ""}
                    ${type === "track" ? `<label class="model">軌道燈型號／規格
                        <input type="text" data-product-field="spotlightModel"
                            maxlength="200" value="${escapeHtml(draft.spotlightModel)}"></label>
                        <label class="quantity">燈具數量（0–12）
                            <input type="number" data-product-field="spotlightQuantity"
                                min="0" max="12" step="1" required
                                value="${escapeHtml(draft.spotlightQuantity)}"></label>
                        <label class="price">每盞軌道燈單價
                            <input type="number" data-product-field="spotlightUnitPrice"
                                min="0" step="any"
                                value="${escapeHtml(draft.spotlightUnitPrice)}"></label>` : ""}
                    ${lighting ? `<label class="light-spec-number">每盞燈具瓦數（W，可留白待查）
                        <input type="number" data-product-field="lightWatts" min="0.1"
                            max="1000" step="any" value="${escapeHtml(draft.lightWatts)}"></label>
                        <label class="light-spec-number">每盞光通量（lm，可留白）
                            <input type="number" data-product-field="lightLumens" min="1"
                                max="200000" step="any"
                                value="${escapeHtml(draft.lightLumens)}"></label>
                        <label class="light-spec-number">光束角（度，可留白）
                            <input type="number" data-product-field="beamAngleDeg"
                                min="1" max="180" step="any"
                                value="${escapeHtml(draft.beamAngleDeg)}"></label>
                        <label class="source">光學資料來源（與價格來源分開）
                            <input type="text" data-product-field="lightSpecSource"
                                maxlength="450"
                                value="${escapeHtml(draft.lightSpecSource)}"></label>
                        <p class="light-spec-note">只有光通量、光束角、可追溯來源及房高
                            都具備時才估算近似直射照度；否則僅按瓦數示意光圈。
                            軌道燈規格為<strong>每盞</strong>而非整條合計。</p>` : ""}
                    ${type === "equipment" ? `<label class="dimension">商品寬度（cm）
                        <input type="number" data-product-field="widthCm" min="0.1"
                            max="3000" step="any" value="${escapeHtml(draft.widthCm)}">
                    </label><label class="dimension">商品深度（cm）
                        <input type="number" data-product-field="depthCm" min="0.1"
                            max="3000" step="any" value="${escapeHtml(draft.depthCm)}">
                    </label>` : ""}
                    <label class="source">價格來源（商家或商品連結）
                        <input type="text" data-product-field="priceSource"
                            maxlength="450" value="${escapeHtml(draft.priceSource)}"></label>
                    <label class="note">規格／採購備註
                        <textarea data-product-field="note" maxlength="800"
                            rows="2">${escapeHtml(draft.note)}</textarea></label>
                    <p class="add-preview">吸頂燈的本體與安裝分列；崁燈本體與安裝合計，
                        軌道另含燈具費。價格留白是待報，不是免費。
                        陽台選款仍須核對防潮、配線及合法安裝。</p>` :
                    '<p class="add-preview">先選物件種類，再輸入多款不同型號與售價。</p>'}
            </div>
            <div class="add-actions">
                <button type="submit" class="primary">${draft.id
                    ? "儲存款式並同步連動物件" : "儲存至物件資料庫"}</button>
                <button type="button" data-action="cancel-product-form">取消</button>
            </div>
        </form>
    </section>`;
}

function renderDatabaseView() {
    const groups = Object.entries(PRODUCT_TYPES).map(([type, label]) => {
        const products = state.products.filter((entry) => entry.type === type);
        if (!products.length) return "";
        return `<section class="product-group" aria-label="${escapeHtml(label)}商品">
            <h3>${escapeHtml(label)} · ${products.length} 款</h3>
            ${products.map((product) => {
                const used = state.items.filter((item) => item.productId === product.id);
                return `<div class="product-card" data-product-id="${escapeHtml(product.id)}">
                    <div class="product-description">
                        <strong>${escapeHtml(product.name)}</strong>
                        <small>${escapeHtml(product.brandModel || "規格待選")} ·
                            ${escapeHtml(PRODUCT_ENVIRONMENTS[product.environment])} ·
                            已連動 ${used.length} 個（已標位
                            ${used.filter((item) => item.placement).length} 個）</small>
                        ${product.note ? `<small>${escapeHtml(product.note)}</small>` : ""}
                        ${["ceiling", "recessed", "track"].includes(product.type)
                            ? `<small>光學：${product.lightWatts == null
                                ? "瓦數待查" : `${product.lightWatts}W`} ·
                                ${product.lightLumens == null ? "流明待查" :
                                    `${product.lightLumens}lm`} ·
                                ${product.beamAngleDeg == null ? "光束角待查" :
                                    `${product.beamAngleDeg}°`} ·
                                ${product.lightSpecSource ? `來源：${escapeHtml(product.lightSpecSource)}`
                                    : "光學來源待查"}</small>` : ""}
                        ${product.priceSource
                            ? `<small>價格來源：${escapeHtml(product.priceSource)}</small>` : ""}
                    </div>
                    <span class="product-price">${escapeHtml(productPriceSummary(product))}</span>
                    <button type="button" data-action="edit-product"
                        data-product-id="${escapeHtml(product.id)}">編輯</button>
                    <button type="button" data-action="request-remove-product"
                        data-product-id="${escapeHtml(product.id)}"
                        ${used.length ? "disabled" : ""}
                        title="${used.length ? "已有物件連動，請先換款或解除連動" :
                            "刪除未使用的商品款式"}">刪除</button>
                    ${pendingProductDeleteId === product.id
                        ? `<div class="delete-confirmation" role="alert">
                            <span>確定刪除此款？已放置物件與報價不會受影響。</span>
                            <button type="button" data-action="confirm-remove-product"
                                data-product-id="${escapeHtml(product.id)}">確認刪除</button>
                            <button type="button" data-action="cancel-remove-product">取消</button>
                        </div>` : ""}
                </div>`;
            }).join("")}
        </section>`;
    }).join("");
    return `<section class="product-database">
        <div class="database-head">
            <div><h2>物件資料庫</h2>
                <p class="muted">先儲存多款型號與參考售價，再於新增設備時選種類與款式。
                    資料庫商品本身不計入規劃總額；修改款式會同步已連動物件的
                    規劃售價，原 PDF 已報基準保留。</p></div>
            ${pendingNewItem ? `<button type="button"
                data-action="return-to-new-item">← 返回正在新增的設備</button>` : ""}
            <button type="button" data-action="add-product">＋ 新增商品款式</button>
        </div>
        ${pendingProduct ? renderProductForm() : ""}
        ${groups || '<p class="empty">資料庫目前沒有商品；請按「＋ 新增商品款式」先建立不同規格。</p>'}
        <p class="muted">已在圖上標位的實物請看「已放置物件清單」；
            未標位的原報價施工與預留設備仍在「依房間」中。自訂售價尚須廠商確認。</p>
    </section>`;
}

function renderNewItemForm() {
    const draft = pendingNewItem;
    const type = draft.productType;
    const availableSockets = state.items.filter((socket) =>
        isSocket(socket) && socket.roomId === draft.roomId && socket.placement &&
        !state.items.some((item) =>
            isDedicatedCircuit(item) && item.circuitOutletId === socket.id));
    const catalog = draft.roomId && type
        ? equipmentCatalog(state.items, draft.roomId)
            .filter((entry) => catalogType(entry.source) === type &&
                !entry.source.productId) : [];
    const databaseOptions = state.products.filter((product) =>
        product.type === type && productAllowedInRoom(product, draft.roomId));
    const selected = catalog.find((entry) =>
        `item:${entry.id}` === draft.templateId);
    const selectedProduct = databaseOptions.find((product) =>
        `product:${product.id}` === draft.templateId);
    const custom = draft.templateId === "custom";
    const roomChoices = state.rooms.map((room) =>
        `<option value="${escapeHtml(room.id)}" ${draft.roomId === room.id ? "selected" : ""}>
            ${escapeHtml(room.name)}</option>`).join("");
    const availableTypes = Object.entries(PRODUCT_TYPES)
        .filter(([key]) => draft.roomId !== "ac-platform" ||
            key === "equipment")
        .filter(([key]) => draft.roomId !== "balcony" ||
            key !== "recessed" && key !== "track")
        .map(([key, label]) => `<option value="${key}"
            ${key === type ? "selected" : ""}>${escapeHtml(label)}</option>`).join("");
    const extraInstallation = ["ceiling", "recessed", "track"].includes(type);
    const priceLabel = type === "recessed" ? "崁燈本體單價（不含安裝）" :
        type === "ceiling" ? "吸頂燈本體單價（不含安裝）" :
            type === "track" ? "軌道單價（不含燈與安裝）" :
                type === "outlet-general" ? "插座單價（暫估 1,800）" :
                    type === "dedicated-circuit"
                        ? "專用迴路單價（暫估 4,500）" : "商品單價";
    return `<section class="new-equipment" aria-label="新增設備商品">
        <h2>新增設備｜先選種類，再選商品款式</h2>
        <p class="muted">資料庫款式的規劃售價會與資料庫連動；也可沿用已列商品作單次參考，
            或自行填寫不連動。選款不會建立設備，確認後才另列一筆追加；
            插座按每個 NT$1,800、專用迴路按每條 NT$4,500 暫估，
            分別對照原報 50 個與 7 條，數量偏離時須與電工重核。</p>
        <form id="new-equipment-form">
            <div class="fields">
                <label class="room-field">放置房間
                    <select data-add-room required>
                        <option value="">請先選擇房間</option>${roomChoices}
                    </select></label>
                <label class="name">物件種類
                    <select data-add-product-type required>
                        <option value="">請選種類（例如：吸頂燈）</option>
                        ${availableTypes}
                    </select></label>
                <label class="model">此種類的商品款式
                    <select data-add-template required ${draft.roomId && type ? "" : "disabled"}>
                        <option value="">請選擇型號／規格…</option>
                        ${databaseOptions.length ? `<optgroup label="物件資料庫｜售價連動">
                            ${databaseOptions.map((product) =>
                                `<option value="product:${escapeHtml(product.id)}"
                                    ${draft.templateId === `product:${product.id}`
                                        ? "selected" : ""}>
                                    ${escapeHtml(productLabel(product))}
                                </option>`).join("")}</optgroup>` : ""}
                        ${catalog.length ? `<optgroup label="已列設備參考款｜單次複製">
                            ${catalog.map((entry) =>
                                `<option value="item:${escapeHtml(entry.id)}"
                                    ${draft.templateId === `item:${entry.id}`
                                        ? "selected" : ""}>
                                    ${escapeHtml(entry.label)}
                                </option>`).join("")}</optgroup>` : ""}
                        <option value="custom" ${custom ? "selected" : ""}>
                            ＋ 自行填寫一次（不加入資料庫）</option>
                    </select></label>
                ${type === "dedicated-circuit" ? `<label class="room-field">
                    對應的已標位一般插座（必選）
                    <select data-add-circuit-outlet-id required
                        ${availableSockets.length ? "" : "disabled"}>
                        <option value="">請選一個尚未配對的插座</option>
                        ${availableSockets.map((socket) =>
                            `<option value="${escapeHtml(socket.id)}"
                                ${draft.circuitOutletId === socket.id ? "selected" : ""}>
                                ${escapeHtml(socket.name)}</option>`).join("")}
                    </select></label>
                    ${availableSockets.length ? "" :
                        '<p class="add-preview">此房尚無未配對、已標位的一般插座；請先新增並在圖上放置插座。</p>'}`
                    : ""}
                ${selectedProduct ? `<p class="add-preview">選用資料庫款
                    <strong>${escapeHtml(productLabel(selectedProduct))}</strong>；
                    ${escapeHtml(productPriceSummary(selectedProduct))}。
                    日後在資料庫改價，此物件的規劃售價會同步更新；安裝仍待核。
                </p>` : ""}
                ${selected ? `<p class="add-preview">套用
                    <strong>${escapeHtml(selected.source.name)}</strong>的商品型號、
                    ${selected.source.unitPrice == null ? "待補單價" :
                        `${currencySymbols[selected.source.priceCurrency]}
                            ${currency.format(selected.source.unitPrice)} 參考單價`}。
                    ${selected.group === "lights" ? "燈具與安裝、軌道與燈具分項照原範本暫估。" :
                        selected.group === "circuits"
                            ? "須另外指定一個一般插座，迴路與插座分筆計價。" : ""}
                    新品仍須由廠商核對工資和施工規格。
                </p>` : ""}
                ${custom ? `<label class="name">商品名稱（必填）
                        <input type="text" data-add-field="name" maxlength="120" required
                            value="${escapeHtml(draft.name)}" placeholder="例如：書桌插座">
                    </label>
                    <label class="model">品牌／型號（可留白待選）
                        <input type="text" data-add-field="model" maxlength="200"
                            value="${escapeHtml(draft.model)}"></label>
                    ${type === "equipment" ? `<label class="quantity">數量
                        <input type="number" data-add-field="quantity" min="0.01"
                            step="any" required value="${escapeHtml(draft.quantity)}"></label>
                        <label class="unit">單位
                            <input type="text" data-add-field="unit" maxlength="16" required
                                value="${escapeHtml(draft.unit)}"></label>
                        <label class="currency-field">幣別
                            <select data-add-field="priceCurrency">
                            ${[["TWD", "新台幣"], ["JPY", "日圓"], ["USD", "美元"]]
                                .map(([code, label]) => `<option value="${code}"
                                ${draft.priceCurrency === code ? "selected" : ""}>
                                    ${label}</option>`).join("")}</select></label>` : ""}
                    <label class="price">${priceLabel}（可留白待報）
                        <input type="number" data-add-field="unitPrice" min="0"
                            step="any" value="${escapeHtml(draft.unitPrice)}"></label>
                    ${extraInstallation ? `<label class="installation-price">
                        安裝單價（另外試算；可留白）
                        <input type="number" data-add-field="installationPrice" min="0"
                            step="any" value="${escapeHtml(draft.installationPrice)}">
                    </label>` : ""}
                    ${type === "track" ? `<label class="model">軌道燈型號（預設 3 盞）
                        <input type="text" data-add-field="spotlightModel" maxlength="200"
                            value="${escapeHtml(draft.spotlightModel)}"></label>
                        <label class="price">每盞軌道燈單價
                            <input type="number" data-add-field="spotlightPrice"
                                min="0" step="any" value="${escapeHtml(draft.spotlightPrice)}">
                        </label>` : ""}
                    ${extraInstallation ? `<label class="light-spec-number">每盞燈具瓦數（W，可留白）
                        <input type="number" data-add-field="lightWatts" min="0.1"
                            max="1000" step="any" value="${escapeHtml(draft.lightWatts)}"></label>
                        <label class="light-spec-number">每盞光通量（lm，可留白）
                            <input type="number" data-add-field="lightLumens" min="1"
                                max="200000" step="any"
                                value="${escapeHtml(draft.lightLumens)}"></label>
                        <label class="light-spec-number">光束角（度，可留白）
                            <input type="number" data-add-field="beamAngleDeg" min="1"
                                max="180" step="any"
                                value="${escapeHtml(draft.beamAngleDeg)}"></label>
                        <label class="source">光學資料來源（有可核對型號與連結再填）
                            <input type="text" data-add-field="lightSpecSource"
                                maxlength="500"
                                value="${escapeHtml(draft.lightSpecSource)}"></label>
                        <p class="light-spec-note">資料不足仍可新增，但僅作瓦數相對示意；
                            未填瓦數沿用原示意半徑。光通量不是功率的換算值。</p>`
                    : ""}
                    <label class="source">商品價格來源（可留白）
                        <input type="text" data-add-field="priceSource" maxlength="450"
                            value="${escapeHtml(draft.priceSource)}"></label>
                    <label class="note">備註
                        <textarea data-add-field="note" maxlength="800"
                            rows="2">${escapeHtml(draft.note)}</textarea></label>
                    <p class="add-preview">${type === "dedicated-circuit"
                        ? "每條迴路須選一個實體插座；減少迴路或共用高負載可能跳電，建議維持至少 7 條。"
                        : type === "outlet-general"
                        ? "每顆插座先估 NT$1,800；與原報 50 顆差額要向電工核對，專線另設物件。"
                        : type === "recessed"
                        ? "崁燈需填本體及安裝兩個單價才會列入已知總價；未填價格仍列待補。"
                        : type === "track"
                            ? "新增一條 150cm 軌道與預設 3 盞軌道燈；可在明細調整燈數。"
                            : "新商品未經廠商確認；空白單價不視為免費。"}</p>` : ""}
            </div>
            <div class="add-actions">
                <button type="submit" class="primary">確認新增設備</button>
                <button type="button" data-action="cancel-new-item">取消</button>
            </div>
        </form>
        <p class="muted">找不到合適規格？
            <button type="button" data-action="go-product-database">先到物件資料庫新增款式</button>
            ，回來再選即可；戶外款須另確認適用性。</p>
    </section>`;
}

function openProductForm(id = null) {
    if (invalidInputs.size || conflicted) {
        setStatus("請先修正未儲存的數字或版本衝突，再編輯商品資料庫。", "error");
        return;
    }
    if (pendingProduct && productDraftChanged(pendingProduct) &&
        !window.confirm("目前商品欄位尚未儲存，確定放棄後改編輯另一款？")) {
        return;
    }
    const product = id ? state.products.find((entry) => entry.id === id) : null;
    if (id && !product) {
        setStatus("資料庫找不到這款商品，請重新載入。", "error");
        return;
    }
    if (!id && state.products.length >= 200) {
        setStatus("物件資料庫已達 200 款上限，無法新增。", "error");
        return;
    }
    pendingProduct = productDraft(product);
    pendingProductDeleteId = null;
    view = "database";
    render();
    content.querySelector(product ? '[data-product-field="name"]' :
        "[data-product-type]")?.focus();
}

function saveProductForm(form) {
    const draft = pendingProduct;
    if (!draft || !form.reportValidity()) return;
    if (invalidInputs.size || conflicted) {
        setStatus("請先修正無效數字或版本衝突，再儲存商品款式。", "error");
        return;
    }
    const previous = draft.id
        ? state.products.find((product) => product.id === draft.id) : null;
    if (draft.id && !previous) {
        setStatus("此商品已不在資料庫，請重新載入。", "error");
        return;
    }
    let product;
    let updatedItems;
    try {
        product = productFromDraft(draft, draft.id ?? crypto.randomUUID());
        if (previous && (product.type !== previous.type ||
            product.environment !== previous.environment)) {
            throw new RangeError("已有商品不可更換種類或使用環境；請另建新款。");
        }
        updatedItems = state.items.map((item) =>
            item.productId === product.id ? applyProductToItem(product, item) : item);
    } catch (error) {
        if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
        setStatus(error.message, "error");
        return;
    }
    const linkedCount = state.items.filter((item) => item.productId === product.id).length;
    state.products = previous
        ? state.products.map((entry) => entry.id === product.id ? product : entry)
        : [...state.products, product];
    state.items = updatedItems;
    if (pendingNewItem?.productType === product.type &&
        productAllowedInRoom(product, pendingNewItem.roomId)) {
        pendingNewItem.templateId = `product:${product.id}`;
    }
    pendingProduct = null;
    scheduleSave();
    render();
    setStatus(previous
        ? `已更新資料庫款式與 ${linkedCount} 個連動物件；原報價基準未變，正在儲存。`
        : "已新增商品款式；尚未放入房間，不計入規劃總額。正在儲存。");
}

function requestRemoveProduct(id) {
    if (pendingProduct) {
        setStatus("請先儲存或取消正在編輯的商品，再刪除資料庫款式。", "error");
        return;
    }
    const product = state.products.find((entry) => entry.id === id);
    if (!product) {
        setStatus("資料庫找不到要刪除的商品。", "error");
        return;
    }
    if (state.items.some((item) => item.productId === id)) {
        setStatus("這款仍被物件使用；請先替換已放置物件的款式或解除連動。", "error");
        return;
    }
    pendingProductDeleteId = id;
    render();
}

function confirmRemoveProduct(id) {
    if (pendingProductDeleteId !== id ||
        !state.products.some((entry) => entry.id === id) ||
        state.items.some((item) => item.productId === id) ||
        invalidInputs.size || conflicted) {
        setStatus("商品刪除確認已失效，或已有物件連動；未變更資料庫。", "error");
        return;
    }
    state.products = state.products.filter((entry) => entry.id !== id);
    pendingProductDeleteId = null;
    scheduleSave();
    render();
}

function selectPlanRoom(roomId, itemId = null) {
    const room = state.rooms.find((entry) => entry.id === roomId);
    if (!room) {
        setStatus("找不到這個房間，請重新載入。", "error");
        return;
    }
    if (planRoomId !== roomId) furnitureTemplatesOpen = false;
    planRoomId = roomId;
    pendingDeleteId = null;
    pendingMoveOutletId = null;
    pendingObject = null;
    rotateHandleHidden = false;
    const items = state.items.filter((item) => item.roomId === roomId && isPlaceableItem(item));
    selectedPlanItemId = itemId && items.some((item) => item.id === itemId)
        ? itemId
        : items.find((item) => item.name.includes("馬桶"))?.id ?? items[0]?.id ?? null;
    view = "plan";
    render();
    content.querySelector(".plan-detail")?.scrollIntoView({ block: "start" });
}

function placementDescription(position) {
    if (!position) return "尚未標記位置";
    const horizontal = position.x < 1 / 3 ? "左" : position.x > 2 / 3 ? "右" : "中";
    const vertical = position.y < 1 / 3 ? "上" : position.y > 2 / 3 ? "下" : "中";
    return `圖上${vertical}${horizontal}（橫向 ${Math.round(position.x * 100)}%、縱向 ${Math.round(position.y * 100)}%）`;
}

function renderDoorMaterialLegend() {
    return `<p class="door-material-legend" aria-label="門片材質圖例">
        <span class="material-sample material-solid-wood">實木</span>
        <span class="material-sample material-wood-fiber">木纖</span>
        <span class="material-sample material-bathroom">塑鋼</span>
        <span class="material-sample material-wood-slide">木纖滑門</span>
        <span class="material-sample material-shower-glass">玻璃</span>
        <span class="material-sample material-custom">自訂待報</span>
        <span class="material-sample material-unquoted">未列報價</span>
        <small>顏色與線重只區分門片選項，不代表實際成品顏色或厚度；
            門弧／雙線軌道仍表示平開／拉門。</small>
    </p>`;
}

function renderPartitionControls(partition) {
    const baseline = partition.quotedQuantity * partition.quotedUnitPrice;
    return `<section class="partition-choices" role="group"
        aria-label="臥室2對客廳與走廊兩道輕隔間的共用做法及價格">
        <h3>臥室2輕隔間｜對客廳＋對走廊</h3>
        <p class="quoted-baseline">原報價雙面雙層：
            ${BEDROOM2_PARTITION_QUOTED_AREA} 坪 ×
            NT$${currency.format(partition.quotedUnitPrice)}＝NT$${currency.format(baseline)}，
            已含於原工程款。替代做法原表未填數量；這裡沿用兩道牆合計 5 坪試算。</p>
        <div class="fields">
            ${field(partition, "partitionMaterial", "兩道牆共用做法",
                { cssClass: "partition-material" })}
            ${field(partition, "quantity", "合計坪數（坪）", { cssClass: "partition-area" })}
            ${field(partition, "unitPrice", "目前單價（元／坪）",
                { cssClass: "partition-price" })}
        </div>
        <p class="partition-cost" data-partition-budget>${partitionBudgetLabel(partition)}</p>
        <small>彩色牆線及雙線只示意材料做法，不代表實際牆厚；單面單層的另一側處理、
            隔音與施工適用性須請廠商重報。</small>
    </section>`;
}

function renderSelectedLightControls(item) {
    const downlight = isDownlight(item);
    if (!downlight && !isCeilingLight(item)) return "";
    return `<section class="light-choices" role="group"
        aria-label="${escapeHtml(item.name)}的燈具選款與費用">
        <h3>${escapeHtml(item.name)}｜燈具選款</h3>
        <div class="fields">
            ${field(item, "lightSelection", "燈具款式", { cssClass: "light-selection" })}
            ${downlight
                ? field(item, "fixtureUnitPrice", "燈具拆估單價（元／顆）",
                    { cssClass: "price" }) +
                    field(item, "installationUnitPrice", "配線安裝拆估（元／顆）",
                        { cssClass: "installation-price" })
                : field(item, "unitPrice", "燈具本體單價（元／盞）",
                    { cssClass: "price" }) +
                    field(item, "installationUnitPrice", "配線與安裝單價（元／盞）",
                        { cssClass: "installation-price" })}
            ${renderLightSpecificationFields(item)}
        </div>
        ${downlight ? `<p class="downlight-breakdown"
            data-downlight-breakdown-id="${escapeHtml(item.id)}">
            ${downlightPriceBreakdown(item)}</p>` :
            `<p class="light-cost" data-light-summary-id="${escapeHtml(item.id)}">
                ${itemAmountLabel(item)}</p>`}
        <small>${downlight
            ? isQuotedDownlight(item)
                ? `原報價含燈具與安裝每顆 NT$950；材料約 NT$200、施工約 NT$750
                    只作暫估。兩入組售價按單顆均攤，實際購買與原燈具抵扣待核。`
                : `此為原報 6 顆以外新增，材料與安裝合計全額追加；
                    選款售價與施工拆價須重新核對。`
            : item.roomId === "balcony"
                ? `陽台須確認有可固定的遮蔽頂與合適戶外防護等級；
                    NT$1,200 只是原室內吸頂燈安裝單價暫估，防水配線與實價待重報。`
            : `原報價安裝單價 NT$1,200／盞、數量未填且本次計 0 元；
                燈具商品參考售價另列，實際安裝與電路待核。`}</small>
    </section>`;
}

function trackBudgetLabel(item) {
    const rail = subtotal(item, state.items);
    const lamps = spotlightSubtotal(item);
    const installation = installationSubtotal(item);
    if (rail === null || lamps === null || installation === null) {
        return `${itemAmountLabel(item)}；缺少的單價不計入暫計總額。`;
    }
    return `軌道 NT$${currency.format(rail)} ＋ ${item.spotlightQuantity} 盞燈
        NT$${currency.format(lamps)} ＋ 安裝 NT$${currency.format(installation)}
        ＝已知追加 NT$${currency.format(rail + lamps + installation)}`;
}

function renderCorridorTrackControls(item) {
    return `<section class="corridor-light-choices" role="group"
        aria-label="走廊軌道、軌道燈及配線安裝費用">
        <h3>走廊軌道與軌道燈</h3>
        <p class="quoted-baseline">一條 ${CORRIDOR_TRACK_LENGTH_CM}cm 黑色軌道及
            ${item.spotlightQuantity} 盞軌道燈沿走廊天花示意；拖動軌道會帶著燈具一起移動。
            原報價只列每條 NT$${currency.format(CORRIDOR_TRACK_INSTALL_PRICE_TWD)}
            的安裝單價、數量未填且本次 0 元，此組軌道、燈具與安裝均屬追加暫估。</p>
        <div class="fields">
            ${field(item, "trackSelection", "軌道款式",
                { cssClass: "light-selection" })}
            ${field(item, "brandModel", "軌道型號", { cssClass: "model" })}
            ${field(item, "unitPrice", "軌道單價（元／條）", { cssClass: "price" })}
            ${field(item, "spotlightSelection", "軌道燈款式",
                { cssClass: "light-selection" })}
            ${field(item, "spotlightModel", "軌道燈型號", { cssClass: "model" })}
            ${field(item, "spotlightQuantity", "燈具數量（盞）",
                { cssClass: "spotlight-count" })}
            ${field(item, "spotlightUnitPrice", "燈具單價（元／盞）",
                { cssClass: "spotlight-price" })}
            ${field(item, "installationUnitPrice", "配線與安裝（元／條）",
                { cssClass: "installation-price" })}
            ${field(item, "priceSource", "軌道價格來源", { cssClass: "source" })}
            ${field(item, "spotlightPriceSource", "軌道燈價格來源",
                { cssClass: "source" })}
            ${renderLightSpecificationFields(item)}
        </div>
        <p class="corridor-light-cost" data-track-budget-id="${escapeHtml(item.id)}">
            ${trackBudgetLabel(item)}</p>
        <small>預設價格依你提供的特力屋參考價；替代款若色溫不同，
            請先核對軌道接頭、天花固定與施工實價。</small>
    </section>`;
}

function planConflicts() {
    return state.items.filter((item) => item.kind !== "door" && item.placement &&
        !(isSwitch(item) && item.switchPlanStatus === "removed") &&
        !(isSplitAirConditioner(item) && item.acPlanStatus === "excluded") &&
        knownRoomIds.has(item.roomId)).filter((item) => {
        const room = state.rooms.find((entry) => entry.id === item.roomId);
        const geometry = roomGeometry(room);
        const center = markerPosition(item, geometry);
        const size = placementFootprint(item, geometry);
        return !footprintFits(geometry, center.x, center.y, size.width, size.height);
    });
}

function renderLightingAssessment(selectedRoom) {
    if (!lightingPreview) return "";
    const rooms = (selectedRoom ? [selectedRoom] : state.rooms).filter((room) =>
        state.items.some((item) => item.roomId === room.id && isPlacedLight(item)));
    if (!rooms.length) return '<p class="lighting-assessment">目前沒有已標位燈具可模擬。</p>';
    return `<section class="lighting-assessment" aria-label="逐房照度估算與缺少的光學規格">
        <h3>${selectedRoom ? "本房" : "各房"}照度與資料完整性</h3>
        <p>評估平面：${lightingPlaneCm === 80 ? "80cm 桌面" : "地板"}。
            僅在同盞燈具填有光通量、光束角、來源與房間天花淨高時，
            才以均勻圓錐估算<strong>近似直射</strong> lux；
            來源內容與房高須人工核對，系統未驗證官方真偽。
            燈視為裝於天花並朝下照射；取樣不含下吊高度、反射、
            牆／家具遮蔽、實際照射方向、燈罩衰減或 IES 配光，
            光圈也不是逐點 lux 熱圖，不可作為施工照明設計。</p>
        ${rooms.map((room) => {
            const geometry = roomGeometry(room);
            const lamps = state.items.filter((item) =>
                item.roomId === room.id && isPlacedLight(item));
            const estimate = estimateRoomIlluminance(geometry, lamps,
                litItemIds, lightingPlaneCm);
            const excluded = estimate.incomplete.filter(({ item }) =>
                litItemIds.has(item.id));
            const luxText = estimate.sampleCount
                ? `僅計 ${estimate.completeCount} 個具備完整光學資料的發光點；
                    ${estimate.sampleCount} 個室內格點的近似直射照度：
                    最低 ${currency.format(estimate.minLux)} lx、
                    平均 ${currency.format(estimate.averageLux)} lx、
                    最高 ${currency.format(estimate.maxLux)} lx。${
                        excluded.length ? `尚有 ${excluded.length} 組已開燈具未計入，
                        <strong>部分來源，不代表全房照度</strong>。` : ""}`
                : estimate.completeCount
                    ? "此房範圍太小，沒有可用的照度取樣點；請核對房間尺寸。"
                    : "目前沒有足夠完整資料的已點亮燈具可估 lux；圖面僅供示意。";
            return `<details class="lighting-room" data-light-room-id="${escapeHtml(room.id)}"
                ${selectedRoom ? "open" : ""}>
                <summary>${escapeHtml(room.name)}｜${lamps.length} 組已標位燈具、
                    ${estimate.incomplete.length} 組照度資料不完整，
                    ${estimate.sampleCount && !excluded.length
                        ? `平均約 ${currency.format(estimate.averageLux)} lx`
                        : "不可推定全房照度"}</summary>
                <p>${luxText}</p>
                <ul>${lamps.map((item) => {
                    const { mode, missing } = lightDataStatus(item, geometry,
                        lightingPlaneCm);
                    const watt = item.lightWatts == null
                        ? "瓦數未確認" : `每盞 ${item.lightWatts}W`;
                    const centerLux = mode === "lux-estimate"
                        ? lightSourcesForRoom(geometry, [item], new Set([item.id]),
                            lightingPlaneCm)[0].centerLux : null;
                    const details = mode === "lux-estimate"
                        ? `正下方每盞近似 ${currency.format(centerLux)} lx
                            （未計相鄰燈重疊），依所填來源與房高推算。`
                        : `無完整資料，照度估算可能不準：缺${missing.join("、")}；
                            ${mode === "watt-relative"
                                ? "僅按瓦數相對調整光圈與強度，不換算 lux。"
                                : "瓦數亦未確認，沿用原光圈示意，不換算 lux。"}`;
                    return `<li>${escapeHtml(item.name)}（${escapeHtml(watt)}，
                        ${litItemIds.has(item.id) ? "目前開燈" : "目前關燈"}）：
                        ${details}</li>`;
                }).join("")}</ul>
            </details>`;
        }).join("")}
    </section>`;
}

function renderPlanView() {
    const room = state.rooms.find((entry) => entry.id === planRoomId);
    const bedroom2Partition = state.items.find((item) => item.id === BEDROOM2_PARTITION_ID);
    const corridorTrack = state.items.find(isTrackLighting);
    const platformDryer = state.items.find((item) =>
        item.furnitureType === "dryer" && item.roomId === "ac-platform");
    const conflicts = planConflicts();
    const outdoorConflicts = state.items.filter((item) =>
        isActiveSplitAirConditioner(item) && item.outdoorPlacement &&
        outdoorACSceneConflict(item));
    const activeSwitches = state.items.filter((item) =>
        isSwitch(item) && item.switchPlanStatus !== "removed").length;
    const placedSwitches = state.items.filter((item) =>
        isSwitch(item) && item.switchPlanStatus !== "removed" && item.placement).length;
    const removedQuotedSwitches = state.items.filter((item) =>
        isQuotedSwitch(item) && item.switchPlanStatus === "removed").length;
    const balconyOutdoorSwitch = state.items.find((item) =>
        item.roomId === "balcony" && isOutdoorSwitch(item) &&
        item.switchPlanStatus !== "removed");
    const studioBalconySwitch = state.items.find((item) =>
        item.id === "quoted-switch-12" && item.switchPlanStatus !== "removed");
    const sockets = state.items.filter(isSocket);
    const circuits = state.items.filter(isDedicatedCircuit);
    const pointWarnings = state.items.filter((item) =>
        (!room || item.roomId === room.id) && OUTLET_POINT_WARNINGS[item.outletPlanPointId]);
    const diagramWarnings = pointWarnings.length
        ? `<div class="plan-overlap-alert outlet-point-warnings" role="alert">
            <strong>保留來源原標位｜衝突待現場核對，非可施工配置</strong>
            ${pointWarnings.map((item) => `<p data-point-warning="${escapeHtml(item.outletPlanPointId)}">
                <strong>${escapeHtml(item.outletPlanPointId)}</strong>：
                ${OUTLET_POINT_WARNINGS[item.outletPlanPointId]}</p>`).join("")}</div>` : "";
    const diagramLegend = state.items.some((item) => item.outletPlanPointId)
        ? `<p class="outlet-diagram-legend"><strong>去識別化來源標位：</strong>
            <span class="diagram-key general">R 紅：一般電源</span>
            <span class="diagram-key dedicated">B 黑：獨立實體專用供電</span>
            <span class="diagram-key weak">C 綠：弱電／網路，非電源</span>。
            R/B 是不同實體端點；紫色「迴」另表配線，不是另一顆插座。
            顏色沿用來源分類，後續實際配對見迴路清單；點位與房間配準仍待現勘。
            來源方案為 51R＋9B＝60 電源、9 迴路、另 7C；
            比原報 50 電源／7 迴路的數量差額為 <strong>NT$27,000</strong>，
            不等於相對先前存檔的總價差。弱電 7 條×3,000 已含原報，不再加 21,000。
            110V／220V 僅來源標註，接頭、負載、戶外／濕區防護及安裝補差待核。</p>${diagramWarnings}` : "";
    const quotedOutlets = sockets.filter(isQuotedOutlet);
    const addedOutlets = sockets.filter((item) =>
        item.outletCircuit === "additional-general");
    const sourceToggle = `<button type="button" data-action="toggle-plan-source"
        aria-pressed="${showSourceOverlay}">${showSourceOverlay ? "隱藏" : "顯示"}規劃幾何底圖</button>`;
    const allLights = state.items.filter(isPlacedLight);
    const allLit = allLights.length > 0 &&
        allLights.every((item) => litItemIds.has(item.id));
    const layerLabels = {
        furniture: "家具", lights: "燈", switches: "開關", outlets: "插座",
    };
    const visibleControls = `<div class="plan-visibility-controls" role="group"
        aria-label="格局圖圖例顯示">
        ${Object.entries(visiblePlanLayers).map(([layer, visible]) =>
            `<button type="button" data-action="toggle-plan-layer"
                data-layer="${layer}" aria-pressed="${!visible}"
                title="${layer === "furniture"
                    ? "家具含所有非燈、開關、插座物件：衛浴設備、冷氣室內外機及現況水槽；門窗和牆不隱藏" :
                    layer === "outlets"
                        ? "插座圖層含實體電源、專用迴路及弱電 C 埠；隱藏只影響圖面，不變更原報價"
                        : "僅隱藏圖上的標記，不變更設備或價格"}"
                >${visible ? "隱藏" : "顯示"}${layerLabels[layer]}</button>`
        ).join("")}
    </div>`;
    const hiddenLayers = Object.entries(visiblePlanLayers)
        .filter(([, visible]) => !visible).map(([layer]) => layerLabels[layer]);
    const visibilityNote = hiddenLayers.length
        ? `<p class="plan-disclaimer">已隱藏${hiddenLayers.join("、")}圖示；
            家具包含除燈、開關與插座以外的物件，例如衛浴設備、
            冷氣室內／室外機、家電及現況水槽；電源、專用迴路與弱電 C 埠可一起隱藏，
            門、窗、牆與玻璃隔屏仍顯示。
            隱藏不會刪除物件、改價或關燈；
            隱藏燈或開關時，對應虛線也暫不顯示。</p>` : "";
    const lightingControls = `<div class="lighting-controls" role="group"
        aria-label="格局圖照明模擬">
        <button type="button" data-action="toggle-light-preview"
            aria-pressed="${lightingPreview}">${lightingPreview ? "結束照明模擬" : "模擬開燈"}</button>
        ${lightingPreview ? `<button type="button" data-action="toggle-all-lights"
            ${allLights.length ? "" : "disabled"}>${allLit ? "全部熄燈" : "全部開燈"}</button>
            <label class="lighting-plane-choice">照度評估平面
                <select data-light-plane aria-label="照度評估平面">
                    <option value="0" ${lightingPlaneCm === 0 ? "selected" : ""}>地板（0cm）</option>
                    <option value="80" ${lightingPlaneCm === 80 ? "selected" : ""}>
                        桌面（約 80cm）</option>
                </select></label>` : ""}
    </div>`;
    const lightingLegend = lightingPreview ? `<p class="lighting-legend">
        <span class="lighting-legend-glow"></span>
        黃色光圈為<strong>直射照度近似或相對亮度示意，非 lux 熱圖</strong>，
        暗色不代表已測得的低照度；
        已亮 ${allLights.filter((item) => litItemIds.has(item.id)).length} 組。
        點圖上的「單／雙」開關可切換該房燈具，點燈具可單獨切換；
        玄關暫對應走廊，${balconyOutdoorSwitch
            ? "陽台戶外防潮開關暫對應陽台燈；原工作室陽台側開關已移除。"
            : studioBalconySwitch ? "工作室陽台側暫對應陽台。" :
                "陽台燈的控制點目前待補。"}
        <span class="preview-circuit-key"></span>青色虛線表示這次模擬的
        <strong>暫擬控制對應</strong>；點開關或燈可強調對應線，
        跨房間的線請在全屋圖查看，<strong>不是已核實的電路或線管路徑</strong>。
        光學資料不足時僅依已知瓦數相對調整光圈；
        瓦數未知則沿用原示意半徑（一般吸頂燈
        ${ILLUSTRATIVE_LIGHT_RANGE_CM.ceiling}cm、崁燈
        ${ILLUSTRATIVE_LIGHT_RANGE_CM.recessed}cm、軌道每盞
        ${ILLUSTRATIVE_LIGHT_RANGE_CM.track}cm），絕不把 W 當成 lm 或 lux。
        地板／桌面切換僅改有完整資料的照度估算；
        此模式不修改報價或儲存配置。</p>` : "";
    const circuitLinks = lightingPreview ? previewCircuitLinks(state.items) : [];
    const mappedSwitches = lightingPreview ? state.items.filter((item) =>
        item.switchType && item.placement && item.switchPlanStatus !== "removed" &&
        (!room || item.roomId === room.id || previewTargetRoomId(item) === room.id)) : [];
    const shownLinks = circuitLinks.filter(({ switchItem, lightItem }) =>
        !room || switchItem.roomId === room.id || lightItem.roomId === room.id);
    const mappingPanel = lightingPreview ? `<details class="preview-mapping"
        ${circuitListOpen ? "open" : ""}>
        <summary>暫擬開關與燈具對應（${mappedSwitches.length} 處開關、
            ${shownLinks.length} 組控制關係）</summary>
        <p>依目前模擬分組列示；雙開關尚未區分左右鍵。
            此表與圖面虛線都<strong>不代表已確認的迴路或施工走線</strong>。
            跨房間關係請在全屋格局圖查看。</p>
        <ul>${mappedSwitches.map((switchItem) => {
            const targets = previewControlledLights(switchItem, state.items);
            const focused = focusedCircuitId === switchItem.id ||
                targets.some((light) => focusedCircuitId === light.id);
            return `<li class="${focused ? "is-focused" : ""}">
                <strong>${escapeHtml(switchItem.name)}</strong>
                <span>→ ${targets.length ? targets.map((light) =>
                    `${escapeHtml(light.name)}${light.lightType === "track"
                        ? `（${light.spotlightQuantity} 盞同軌）` : ""}`).join("、")
                    : "目前沒有可模擬的燈具，控制對象待確認"}</span></li>`;
        }).join("") || "<li>本空間目前沒有已標位的開關對應。</li>"}</ul>
    </details>` : "";
    const socketLegend = `<p class="door-legend">
        ${state.items.some((item) => item.outletPlanPointId)
            ? "紅 R 與黑 B 各代表一顆獨立的實體電源；綠 C 是弱電埠而非電源。"
            : '<span class="outlet-key">座</span>每個為一顆實體電源插座；'}
        <span class="circuit-key">迴</span>為另外計價、明確配對一顆插座的專用迴路，
        紫色虛線僅表示對應，不是實際配線路徑。
        目前 ${sockets.length} 顆插座（其中原報名額 ${quotedOutlets.length} 顆、
        新增 ${addedOutlets.length} 顆）、${circuits.length} 條專用迴路。
        原報分別是 ${QUOTED_SOCKET_COUNT} 個 × NT$${currency.format(SOCKET_UNIT_PRICE_TWD)}
        ＝NT$${currency.format(QUOTED_SOCKET_COUNT * SOCKET_UNIT_PRICE_TWD)}、
        ${QUOTED_DEDICATED_COUNT} 條 ×
        NT$${currency.format(DEDICATED_CIRCUIT_UNIT_PRICE_TWD)}＝NT$${currency.format(
            QUOTED_DEDICATED_COUNT * DEDICATED_CIRCUIT_UNIT_PRICE_TWD)}，
        均已含於原工程總價，不能重複追加。<strong>圖示中心僅表示用電區域；
        牆面高度、電壓及實際線路待電工確認</strong>。</p>${diagramLegend}`;
    const socketAlerts = [
        sockets.length !== QUOTED_SOCKET_COUNT
            ? `插座目前 ${sockets.length} 個，與原報 ${QUOTED_SOCKET_COUNT} 個不符；
                增減每個暫按 NT$${currency.format(SOCKET_UNIT_PRICE_TWD)} 試算，
                安裝位置及可否扣價仍須與廠商確認。` : null,
        circuits.length !== QUOTED_DEDICATED_COUNT
            ? `專用迴路目前 ${circuits.length} 條，原報 ${QUOTED_DEDICATED_COUNT} 條；
                增減每條暫按 NT$${currency.format(
                    DEDICATED_CIRCUIT_UNIT_PRICE_TWD)} 試算。
                ${circuits.length < QUOTED_DEDICATED_COUNT
                    ? "少於 7 條可能造成高負載共線跳電，建議維持至少 7 條。" : ""}
                配電容量、跳電風險、保護開關與實價須由電工核對。` : null,
    ].filter(Boolean).map((message) =>
        `<p class="plan-overlap-alert" role="alert">${message}</p>`).join("");
    const socketPlanDetails = `<details class="socket-plan-summary">
        <summary>目前 ${sockets.length} 個插座、${circuits.length} 條專用迴路
            （原報 50 個／7 條；展開各房配置）</summary>
        <div class="socket-room-counts">${state.rooms.filter((entry) =>
            [...sockets, ...circuits].some((item) => item.roomId === entry.id)).map((entry) => {
            const roomSockets = sockets.filter((item) => item.roomId === entry.id);
            const roomCircuits = circuits.filter((item) => item.roomId === entry.id);
            return `<span>${escapeHtml(entry.name)}：${roomSockets.length} 個實體電源、
                ${roomCircuits.length} 條專用迴路</span>`;
        }).join("")}</div>
        <p>目前迴路各自配對：
            ${circuits.map((item) => {
                const socket = sockets.find((entry) => entry.id === item.circuitOutletId);
                return `${escapeHtml(item.name)} → ${escapeHtml(socket?.name ?? "待重新配對")}`;
            }).join("、") || "尚無專用迴路"}。
            原報用途曾列<strong>三台冷氣</strong>，
            其他規劃冷氣如有高負載需另核迴路數量；
            原報兩間<strong>暖風機</strong>已改新風機，兩條額度與防潮接線方式須重報。
            鐵窗上的烘衣機、熱水器、洗碗機或廚下瞬熱飲水器也
            <strong>不因圖上已有一般插座就自動取得專用迴路</strong>；
            設備功率、電壓、專用插頭或固定接線、漏電保護、鐵窗可行性均須確認。
            不可把一般插座當成高功率設備的安全供電保證。</p>
    </details>`;
    const reference = `<details class="plan original-plan">
        <summary>對照窗洞 W 尺寸示意</summary>
        <div class="reference-scroll">
            ${renderReferenceSvg(state.rooms, { doorsVisible: false })}
        </div>
        <p class="muted">由規劃器幾何重繪，含規劃新增隔間；原始掃描未收錄。
            W 數值取自圖面標註，施工尺寸須現場丈量核對。</p>
    </details>
    <details class="plan original-plan">
        <summary>對照規劃隔間與門位示意</summary>
        ${renderReferenceSvg(state.rooms, { proposed: true })}
        <p class="muted">此向量示意由同一套房間輪廓、窗洞及規劃門位產生，
            不是原始設計圖；實際門洞與牆厚待現場核對。</p>
    </details>`;
    if (!room) {
        const outside = state.rooms.filter((entry) => !knownRoomIds.has(entry.id))
            .map((entry) => `<button type="button" data-action="select-plan-room"
                data-room-id="${escapeHtml(entry.id)}">${escapeHtml(entry.name)}</button>`).join("");
        return `<section class="plan-overview">
            <p class="plan-disclaimer">依原圖標註的 1:60 比例與牆內緣
                <strong>等比例</strong>描繪；每格 100cm
                （${Math.round(100 * PLAN_PIXELS_PER_CM * 100) / 100} 圖面單位），
                房間放大只裁切同一座標。臥室2依新配置的 6.78㎡ 與相鄰原牆推算；
                已確認的新拉門沿新圖標示，不能代替現場丈量。
                可拖動的設備、家具、開關及燈具均可在房間圖選取後點右上角 ↻
                轉向；室外機也有自己的 ↻。門窗、牆線與固定水槽不屬可旋轉物件。</p>
            <div class="plan-display-actions">${visibleControls}${lightingControls}${sourceToggle}</div>
            ${visibilityNote}
            ${lightingLegend}
            ${renderLightingAssessment(null)}
            ${mappingPanel}
            ${showSourceOverlay ? '<p class="plan-disclaimer">透明幾何底圖是規劃器重新繪製的房間與新增隔間示意，不含任何原始掃描；牆位、門洞仍須實測。</p>' : ""}
            ${conflicts.length ? `<p class="plan-overlap-alert" role="alert">
                按現況圖比例，有 ${conflicts.length} 件已放物件與牆柱或固定水槽相交：
                ${conflicts.map((item) => `${escapeHtml(roomName(item.roomId))}－${escapeHtml(item.name)}`)
                    .join("、")}；原位置已保留，請進入房間調整或現場核對。</p>` : ""}
            ${outdoorConflicts.length ? `<p class="plan-overlap-alert" role="alert">
                ${outdoorConflicts.map((item) => escapeHtml(roomName(item.roomId))).join("、")}
                的室外機暫估占地超出圖示外側輪廓，須核對機型、支架與位置。</p>` : ""}
            ${renderOverviewPlan(state.rooms, state.items, showSourceOverlay,
                lightingPreview ? litItemIds : null, visiblePlanLayers,
                focusedCircuitId, lightingPlaneCm)}
            ${socketLegend}
            ${socketAlerts}
            ${socketPlanDetails}
            <p class="door-legend"><span class="device-dot">▣</span>俯視小圖標為已定位物件；
                已填寬、深仍按圖面比例檢查占地，不另畫大型外框；
                型號未定的設備圖示不代表實際尺寸。
                「家具」圖層含所有非燈、開關、插座與專用迴路的物件
                （包括冷氣室內外機），插座與迴路共用顯示按鈕；
                門、窗、牆與乾濕分離隔屏不屬家具。
                <span class="door-key">門</span>開門門位，
                <span class="door-key slide">拉</span>拉門，
                <span class="door-key glass">玻</span>乾濕分離門，
                <span class="door-key passage">拱</span>玄關通客餐廳的現況木作拱門開口；
                灰色門位未分攤報價，拱門亦非新增門片。
                <span class="wet-dry-key"></span>青藍虛線為兩間衛浴的乾濕分離隔屏，
                玻璃門位置另以門線表示，尺寸須現場核對。
                ${bedroom2Partition
                    ? `<span class="partition-key material-${escapeHtml(
                        bedroom2Partition.partitionMaterial)}"></span>
                        臥室2對客廳、走廊的彩色牆線為輕隔間，點選可共用切換做法。` : ""}
                ${state.items.some(isQuotedSwitch)
                    ? `<span class="switch-key">雙</span>（或「單」）紫色為室內開關；
                        ${balconyOutdoorSwitch
                            ? '<span class="switch-key outdoor">雙</span>青綠色為陽台戶外防潮開關暫位；'
                            : ""}
                        原報價含 15 個，目前規劃 ${activeSwitches} 個
                        （${placedSwitches} 個已標位）。
                        ${removedQuotedSwitches ? `${removedQuotedSwitches} 個原報配置暫列減項，
                            是否能扣款待廠商確認。` : ""}
                        新增開關按原每個 NT$2,250 試算追加，可在室內房間新增、移除。
                        浴室開關僅標控制區，實際應避開濕區；
                        ${balconyOutdoorSwitch
                            ? "陽台戶外開關的防護等級、防水接線及實際價差待報。"
                            : "陽台照明暫由工作室內側控制。"}`
                    : ""}
                ${state.items.some(isQuotedDownlight)
                    ? `<span class="downlight-key">燈</span>圓形表示天花崁燈暫定位置；
                        廚房、主浴、客浴各兩個，原報價每個 NT$950
                        暫拆燈具約 NT$${DOWNLIGHT_FIXTURE_ESTIMATE_TWD}、
                        配線安裝約 NT$${DOWNLIGHT_INSTALL_ESTIMATE_TWD} 供換款試算；
                        實際開孔與濕區防護須核對。` : ""}
                ${state.items.some(isCeilingLight)
                    ? '<span class="ceiling-light-key">頂</span>雙圈表示客廳吸頂燈的天花示意位置；燈具本體價格待填，配線及安裝暫按每盞 NT$1,200 另計，不屬原報價已含款項。' : ""}
                ${state.items.some((item) => isActiveSplitAirConditioner(item) &&
                    item.outdoorPlacement)
                    ? `<span class="outdoor-ac-key">外</span>是與各房「冷氣」同套的室外機暫位，
                        除臥室3依屋主指定放鐵窗外，其餘靠現況窗外；
                        外框先按沿牆 ${OUTDOOR_AC_ESTIMATED_SIZE_CM.width}×外推
                        ${OUTDOOR_AC_ESTIMATED_SIZE_CM.depth}cm 暫估，占地可逐台編輯，
                        並非實機型號或承重保證。窗外固定、散熱、施工動線和許可未核，
                        不另重複計價。` : ""}
                ${state.items.some((item) => item.id === "ac-bedroom-2" &&
                    item.acPlanStatus === "excluded")
                    ? "臥室2無可確認的室外機管線路徑，依屋主選擇暫不規劃分離式，原室內標位仍保留。" : ""}
                ${state.items.some(isFreshAirUnit)
                    ? '<span class="bathroom-key fresh-air">新</span>標示兩間衛浴的室外進氣新風機暫位；本體規格與價格待核，不沿用暖風機型號或單價。' : ""}
                ${state.items.some(isToiletRinseKit)
                    ? '<span class="bathroom-key rinse-kit">沖</span>標示兩個馬桶旁的三叉管＋沖洗器，特力屋參考價每組 NT$769，安裝與接頭待核。' : ""}
                ${state.items.some(isHeatedTowelRail)
                    ? '<span class="bathroom-key towel-rail">巾</span>標示兩間衛浴各一支電熱毛巾架的暫定牆面；本體與防潮配線待報。' : ""}
                ${state.items.some(isBathGrabBar)
                    ? '<span class="bathroom-key grab-bar">扶</span>標示客浴浴缸牆面防滑扶手，固定承重與費用待確認。' : ""}
                ${corridorTrack
                    ? `<span class="track-light-key"></span>走廊黑線及圓點是一條 1.5 米軌道與
                        ${corridorTrack.spotlightQuantity} 盞軌道燈；點淺灰走廊可編輯，
                        拖動軌道時燈會一起移動。軌道、燈具和安裝均不在原報價總額內。` : ""}
                主浴通主臥及客廳各一門，客廳側按你標示改畫拉門，報價單價仍需重核；
                臥室3與工作室新增拉門尚未列入門片報價；衛浴2與臥室3間沒有門。
                玄關門不列本次門片計價。<span class="window-key"></span>淡藍線是現況圖的 W 窗洞，
                寬度依原圖標註；陽台後側沒有窗，
                ${visiblePlanLayers.furniture ? "左側青灰方框是現況泥作水槽" :
                    "左側現況泥作水槽圖示已隨家具隱藏"}
                （原報價列入拆除，是否保留待確認）。臥室2與客浴右側的淺灰區為
                ${state.rooms.some((entry) => entry.id === "corridor")
                    ? "可點選的固定走廊空間" : "走廊"}。</p>
            ${renderDoorMaterialLegend()}
            <p class="plan-disclaimer">臥室3與陽台外側的連續灰藍區是現況圖 U 形外推線，
                依你的說明標為<strong>外推鐵窗設備暫位</strong>，與陽台室內 2.3㎡ 分開；
                臥室3後牆仍有原圖 W 窗洞，室外機暫放外側鐵窗，
                ${platformDryer ? "烘衣機暫放靠陽台一側。" : ""}
                原圖沒有承重、材質、雨淋防護及許可資料，
                ${platformDryer ? "兩種設備" : "室外機"}能否安裝須現場確認。</p>
            ${outside ? `<div class="outside-rooms"><strong>另加的房間：</strong>${outside}</div>` : ""}
            ${reference}
        </section>`;
    }

    const items = state.items.filter((item) => item.roomId === room.id);
    const placeableItems = items.filter(isPlaceableItem);
    const roomOutlets = items.filter(isSocket);
    const roomCircuits = items.filter(isDedicatedCircuit);
    const roomAddedOutlets = items.filter((item) =>
        item.outletCircuit === "additional-general");
    const splitAC = items.find(isSplitAirConditioner);
    const roomWindows = windowsForRoom(room.id);
    const selectedOutdoorWindow = splitAC?.outdoorPlacement
        ? roomWindows.find((window) =>
            window.id === outdoorACZone(splitAC).windowId) : null;
    if (!placeableItems.some((item) => item.id === selectedPlanItemId)) {
        selectedPlanItemId = placeableItems.find((item) => item.name.includes("馬桶"))?.id
            ?? placeableItems[0]?.id ?? null;
        rotateHandleHidden = false;
    }
    const selected = placeableItems.find((item) => item.id === selectedPlanItemId);
    const hasRoomSize = room.widthCm !== null && room.depthCm !== null;
    const traced = knownRoomIds.has(room.id);
    const tracedGeometry = traced ? roomGeometry(room) : null;
    const platform = room.id === "ac-platform";
    const drawing = Object.hasOwn(ROOM_DRAWING_DIMENSIONS, room.id)
        ? ROOM_DRAWING_DIMENSIONS[room.id] : null;
    const bounds = drawing?.kind === "bounds";
    const inferred = drawing?.kind === "inferred";
    const roomSizeControls = `<div class="room-size-controls">
        <label>${platform ? "鐵窗圖面跨度（cm）" : bounds ? "圖面外接寬（cm）" :
            inferred ? "新隔間參考寬（cm）" : "房間淨寬（cm）"}<input type="number" min="1" step="any"
            data-room-dimension="widthCm" data-room-id="${escapeHtml(room.id)}"
            value="${escapeHtml(room.widthCm ?? "")}"></label>
        <label>${platform ? "圖上外推深度（cm）" : bounds ? "圖面外接長（cm）" :
            inferred ? "新隔間參考深（cm）" : "房間淨深（cm）"}<input type="number" min="1" step="any"
            data-room-dimension="depthCm" data-room-id="${escapeHtml(room.id)}"
            value="${escapeHtml(room.depthCm ?? "")}"></label>
        ${platform ? "" : `<label>天花至地板淨高（cm，空白不估照度）
            <input type="number" min="180" max="600" step="any"
                data-room-dimension="ceilingHeightCm"
                data-room-id="${escapeHtml(room.id)}"
                value="${escapeHtml(room.ceilingHeightCm ?? "")}"></label>`}
        <small>${platform ? `現況圖 U 形輪廓跨約 590cm、外推約 78cm，深度是圖面量繪，
            不是文字標註或現場實量；修改欄位不會拉伸輪廓，更不代表承重合格。` : traced
            ? `${drawing ? `${drawing.widthCm}×${drawing.depthCm}cm，${drawing.source}` :
                `圖面外接約 ${Math.round(tracedGeometry.width / PLAN_PIXELS_PER_CM)}
                    ×${Math.round(tracedGeometry.height / PLAN_PIXELS_PER_CM)}cm`}；
                ${bounds ? "這是外接參考，不代表各處淨寬" : "此為圖面參考尺寸"}，
                均非現場實量。
                ${room.dimensionStatus === "user" ? "欄位為自行修改值" :
                    hasRoomSize ? "欄位依圖填入，可修正" : "欄位尚未填寫"}；
                修改欄位不會扭曲描繪的牆線。`
            : hasRoomSize ? "自行填入的尺寸，施工前請複核。" : "自訂房間尚無尺寸，顯示矩形佔位。"}</small>
    </div>`;
    const choices = placeableItems.map((item) => `<option value="${escapeHtml(item.id)}"
        ${item.id === selectedPlanItemId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("");
    const roomChoices = state.rooms.map((entry) => `<option value="${escapeHtml(entry.id)}"
        ${entry.id === room.id ? "selected" : ""}>${escapeHtml(entry.name)}</option>`).join("");
    const outdoorControls = splitAC && splitAC.acPlanStatus !== "excluded"
        ? `<section class="light-choices ac-outdoor-controls" role="group"
            aria-label="室外機俯視占地暫估">
            <h3>室外機占地（非實機尺寸）</h3>
            <div class="fields">
                ${field(splitAC, "outdoorWidthCm", "機身長邊（cm）",
                    { cssClass: "dimension" })}
                ${field(splitAC, "outdoorDepthCm", "機身短邊（cm）",
                    { cssClass: "dimension" })}
                ${outdoorACZoneChoices(room.id).length > 1
                    ? `<label class="outdoor-window-choice">外側候選窗位（暫定）
                        <select data-outdoor-ac-window data-item-id="${escapeHtml(splitAC.id)}">
                            ${outdoorACZoneChoices(room.id).map((zone) =>
                                `<option value="${escapeHtml(zone.windowId)}"
                                    ${splitAC.outdoorZoneId === zone.windowId ? "selected" : ""}>
                                    ${escapeHtml(zone.label)}</option>`).join("")}
                        </select></label>` : ""}
            </div>
            <small>暫按 80×35cm 比例畫室外機，預設長邊沿外牆；
                可在同房候選窗位間拖動或從下拉切換，也能點右上角 ↻ 轉向。
                窄窗警示表示暫估機長可能大於窗洞，搬運與固定須另核；
                機身高度與維修淨距尚未計入；
                淺色房間格線同樣按現況圖比例。紅框表示暫估占地超出所繪外側輪廓，
                黃框表示現況窗洞窄於暫估機長；都不表示可施工。</small>
        </section>` : "";
    const roomDoors = items.filter((item) => item.kind === "door");
    const newSlideInRoom = room.id === "studio" || room.id === "bedroom-3";
    const newSlideTrack = newSlideInRoom ? quotedTrackForDoor("bedroom-3-studio") : null;
    const doorControls = roomDoors.length || newSlideInRoom ? `<details class="door-choices"
        data-room-id="${escapeHtml(room.id)}" ${openDoorRooms.has(room.id) ? "open" : ""}>
        <summary>本房門位 ${roomDoors.length + Number(newSlideInRoom)} 處
            （門片與軌道是否已報價見下方）</summary>
        <p class="plan-disclaimer">圖中的 80、100、125 等是區域尺寸，未必是門洞淨寬；
            填入門洞淨寬後，圖上的門寬箭頭才會按比例更新。門高只記在資料欄。</p>
        ${roomDoors.map((item) => `<div class="door-choice">
            <strong>${escapeHtml(item.name)}</strong>
            <small>${isShowerDoor(item)
                ? "本房玻璃隔屏與防爆膜已各在設備明細列入原報價；這筆門位不重複計價。變更門型、門洞淨寬須請廠商核價。"
                : `原報價：${item.quotedQuantity} 組 × NT$${currency.format(item.quotedUnitPrice)}；
                    改材質只將價差算進追加／減項；${item.doorOpeningKind !==
                    DOOR_OPTIONS[item.doorMaterial]?.opening
                        ? "目前開門方式與此材質預設不同，須請廠商重報門型價格。" :
                        "改門型也須請廠商核價。"}`}</small>
            <div class="fields">
                ${field(item, "doorMaterial", "門片材質", { cssClass: "door-material" })}
                ${field(item, "doorOpeningKind", "開門方式", { cssClass: "door-kind" })}
                ${field(item, "unitPrice", isShowerDoor(item) ? "額外門型價差" :
                    "目前單價", { cssClass: "price" })}
                ${field(item, "widthCm", "門洞淨寬（cm）", { cssClass: "dimension" })}
                ${field(item, "heightCm", "門洞淨高（cm）", { cssClass: "dimension" })}
            </div>
            ${renderDoorTrackControls(item)}
        </div>`).join("")}
        ${newSlideInRoom ? `<div class="door-choice">
            <strong>臥室3－工作室新增拉門</strong>
            <small>門片本體未列原報價；軌道從「主浴.工作室」的 1.6 米中暫分
                0.8 米，實際長度與門型仍待廠商核對。</small>
            ${newSlideTrack ? renderQuotedTrackControls(newSlideTrack) :
                '<p class="plan-overlap-alert">尚未拆列此拉門的已報價軌道，請重新載入設備清單。</p>'}
        </div>` : ""}
    </details>` : "";
    const objectPalette = placeableItems.filter((item) => item.placement)
        .map((item) => `<button type="button" draggable="true"
        data-action="choose-object" data-existing-item-id="${escapeHtml(item.id)}"
        aria-pressed="${pendingObject?.kind === "existing" && pendingObject.id === item.id}">
        ${escapeHtml(item.name)}</button>`).join("");
    const furnitureTemplates = Object.entries(FURNITURE_TEMPLATES).map(([type, template]) =>
        `<button type="button" draggable="true" data-action="choose-object"
            data-furniture-template="${type}"
            aria-pressed="${pendingObject?.kind === "template" && pendingObject.type === type}">
            ${escapeHtml(template.name)}</button>`
    ).join("");

    return `<section class="plan-detail">
        <div class="plan-detail-header">
            <button type="button" data-action="all-rooms">← 全屋格局</button>
            <label>切換房間<select data-plan-room-select>${roomChoices}</select></label>
            ${sourceToggle}
        </div>
        <h2>${escapeHtml(room.name)}</h2>
        ${diagramLegend}
        ${roomSizeControls}
        ${roomOutlets.length || roomCircuits.length ? `<p class="door-legend">
            此房已列 <strong>${roomOutlets.length} 個實體電源插座、
                ${roomCircuits.length} 條專用迴路</strong>；
            每條迴路只能對應一個插座，紫色「迴」與實體電源標記是不同物件。
            插座可直接刪減；已配迴路者請先改綁或刪除迴路。
            原報全屋 50 個 × NT$1,800 及 7 條 × NT$4,500 的基準仍保留，
            規劃差額與高負載跳電風險須電工核對。</p>` : ""}
        ${roomAddedOutlets.length ? `<p class="plan-overlap-alert">
            本房另新增 ${roomAddedOutlets.length} 個實體電源插座；
            插座按每個 NT$1,800 暫估，專用迴路須另建並配對。
            若全屋實際數量與原報 50 個不同，施工及扣價需重新核對。
        </p>` : ""}
        <p class="plan-disclaimer">${platform
            ? "從現況圖後側 U 形外框裁切放大，50cm 格線沿用 PDF 比例；鐵窗材質、承重、通風及建管條件均未經確認。"
            : traced
            ? "直接裁切全屋共用輪廓；50cm 格線與已填尺寸物件依現況 PDF 的 S:1/60 等比例繪製。新隔間及家具尺寸如未在現況圖標註，仍須實量。"
            : hasRoomSize ? "自訂房間依自行填入的淨尺寸繪圖；仍非施工圖。" :
                "自訂房間未填長寬，矩形僅作佔位。"}
            可拖動的設備與家具都可選取後點右上角小 ↻ 轉向，
            室外機亦可點其右上角的 ↻；若占地無法放入則保留方向並標紅。
            施工前仍需核對排水、開門與淨距。</p>
        ${platform ? `<p class="door-legend">這是陽台與臥室3<strong>外面</strong>的連續外推區，
            不是新的室內房間；原圖只有外框、沒有可通行門或承重註記。
            右側約 39cm 靠外牆部分不在外推輪廓內。</p>` : `<p class="door-legend">配置門位：${doorsForRoom(room.id)
            .map((door) => escapeHtml(door.label)).join("、") || "未標示"}；
            淡色虛線箭頭表示門洞淨寬待量，僅示意開口；填入門寬後才顯示數字並按比例畫，
            門高請看門片資料欄。</p>`}
        ${room.id === "entry" || room.id === "living-dining"
            ? `<p class="door-legend">玄關與客餐廳共用牆依現況圖的
                <strong>木作拱門</strong>畫出通口，圖上標「拱」；玄關外側大門仍在原位。
                這只是把原有開口畫清楚，沒有新增拆牆或門片報價；
                拱門的淨寬、門高與現場狀況仍須核對。</p>` : ""}
        ${platform ? "" : roomWindows.length ? `<p class="door-legend">現況圖 W 窗洞：
            ${roomWindows.map((window) => escapeHtml(window.label)).join("、")}；實際位置與尺寸仍須現場核對。</p>`
            : items.some((item) => item.name === "冷氣")
                ? '<p class="door-legend">現況圖未能確認此房窗位；冷氣室內機位置與管線須現場確認。</p>'
                : ""}
        ${room.id === "balcony" ? `<p class="door-legend">陽台後側無窗；
            ${visiblePlanLayers.furniture ? "左側青灰圖示為現況泥作水槽" :
                "左側現況泥作水槽圖示目前隨家具隱藏"}，
            水槽已依你要求旋轉 90°；原報價拆除說明列有此物，保留或拆除仍須確認。
            洗衣機在資料中暫按 60×60cm 配置於陽台；
            ${platformDryer ? "烘衣機改標於外推鐵窗的陽台側，並非確認可放置、固定或接電。"
                : "烘衣機位置以目前圖面為準。"}
            熱水器仍標於陽台牆面，
            可點圖上 ↻ 旋轉；窄條圖示不代表機身實際尺寸或安裝高度。</p>` : ""}
        ${room.id === "balcony" && balconyOutdoorSwitch ? `<p class="plan-overlap-alert"
            role="note">陽台門旁的青綠色「雙」是<strong>戶外防潮雙開關暫位</strong>，
            供討論陽台燈控制；原報價工作室陽台側室內開關已從規劃移除。
            NT$2,250 僅借原室內開關單價試算，戶外盒體、防護等級、漏電保護、
            防水進線與可能的價差／追加配線均須合格電工重報。</p>` : ""}
        ${splitAC && splitAC.acPlanStatus === "excluded"
            ? `<p class="door-legend"><strong>臥室2暫不裝分離式冷氣。</strong>
                現況無對外窗，外推鐵窗在臥室3及陽台外，管線路徑待核；
                原室內機標位及方向保留在設備資料，不計入分離式待報台數。
                <button type="button" data-action="restore-split-ac"
                    data-item-id="${escapeHtml(splitAC.id)}">重新評估分離式</button></p>` :
            splitAC ? `<p class="door-legend"><span class="outdoor-ac-key">外</span>
                ${splitAC.outdoorPlacement && OUTDOOR_AC_ZONES[room.id]
                    ? `室外機暫標於${escapeHtml(outdoorACZone(splitAC).label)}；
                        按長 ${splitAC.outdoorWidthCm}×短 ${splitAC.outdoorDepthCm}cm
                        暫估占地，已轉 ${splitAC.outdoorOrientation ?? 0}°；
                        可拖往其他候選窗位、點室外機右上 ↻ 轉向，
                        或在冷氣設備欄修改尺寸，
                        不另加一筆機器費。`
                    : "室外機位置尚待勘察，未憑空畫出可用的機位。"}
                ${room.id === "bedroom-3"
                    ? "原圖後牆仍有 W 窗，但依你指示室外機標在更外側的鐵窗。"
                    : ""}
                實機尺寸、固定承重、配管、散熱、排水及許可必須現場確認。</p>` : ""}
        ${splitAC?.outdoorPlacement && outdoorACSceneConflict(splitAC)
            ? '<p class="plan-overlap-alert" role="alert">室外機暫估占地與外牆或鐵窗圖示邊界相交；目前位置已保留，須核對實機尺寸與可用空間。</p>' : ""}
        ${selectedOutdoorWindow && selectedOutdoorWindow.widthCm < splitAC.outdoorWidthCm
            ? `<p class="plan-overlap-alert" role="alert">
                所選 W${selectedOutdoorWindow.widthCm}cm 窗洞窄於室外機暫估長邊
                ${splitAC.outdoorWidthCm}cm；不得假設可從此窗搬運，
                外牆支架、管線與施工動線須現勘。</p>` : ""}
        ${room.id === "ac-platform" && state.items.some((item) =>
            item.roomId === "bedroom-3" && item.outdoorPlacement)
            ? `<p class="door-legend"><span class="outdoor-ac-key">外</span>
                ${visiblePlanLayers.furniture ? "鐵窗中的「外」是臥室3冷氣的室外機暫位，點圖示可回臥室3" :
                    "臥室3冷氣室外機圖示目前隨家具隱藏，原暫位與設備資料仍保留"}；
                不是額外第六台機器。鐵窗承重、排熱及合法性未查，不能據圖推定可裝。</p>`
            : ""}
        ${platform && items.some((item) => item.furnitureType === "dryer") ? `<p class="plan-overlap-alert"
            role="note">烘衣機暫標在靠陽台的外推鐵窗上，60×60cm 是占地估值，
            深度約 78cm 僅按圖面描繪，<strong>不表示鐵窗可承重或機器可露天使用</strong>。
            機重、承台補強、固定防墜、雨水防護、專用電路、排氣與散熱、
            維修動線及建管許可均須現勘核定；不得依此圖直接施工。</p>` : ""}
        ${room.id === "bath-guest" ? `<p class="door-legend">乾濕分離玻璃門已移到下方淋浴區，
            避開浴缸；走廊側客浴入口門維持原圖位置。實際淨寬與門片開啟仍須現場核對。</p>` : ""}
        ${room.id === "bath-main" || room.id === "bath-guest"
            ? `<p class="door-legend"><span class="wet-dry-key"></span>青藍虛線標乾濕分離（一字）
                玻璃隔屏，門洞處以玻璃門線表示；原報價每間 22,000 元加防爆膜 3,000 元，
                已分列在設備明細、不另加到總額。隔屏長度及開門淨寬待丈量。</p>` : ""}
        ${room.id === "bedroom-2" ? `<p class="door-legend">上側對客廳、右側對走廊的
            彩色牆線是同一筆臥室2輕隔間；兩面牆一起切換，原報價合計 5 坪，
            線重只是材質圖例，不代表實際厚度。</p>` : ""}
        ${room.id === "bath-main" || room.id === "bath-guest"
            ? '<p class="door-legend">圖中的雙字小方塊是開關控制位置示意；實際開關應避開濕區，由電工現場確認安全位置與迴路。</p>' : ""}
        ${items.some(isFreshAirUnit) ? `<p class="door-legend">
            <span class="bathroom-key fresh-air">新</span>是<strong>室外進氣的新風機暫位</strong>，
            非原暖風乾燥機。新機本體的型號、浴室適用性及價格待填；
            原報價每間「暖風機安裝」NT$2,500 僅暫借作安裝額度，
            外牆進氣開孔、管線與實價須廠商確認。</p>` : ""}
        ${items.some(isToiletRinseKit) ? `<p class="door-legend">
            <span class="bathroom-key rinse-kit">沖</span>為馬桶旁可拖動的三叉管＋沖洗器，
            每組 NT$${currency.format(RINSE_KIT_REFERENCE_PRICE_TWD)}（屋主提供特力屋參考價）；
            安裝、接頭與免治便座給水相容性待核。</p>` : ""}
        ${items.some(isHeatedTowelRail) ? `<p class="door-legend">
            <span class="bathroom-key towel-rail">巾</span>是牆面的電熱毛巾架暫位，
            可拖動或點右上角 ↻ 轉向；本體、配線與安裝價都待補，
            防潮防觸電與安裝高度須現場核定。</p>` : ""}
        ${items.some(isBathGrabBar) ? `<p class="door-legend">
            <span class="bathroom-key grab-bar">扶</span>是客浴浴缸牆面防滑扶手暫位，
            可拖動或轉向；牆體錨固、浴缸使用動線與費用須現勘。</p>` : ""}
        ${items.some(isQuotedDownlight)
            ? `<p class="door-legend"><span class="downlight-key">燈</span>圓形為兩個可拖動的
                <strong>天花崁燈示意點</strong>，非實際燈具尺寸或開孔尺寸；
                原報價每個 NT$950 已含舞光 LED 索爾嵌燈、配線及安裝；
                暫拆燈具約 NT$${DOWNLIGHT_FIXTURE_ESTIMATE_TWD}、
                施工約 NT$${DOWNLIGHT_INSTALL_ESTIMATE_TWD}，切換款式只試算與
                原報價的價差，實際拆價待廠商確認。
                ${room.id === "kitchen" ? "位置、迴路與天花開孔待核。" :
                "靠近浴缸／淋浴區的燈具，防護等級及安裝位置須請電工確認。"}</p>` : ""}
        ${items.some(isCeilingLight)
            ? `<p class="door-legend"><span class="ceiling-light-key">頂</span>
                此房 ${items.filter(isCeilingLight).length} 盞可拖動的
                <strong>天花吸頂燈示意點</strong>，不是燈具實際大小。
                原報價安裝只有每盞 NT$1,200 單價、數量未填且本次為零；
                燈具本體依逐盞選款另計，配線安裝暫按單價追加。
                ${room.id === "balcony"
                    ? "陽台必須選戶外防潮燈並確認遮蔽頂與防水配線，實價待重報。"
                    : "天花固定、迴路及施工實價仍須核對。"}</p>` : ""}
        ${room.id === "corridor" && corridorTrack
            ? `<p class="door-legend"><span class="track-light-key"></span>黑線為一條
                <strong>1.5 米天花軌道</strong>，圓點為
                ${corridorTrack.spotlightQuantity} 盞軌道燈；可拖動整組。
                軌道、燈具和配線安裝的目前價格與暫計詳見下方；原報價安裝
                數量未填、本次 0 元，並非已含工程。燈具／軌道型號、天花固定、
                供電與實際施工價待核。</p>` : ""}
        <div class="plan-picker">
            <label>要放置的設備
                <select data-plan-item-select ${placeableItems.length ? "" : "disabled"}>
                    ${choices || '<option value="">請先新增設備</option>'}
                </select>
            </label>
            <button type="button" data-action="add-plan-item">＋ 此房間新增設備</button>
            ${platform ? "" : `<button type="button"
                data-action="add-switch" data-room-id="${escapeHtml(room.id)}">＋ 新增開關</button>
                <button type="button" data-action="add-socket"
                    data-room-id="${escapeHtml(room.id)}">＋ 插座</button>
                <button type="button" data-action="add-dedicated-circuit"
                    data-room-id="${escapeHtml(room.id)}">＋ 專用迴路</button>`}
        </div>
        <p class="placement-status" role="status">${selected
            ? `${escapeHtml(selected.name)}：${placementDescription(selected.placement)}` +
                `${selected.kind === "furniture" ? `；家具${[90, 270].includes(selected.orientation) ? "直向" : "橫向"}` : ""}` +
                `${selected.placement && rotateHandleHidden
                    ? "；轉向已結束，可拖動圖示移位" : ""}`
            : "此房間尚無設備；請先新增。"}            </p>
            ${outdoorControls}
            ${doorControls}
        ${selected ? renderItemProductSelection(selected) +
            renderSelectedLightControls(selected) : ""}
        ${isDedicatedCircuit(selected) ? `<div class="item-product-selection">
            ${field(selected, "circuitOutletId", "對應一般插座")}
            <small>每條迴路只能配一個插座；重新配對後，紫色標記會移到新插座旁。
                若少於原報 7 條，負載共線可能跳電，須請電工確認。</small>
        </div>` : ""}
        ${room.id === "bedroom-2"
            ? bedroom2Partition ? renderPartitionControls(bedroom2Partition) :
                '<p class="plan-overlap-alert" role="alert">臥室2輕隔間報價明細尚未加入，請重新載入清單。</p>'
            : ""}
        ${room.id === "corridor" && corridorTrack ? renderCorridorTrackControls(corridorTrack) : ""}
        ${roomDoors.length ? renderDoorMaterialLegend() : ""}
        <section class="furniture-palette" role="group" aria-label="本房已放置物件與顯示切換">
            <div class="palette-head">
                <h3>物件工具列｜本房已放置</h3>
                ${visibleControls}
            </div>
            ${visibilityNote}
            ${objectPalette
                ? `<div class="furniture-options">${objectPalette}</div>`
                : '<p class="muted">本房尚無已標位物件；請從上方選設備或展開下方家具範本後點圖放置。</p>'}
            <p class="muted">此處只列本房圖上已有位置的物件（含插座及專用迴路），
                可拖進圖中重新定位；觸控可先點名稱再點房內。
                尚未標位的設備請從上方「要放置的設備」選取後點圖，
                新家具則從下方範本新增。圖例不代表實機尺寸；
                旋轉圓形燈具只改示意刻線，軌道轉向會帶動模擬光點。</p>
        </section>
        <details class="furniture-templates" ${furnitureTemplatesOpen ? "open" : ""}>
            <summary>＋ 新增家具（從範本選擇）</summary>
            <div class="furniture-options">${furnitureTemplates}</div>
            <p class="muted">選擇床、沙發或家電後點房內定位；新增成功才會出現在上方
                「本房已放置」工具列。物件型號、尺寸與價格仍須確認。</p>
        </details>
        ${showSourceOverlay ? '<p class="plan-disclaimer">透明幾何底圖只供比較輪廓及隔間；家具以圖上的可編輯物件為準，拉門以紫色線標示。</p>' : ""}
        <div class="room-plan-controls">
            ${lightingControls}
            ${selected?.placement && !rotateHandleHidden
                ? `<button type="button" data-action="finish-rotation">
                    完成轉向（可拖曳）</button>` : ""}
        </div>
        ${platform ? `<div class="platform-scroll">
            ${renderRoomPlan(room, items, selectedPlanItemId, state.items, showSourceOverlay,
                lightingPreview ? litItemIds : null, visiblePlanLayers, focusedCircuitId,
                !rotateHandleHidden, lightingPlaneCm)}
        </div><p class="plan-disclaimer">長形鐵窗圖可水平捲動；縮放時仍保持原圖縱橫比例。</p>`
            : renderRoomPlan(room, items, selectedPlanItemId, state.items, showSourceOverlay,
                lightingPreview ? litItemIds : null, visiblePlanLayers, focusedCircuitId,
                !rotateHandleHidden, lightingPlaneCm)}
        ${lightingLegend}
        ${renderLightingAssessment(room)}
        ${room.id === "kitchen" ? `<p class="plan-overlap-alert">${KITCHEN_SAFETY}</p>
            ${renderKitchenReference()}` : ""}
        ${mappingPanel}
        <p class="plan-disclaimer">淺色線標的是圖上寬與長；
            ${platform ? "鐵窗外推深度為圖面量繪，並非載重或可用淨距保證" :
                "弧牆或梁柱退縮的房間標「外接」，不是每一處的淨寬"}。
            ${roomWindows.length ? "W 數值是現況圖的窗洞寬（cm），不是窗框或安裝淨寬。" : ""}</p>
        ${conflicts.some((item) => item.roomId === room.id) ? `<p class="plan-overlap-alert" role="alert">
            按現況圖牆柱位置，${conflicts.filter((item) => item.roomId === room.id)
                .map((item) => escapeHtml(item.name)).join("、")}與牆線或固定設施相交；
            原標位未自動改動，請拖動或現場核對。</p>` : ""}
        <p class="plan-disclaimer">圖示標紅代表物件按現況圖比例及暫填物件尺寸與牆線或固定水槽相交；
            既有儲存位置不會被自動移動。施工前須核對窗、門、梁柱、排水及走道淨距。</p>
        <div class="plan-item-actions">
            <button type="button" data-action="clear-placement"
                ${selected?.placement && !isQuotedOutlet(selected) &&
                    (!isSocket(selected) || !state.items.some((entry) =>
                        isDedicatedCircuit(entry) && entry.circuitOutletId === selected.id))
                    ? "" : "disabled"}
                >清除這項設備的位置</button>
            ${isQuotedOutlet(selected) ? `<button type="button"
                data-action="request-move-outlet" data-item-id="${escapeHtml(selected.id)}">
                移至別房</button>` : ""}
            <button type="button" class="danger"
                data-action="remove-plan-item" ${selected ? "" : "disabled"}>
                ${selected && isQuotedSwitch(selected)
                        ? "從規劃移除開關" : "刪除所選設備"}</button>
        </div>
        ${renderDeleteConfirmation(selected)}
        ${renderMoveOutletConfirmation(selected)}
        <p class="muted plan-footnote">${room.id === "bath-main" || room.id === "bath-guest"
            ? "原報價已列「調整馬桶位置」2 支共 4,000 元；是否涵蓋所選位置，以及排水、乾濕分離、門片開啟與尺寸，仍需現場確認。"
            : room.id === "balcony"
                ? `請確認泥作水槽去留、陽台門淨寬、洗衣機給排水；
                    ${platformDryer ? "移至鐵窗的烘衣機之承重、防雨、迴路與排氣尚未可施工；" : ""}
                    熱水器的型式、供能與排氣另須核對。機器尺寸和價格待補。`
            : platform
                ? `臥室3室外機已與室內機連動，不另重複計價；
                    ${platformDryer ? "烘衣機也只是鐵窗上的位置暫標。" : ""}
                    實機尺寸、造價、合法性、承重錨固、防雨防墜、
                    排熱通風、供電及維修動線均待確認。`
            : room.id === "living-dining"
                ? "電視暫靠客餐廳與主臥共用牆的客餐廳側；冰箱、沙發及電視外形均未實測，須核對插座、壁掛方式、走道與櫃體淨距。"
            : "圖面僅供討論相對位置；門片、窗位與設備安裝尺寸仍需現場確認。"}</p>
        ${reference}
    </section>`;
}

function render() {
    if (!state) return;
    if (rendering) {
        rerenderQueued = true;
        return;
    }
    rendering = true;
    try {
        updateUndoButton();
        for (const button of document.querySelectorAll("[data-view]")) {
            button.setAttribute("aria-selected", String(button.dataset.view === view));
        }
        document.querySelector("#add-item").hidden = view === "survey" || view === "database";
        document.querySelector("#save-file").disabled = false;
        document.querySelector("#export-items").disabled = false;
        document.querySelector("#download-portable").hidden = isPortableMode();
        document.querySelector("#portable-note").hidden = !isPortableMode();
        content.innerHTML = (pendingNewItem && view !== "survey" &&
            view !== "database" ? renderNewItemForm() : "") +
            (view === "survey" ? renderSurvey(survey, state.rooms)
            : view === "plan" ? renderPlanView()
                : view === "room" ? renderRoomView()
                    : view === "database" ? renderDatabaseView() : renderDeviceView());
        renderTotals();
    } finally {
        rendering = false;
        if (rerenderQueued) {
            rerenderQueued = false;
            requestAnimationFrame(render);
        }
    }
}

function renderPlanChange() {
    const top = window.scrollY;
    const platformLeft = content.querySelector(".platform-scroll")?.scrollLeft;
    render();
    if (platformLeft != null) content.querySelector(".platform-scroll").scrollLeft = platformLeft;
    window.scrollTo(0, top);
}

function refreshLightLabels(roomId) {
    for (const label of content.querySelectorAll("[data-light-status-id]")) {
        const item = state.items.find((entry) =>
            entry.id === label.dataset.lightStatusId);
        if (item?.roomId === roomId) label.textContent = lightListStatus(item);
    }
}

function refreshLightingPreview() {
    if (!lightingPreview || view !== "plan") return;
    for (const overlay of content.querySelectorAll(".lighting-preview")) {
        const roomId = overlay.closest("[data-room-canvas]")?.dataset.roomCanvas ??
            overlay.closest("[data-select-room]")?.dataset.selectRoom;
        const room = state.rooms.find((entry) => entry.id === roomId);
        if (!room) throw new RangeError("找不到燈光模擬所屬的房間。");
        overlay.outerHTML = renderLightingPreview(roomGeometry(room),
            state.items, litItemIds, lightingPlaneCm);
    }
    const assessment = content.querySelector(".lighting-assessment");
    if (assessment) {
        const opened = new Set([...assessment.querySelectorAll(".lighting-room[open]")]
            .map((entry) => entry.dataset.lightRoomId));
        assessment.outerHTML = renderLightingAssessment(
            state.rooms.find((entry) => entry.id === planRoomId));
        for (const detail of content.querySelectorAll(".lighting-room")) {
            if (opened.has(detail.dataset.lightRoomId)) detail.open = true;
        }
    }
    for (const note of content.querySelectorAll("[data-light-spec-id]")) {
        const item = state.items.find((entry) => entry.id === note.dataset.lightSpecId);
        if (item) note.textContent = lightSpecificationNote(item);
    }
}

function toggleLightSimulation() {
    lightingPreview = !lightingPreview;
    litItemIds = lightingPreview
        ? new Set(state.items.filter(isPlacedLight).map((item) => item.id)) : new Set();
    focusedCircuitId = null;
    circuitListOpen = false;
    renderPlanChange();
}

function toggleAllPreviewLights() {
    if (!lightingPreview) {
        setStatus("請先開啟照明模擬。", "error");
        return;
    }
    const allLights = state.items.filter(isPlacedLight);
    const allLit = allLights.length > 0 &&
        allLights.every((item) => litItemIds.has(item.id));
    litItemIds = allLit ? new Set() : new Set(allLights.map((item) => item.id));
    renderPlanChange();
}

function togglePreviewMarker(id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!lightingPreview || !item || !(item.switchType || item.lightType)) {
        setStatus("這項物件不是可切換的模擬開關或燈具。", "error");
        return;
    }
    const targets = item.lightType
        ? isPlacedLight(item) ? [item.id] : []
        : previewControlledLights(item, state.items).map((entry) => entry.id);
    if (!targets.length) {
        setStatus("這處尚未放置可模擬的燈具；開關與實際迴路仍待電工配置。");
        return;
    }
    const allLit = targets.every((target) => litItemIds.has(target));
    for (const target of targets) {
        if (allLit) litItemIds.delete(target);
        else litItemIds.add(target);
    }
    focusedCircuitId = item.id;
    renderPlanChange();
}

function renderSurveyAtSameCenter() {
    const previous = content.querySelector(".survey-scroll");
    const centerX = previous ? (previous.scrollLeft + previous.clientWidth / 2) / previous.scrollWidth : 0.5;
    const centerY = previous ? (previous.scrollTop + previous.clientHeight / 2) / previous.scrollHeight : 0.5;
    render();
    const next = content.querySelector(".survey-scroll");
    if (next) {
        next.scrollLeft = centerX * next.scrollWidth - next.clientWidth / 2;
        next.scrollTop = centerY * next.scrollHeight - next.clientHeight / 2;
    }
}

function clampPlacement(item, x, y) {
    const room = state.rooms.find((entry) => entry.id === item.roomId);
    if (!room) {
        setStatus("設備所屬房間不存在，無法定位。", "error");
        return null;
    }
    const geometry = roomGeometry(room);
    const size = placementFootprint(item, geometry);
    if (!size || !Number.isFinite(x) || !Number.isFinite(y)) {
        setStatus("物件尺寸或放置位置不正確，無法定位。", "error");
        return null;
    }
    const center = nearestRoomCenter(geometry, geometry.x + x * geometry.width,
        geometry.y + y * geometry.height, size.width, size.height);
    if (!center) {
        setStatus("依現況圖比例與已填尺寸，物品放不進房間輪廓或會碰到固定水槽；請核對尺寸或改選位置。", "error");
        return null;
    }
    const normalized = {
        x: (center.x - geometry.x) / geometry.width,
        y: (center.y - geometry.y) / geometry.height,
    };
    for (const precision of [1000, 10000, 1000000]) {
        const placement = {
            x: Math.round(normalized.x * precision) / precision,
            y: Math.round(normalized.y * precision) / precision,
        };
        if (footprintFits(geometry,
            geometry.x + placement.x * geometry.width,
            geometry.y + placement.y * geometry.height, size.width, size.height)) {
            return placement;
        }
    }
    if (footprintFits(geometry, center.x, center.y, size.width, size.height)) {
        return normalized;
    }
    setStatus("位置四捨五入後超出房間輪廓或固定設施，未儲存本次移動。", "error");
    return null;
}

function setPlacement(x, y) {
    if (invalidInputs.size) {
        setStatus("請先修正無效數字，再標記設備位置。", "error");
        return;
    }
    const item = state.items.find((entry) => entry.id === selectedPlanItemId && entry.roomId === planRoomId);
    if (!item || !Number.isFinite(x) || !Number.isFinite(y)) {
        setStatus("請先選擇這個房間內的設備，再選放置位置。", "error");
        return;
    }
    const placement = clampPlacement(item, x, y);
    if (!placement) return;
    item.placement = placement;
    rotateHandleHidden = true;
    scheduleSave();
    render();
}

function finishRotation() {
    if (invalidInputs.size || conflicted) {
        setStatus("請先修正無效數字或版本衝突，再結束轉向。", "error");
        return;
    }
    pendingObject = null;
    rotateHandleHidden = true;
    renderPlanChange();
    setStatus("已結束轉向；現在可直接拖動物件。要再旋轉，點一下物件即可顯示 ↻。");
}

function setOrientation(orientation) {
    if (invalidInputs.size) {
        setStatus("請先修正無效數字，再旋轉物件。", "error");
        return;
    }
    const item = state.items.find((entry) => entry.id === selectedPlanItemId && entry.roomId === planRoomId);
    if (!item || !isPlaceableItem(item) || !item.placement ||
        (orientation !== null && ![0, 90, 180, 270].includes(orientation))) {
        setStatus("請先選擇這個房間內已放置的可拖動設備或家具。", "error");
        return;
    }
    const previousOrientation = item.orientation;
    item.orientation = orientation;
    const room = state.rooms.find((entry) => entry.id === item.roomId);
    const geometry = room && roomGeometry(room);
    const footprint = geometry && placementFootprint(item, geometry);
    if (!footprint || !Number.isFinite(footprint.width) ||
        !Number.isFinite(footprint.height)) {
        item.orientation = previousOrientation;
        setStatus("物件尺寸無效，未變更方向；請先修正物件資料。", "error");
        return;
    }
    const previousPlacement = { ...item.placement };
    const placement = clampPlacement(item, item.placement.x, item.placement.y);
    if (placement) item.placement = placement;
    scheduleSave();
    render();
    if (!placement) {
        setStatus("已旋轉，但目前方向無法在房間內放下；原中心點已保留並標紅，請調整配置。", "error");
    } else if (Math.abs(placement.x - previousPlacement.x) > .005 ||
        Math.abs(placement.y - previousPlacement.y) > .005) {
        setStatus("已轉向並微調標位以避開牆線；請再核對實際位置。");
    }
}

function rotateItem(id) {
    if (conflicted) {
        setStatus("資料版本有衝突，請先重新載入再旋轉物件。", "error");
        return;
    }
    const item = state.items.find((entry) => entry.id === id && entry.roomId === planRoomId);
    if (!item || !isPlaceableItem(item) || !item.placement) {
        setStatus("找不到可旋轉的物件，請重新載入。", "error");
        return;
    }
    selectedPlanItemId = item.id;
    pendingObject = null;
    rotateHandleHidden = false;
    setOrientation(item.orientation === null
        ? (isAirConditioner(item) ? 0 : 90)
        : (item.orientation + 90) % 360);
}

function rotateOutdoorUnit(id) {
    if (invalidInputs.size || conflicted) {
        setStatus("請先修正未儲存的數字或版本衝突，再旋轉室外機。", "error");
        return;
    }
    const item = state.items.find((entry) => entry.id === id);
    if (!item || !isActiveSplitAirConditioner(item) || !item.outdoorPlacement) {
        setStatus("找不到可旋轉的窗外室外機暫位。", "error");
        return;
    }
    pendingObject = null;
    rotateHandleHidden = false;
    item.outdoorOrientation = ((item.outdoorOrientation ?? 0) + 90) % 360;
    const conflict = outdoorACSceneConflict(item);
    scheduleSave();
    render();
    if (conflict) {
        setStatus("已旋轉室外機，但暫估占地超出圖示的窗外或鐵窗輪廓；請調整位置或規格。", "error");
    }
}

function changeOutdoorWindow(target) {
    const item = state.items.find((entry) =>
        entry.id === target.dataset.itemId && entry.roomId === planRoomId);
    const originalZoneId = item?.outdoorZoneId ?? OUTDOOR_AC_ZONES[item?.roomId]?.windowId;
    const zone = item && outdoorACZoneChoices(item.roomId)
        .find((entry) => entry.windowId === target.value);
    const window = zone && windowsForRoom(item.roomId)
        .find((entry) => entry.id === zone.windowId);
    if (!item || !isActiveSplitAirConditioner(item) || !zone || !window ||
        invalidInputs.size || conflicted) {
        if (item) target.value = originalZoneId;
        setStatus("找不到可切換的同房窗外暫位，或尚有無效輸入／版本衝突。", "error");
        return;
    }
    if (zone.windowId === originalZoneId) return;
    const next = {
        ...item, outdoorZoneId: zone.windowId,
        outdoorPlacement: { ...zone.placement },
    };
    if (outdoorACSceneConflict(next)) {
        target.value = originalZoneId;
        setStatus("此窗外位置無法容納目前尺寸與方向的暫估室外機；未改動窗位。", "error");
        return;
    }
    item.outdoorZoneId = next.outdoorZoneId;
    item.outdoorPlacement = next.outdoorPlacement;
    pendingObject = null;
    rotateHandleHidden = true;
    scheduleSave();
    renderPlanChange();
    setStatus(`已暫移至${zone.label}；${window.widthCm < item.outdoorWidthCm
        ? `W${window.widthCm}cm 窗洞窄於 ${item.outdoorWidthCm}cm 暫估機長，搬運與固定待核；`
        : ""}正在儲存，實際可行性須由廠商現勘。`);
}

function restoreSplitAC(id) {
    const item = state.items.find((entry) => entry.id === id);
    if (id !== "ac-bedroom-2" || !item || item.acPlanStatus !== "excluded") {
        setStatus("找不到臥室2暫停的分離式冷氣規劃。", "error");
        return;
    }
    if (invalidInputs.size) {
        setStatus("請先修正無效數字，再恢復分離式冷氣規劃。", "error");
        return;
    }
    item.acPlanStatus = "active";
    if (item.name === "冷氣（臥室2暫不裝分離式）") item.name = "冷氣";
    const message = "已重新開啟分離式規劃；室外機及通往外牆的管線仍無可確認路徑。";
    if (!item.note.includes(message) && item.note.length + message.length <= 1000) {
        item.note += message;
    }
    selectedPlanItemId = item.id;
    scheduleSave();
    render();
}

function diagramWorldPoint(svg, event) {
    const matrix = svg.getScreenCTM();
    if (!matrix) {
        setStatus("無法判定圖面點選位置，請重新載入畫布後再試。", "error");
        return null;
    }
    const pointer = svg.createSVGPoint();
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    return pointer.matrixTransform(matrix.inverse());
}

function roomPoint(svg, event, clampOutside = false) {
    const room = state.rooms.find((entry) => entry.id === planRoomId);
    if (!room) {
        setStatus("找不到目前房間，無法標記位置。", "error");
        return null;
    }
    const geometry = roomGeometry(room);
    const point = diagramWorldPoint(svg, event);
    if (!point) return null;
    if (!clampOutside && !pointInZone(geometry, point.x, point.y)) {
        setStatus("請點選房間輪廓內，而不是牆線、梁柱退縮處或圖外。", "error");
        return null;
    }
    return {
        x: (point.x - geometry.x) / geometry.width,
        y: (point.y - geometry.y) / geometry.height,
    };
}

function clampOutdoorPlacement(item, point) {
    const zones = outdoorACZoneChoices(item.roomId);
    if (!zones.length || !isActiveSplitAirConditioner(item)) {
        setStatus("這個房間沒有可拖移的窗外室外機暫位。", "error");
        return null;
    }
    const marginX = OUTDOOR_AC_ANCHOR.width / 2 + 1;
    const marginY = OUTDOOR_AC_ANCHOR.height / 2 + 1;
    let best = null;
    for (const zone of zones) {
        if (zone.width <= 2 * marginX || zone.height <= 2 * marginY) continue;
        const x = Math.max(zone.x + marginX,
            Math.min(point.x, zone.x + zone.width - marginX));
        const y = Math.max(zone.y + marginY,
            Math.min(point.y, zone.y + zone.height - marginY));
        const placement = {
            x: Math.round((x - zone.x) / zone.width * 1000) / 1000,
            y: Math.round((y - zone.y) / zone.height * 1000) / 1000,
        };
        if (outdoorACSceneConflict({
            ...item, outdoorZoneId: zone.windowId, outdoorPlacement: placement,
        })) continue;
        const distance = Math.hypot(point.x - x, point.y - y);
        if (!best || distance < best.distance - .001 ||
            Math.abs(distance - best.distance) < .001 &&
                zone.windowId === item.outdoorZoneId) {
            best = { outdoorZoneId: zone.windowId, placement, distance };
        }
    }
    if (!best) {
        setStatus("候選窗位均無法容納目前的室外機暫估外框，未改動位置；請核對尺寸與方向。", "error");
        return null;
    }
    return best;
}

function placeExistingItem(id, position) {
    const item = state.items.find((entry) => entry.id === id &&
        entry.roomId === planRoomId && isPlaceableItem(entry));
    if (!item) {
        setStatus("找不到要放置的物件，請重新載入。", "error");
        return;
    }
    const placement = clampPlacement(item, position.x, position.y);
    if (!placement) return;
    item.placement = placement;
    selectedPlanItemId = item.id;
    pendingObject = null;
    rotateHandleHidden = true;
    scheduleSave();
    render();
}

function placeOnRoomDiagram(svg, event) {
    const position = roomPoint(svg, event);
    if (!position) return;
    if (pendingObject?.kind === "template") return addFurniture(pendingObject.type, position);
    if (pendingObject?.kind === "existing") return placeExistingItem(pendingObject.id, position);
    setPlacement(position.x, position.y);
}

function scheduleSave(inputKey = null) {
    const updated = stateSnapshot();
    if (inputKey && inputKey !== inputGroupKey) inputGroupBefore = lastActionState;
    if (lastActionState && JSON.stringify(updated) !== JSON.stringify(lastActionState)) {
        const before = inputKey && inputKey === inputGroupKey && inputGroupBefore
            ? inputGroupBefore : lastActionState;
        state.undo = structuredClone(before);
        lastActionState = updated;
        updateUndoButton();
    }
    if (!inputKey) {
        inputGroupKey = null;
        inputGroupBefore = null;
    } else {
        inputGroupKey = inputKey;
    }
    dirty = true;
    clearTimeout(saveTimer);
    if (invalidInputs.size) {
        setStatus("請先修正無效數字，才能儲存。", "error");
        reloadButton.hidden = false;
        return;
    }
    if (conflicted) return;
    setStatus("有未儲存的修改");
    reloadButton.hidden = true;
    saveTimer = setTimeout(() => void save(), 700);
}

async function fetchState() {
    return readPlannerState();
}

async function save() {
    clearTimeout(saveTimer);
    if (saving) return saveFinished;
    if (!dirty || conflicted) return;
    if (invalidInputs.size) {
        setStatus("請先修正無效數字，才能儲存。", "error");
        reloadButton.hidden = false;
        return;
    }
    if (state.rooms.some((room) => !room.name.trim()) ||
        state.items.some((item) => !item.name.trim() || !item.unit.trim()) ||
        state.products.some((product) => !product.name.trim() ||
            !product.unit.trim())) {
        setStatus("商品、設備或房間名稱及單位不可留白", "error");
        return;
    }
    const payload = {
        version: PLANNER_STATE_VERSION,
        expectedRevision: state.revision,
        rooms: state.rooms,
        items: state.items,
        products: state.products,
        undo: state.undo ?? null,
    };
    let finishSave;
    saveFinished = new Promise((resolve) => { finishSave = resolve; });
    saving = true;
    dirty = false;
    setStatus("儲存中…");
    try {
        const result = await writePlannerState(payload);
        state.revision = result.revision;
        state.updatedAt = result.updatedAt;
        if (!dirty) {
            state.undo = result.undo ?? null;
            lastActionState = stateSnapshot();
        }
        updateUndoButton();
        if (invalidInputs.size) {
            reloadButton.hidden = false;
            setStatus("請先修正無效數字，才能儲存。", "error");
        } else if (result.storageWarning) {
            dirty = true;
            setStatus(result.storageWarning, "error");
        } else {
            reloadButton.hidden = true;
            setStatus(dirty ? "仍有未儲存的修改" : "已儲存於本機", dirty ? "info" : "saved");
        }
    } catch (error) {
        dirty = true;
        conflicted = Boolean(error.conflict);
        setStatus(error.message, "error");
        reloadButton.hidden = !conflicted;
    } finally {
        saving = false;
        finishSave();
        updateUndoButton();
        if (dirty && !conflicted && status.dataset.kind !== "error") {
            clearTimeout(saveTimer);
            saveTimer = setTimeout(() => void save(), 300);
        }
    }
}

async function undoLastChange() {
    if (!state?.undo || undoing) {
        setStatus("目前沒有可還原的上一筆資料變更。", "error");
        return;
    }
    if (invalidInputs.size || conflicted) {
        setStatus("請先修正無效欄位或版本衝突，再還原上一步。", "error");
        return;
    }
    if ((pendingNewItem || pendingProduct) &&
        !window.confirm("還原上一步會捨棄尚未送出的設備或商品表單，確定嗎？")) {
        return;
    }
    undoing = true;
    updateUndoButton();
    setStatus("正在儲存目前操作並還原上一步…");
    try {
        if (saving) await saveFinished;
        if (dirty) await save();
        if (saving) await saveFinished;
        if (dirty || conflicted || invalidInputs.size) {
            if (status.dataset.kind !== "error") {
                setStatus("目前變更尚未安全儲存，無法還原；請先處理儲存錯誤。", "error");
            }
            return;
        }
        if (!state.undo) {
            setStatus("目前沒有可還原的上一筆資料變更。", "error");
            return;
        }
        const previous = structuredClone(state.undo);
        const result = await writePlannerState({
            version: PLANNER_STATE_VERSION,
            expectedRevision: state.revision,
            rooms: previous.rooms,
            items: previous.items,
            products: previous.products,
            undo: null,
        });
        state = { ...result, products: result.products ?? [] };
        dirty = Boolean(result.storageWarning);
        conflicted = false;
        invalidInputs.clear();
        pendingNewItem = null;
        newItemOriginView = null;
        pendingProduct = null;
        pendingDeleteId = null;
        pendingMoveOutletId = null;
        pendingProductDeleteId = null;
        pendingObject = null;
        lightingPreview = false;
        litItemIds = new Set();
        focusedCircuitId = null;
        resetActionTracking();
        reloadButton.hidden = true;
        render();
        setStatus(result.storageWarning ||
            "已還原上一步；物件、位置及規劃金額已更新並儲存。",
        result.storageWarning ? "error" : "saved");
    } catch (error) {
        conflicted = Boolean(error.conflict);
        setStatus(error.message, "error");
        reloadButton.hidden = !conflicted;
    } finally {
        undoing = false;
        updateUndoButton();
    }
}

function itemFieldChanged(target) {
    const item = state.items.find((entry) => entry.id === target.dataset.itemId);
    if (!item) {
        setStatus("找不到要修改的設備，請重新載入。", "error");
        return;
    }
    const name = target.dataset.field;
    const linkedProduct = state.products.find((product) => product.id === item.productId);
    if (linkedProduct && ([
        "unit", "unitPrice", "priceCurrency", "installationUnitPrice",
        "fixtureUnitPrice", "brandModel", "priceSource", "spotlightModel",
        "spotlightQuantity", "spotlightUnitPrice", "spotlightPriceSource",
        "lightWatts", "lightLumens", "beamAngleDeg", "lightSpecSource",
    ].includes(name) || ["widthCm", "depthCm"].includes(name) &&
        linkedProduct[name] != null)) {
        target.value = item[name] ?? "";
        setStatus("此欄位與物件資料庫連動；請到資料庫改價，或先在款式下拉解除連動。", "error");
        return;
    }
    if (name === "quantity" || name === "unitPrice" ||
        name === "installationUnitPrice" || name === "widthCm" ||
        name === "depthCm" || name === "heightCm" ||
        name === "outdoorWidthCm" || name === "outdoorDepthCm" ||
        name === "trackLengthM" ||
        name === "spotlightQuantity" || name === "spotlightUnitPrice" ||
        name === "fixtureUnitPrice" || name === "lightWatts" ||
        name === "lightLumens" || name === "beamAngleDeg") {
        const value = target.value.trim();
        const key = `${item.id}:${name}`;
        const outdoorDimension = name === "outdoorWidthCm" || name === "outdoorDepthCm";
        const dimension = name === "widthCm" || name === "depthCm" ||
            name === "heightCm" || outdoorDimension;
        const trackLength = name === "trackLengthM" || name === "quantity" && isSlideTrack(item);
        const spotCount = name === "spotlightQuantity";
        const lightNumber = ["lightWatts", "lightLumens", "beamAngleDeg"].includes(name);
        const lightMinimum = name === "lightWatts" ? .1 : 1;
        const lightMaximum = name === "lightWatts" ? 1000 :
            name === "lightLumens" ? 200000 : 180;
        if (!target.checkValidity() ||
            (value && (!Number.isFinite(Number(value)) ||
                Number(value) < (dimension ? 0.1 : lightNumber ? lightMinimum :
                    trackLength ? 0.01 : 0) ||
                lightNumber && Number(value) > lightMaximum ||
                spotCount && (!Number.isSafeInteger(Number(value)) || Number(value) > 12))) ||
            spotCount && value === "") {
            invalidInputs.add(key);
            dirty = true;
            clearTimeout(saveTimer);
            setStatus(outdoorDimension
                ? "室外機機身長邊須為 30–250cm、短邊須為 15–150cm，不可留白；目前尚未儲存。" :
                dimension ? "物件尺寸必須大於 0 cm；目前尚未儲存。" :
                lightNumber ? "燈具瓦數、流明或光束角須在標示範圍，或留白待查；目前尚未儲存。" :
                trackLength ? "軌道長度必須在 0.01 至 100 米之間；目前尚未儲存。" :
                    spotCount ? "軌道燈數量必須為 0 至 12 盞的整數；目前尚未儲存。" :
                    "數量與單價必須為非負數；目前尚未儲存。", "error");
            reloadButton.hidden = false;
            return;
        }
        invalidInputs.delete(key);
        item[name] = value === "" ? null : Number(value);
        if (isDownlight(item) &&
            (name === "fixtureUnitPrice" || name === "installationUnitPrice")) {
            if (name === "fixtureUnitPrice" && item.lightSelection !== "custom") {
                setLightChoiceToCustom(item, "lightSelection");
                updateVisibleItemField(item, "priceSource",
                    isQuotedDownlight(item)
                        ? "手動調整燈具價格，實際商品與折抵待確認"
                        : "新增崁燈燈具價由你調整；本體與配線安裝須重新報價");
            }
            item.unitPrice = installedDownlightUnitPrice(
                item.fixtureUnitPrice, item.installationUnitPrice
            );
        } else if (isCeilingLight(item) && name === "unitPrice" &&
            !["custom", "outdoor-custom"].includes(item.lightSelection)) {
            setLightChoiceToCustom(item, "lightSelection");
            updateVisibleItemField(item, "priceSource",
                "手動調整吸頂燈價格，來源待確認");
        } else if (isTrackLighting(item) && name === "unitPrice" &&
            item.trackSelection !== "custom") {
            setLightChoiceToCustom(item, "trackSelection");
            updateVisibleItemField(item, "priceSource",
                "手動調整軌道價格，來源待確認");
        } else if (isTrackLighting(item) && name === "spotlightUnitPrice" &&
            item.spotlightSelection !== "custom") {
            setLightChoiceToCustom(item, "spotlightSelection");
            updateVisibleItemField(item, "spotlightPriceSource",
                "手動調整軌道燈價格，來源待確認");
        }
    } else if (name === "circuitOutletId") {
        const socket = state.items.find((entry) =>
            entry.id === target.value && isSocket(entry) &&
            entry.roomId === item.roomId &&
            !state.items.some((circuit) =>
                circuit.id !== item.id && isDedicatedCircuit(circuit) &&
                    circuit.circuitOutletId === entry.id));
        if (!isDedicatedCircuit(item) || !socket) {
            target.value = item.circuitOutletId ?? "";
            setStatus("請選同房尚未配對的一個一般插座，迴路未改綁。", "error");
            return;
        }
        const previousSocketId = item.circuitOutletId;
        item.circuitOutletId = socket.id;
        const preferred = circuitPlacement(socket.placement);
        const placement = preferred
            ? clampPlacement(item, preferred.x, preferred.y) : null;
        if (preferred && !placement) {
            item.circuitOutletId = previousSocketId;
            target.value = previousSocketId;
            return;
        }
        item.placement = placement;
    } else if (name === "roomId") {
        if (isSocket(item) && state.items.some((entry) =>
            isDedicatedCircuit(entry) && entry.circuitOutletId === item.id)) {
            target.value = item.roomId;
            setStatus("此插座已配專用迴路，請先改綁迴路或使用「移至別房」一起移動。", "error");
            return;
        }
        if (item.roomId !== target.value && (item.placement || item.orientation !== null) &&
            !window.confirm(`移動「${item.name}」到其他房間會清除原圖面位置和出風方向，確定嗎？`)) {
            target.value = item.roomId;
            return;
        }
        if (item.roomId !== target.value) {
            item.placement = null;
            item.orientation = null;
        }
        item.roomId = target.value;
    } else {
        const previousValue = item[name];
        item[name] = target.value;
        const selector = name === "spotlightModel" && isTrackLighting(item)
            ? "spotlightSelection" : name === "brandModel" &&
            (isDownlight(item) || isCeilingLight(item))
                ? "lightSelection" : name === "brandModel" && isTrackLighting(item)
                    ? "trackSelection" : null;
        if (selector && !["custom", "outdoor-custom"].includes(item[selector])) {
            setLightChoiceToCustom(item, selector);
            if (selector === "spotlightSelection") {
                updateVisibleItemField(item, "spotlightPriceSource",
                    "自訂軌道燈型號，請核對價格來源");
            } else {
                updateVisibleItemField(item, "priceSource",
                    "自訂燈具或軌道型號，請核對價格來源");
            }
        }
        if (target.value !== previousValue &&
            (name === "brandModel" && (isDownlight(item) || isCeilingLight(item)) ||
                name === "spotlightModel" && isTrackLighting(item))) {
            clearLightSpecifications(item);
        }
        if (name === "name") {
            const heading = content.querySelector(`[data-item-name="${item.id}"]`);
            if (heading && !(view === "device" && isDedicatedCircuit(item))) {
                heading.textContent = view === "device" && isSocket(item)
                    ? socketListName(item) : item.name || "未命名設備";
            }
            if (view === "device" && isSocket(item)) {
                for (const label of content.querySelectorAll("[data-paired-socket-id]")) {
                    if (label.dataset.pairedSocketId === item.id) {
                        label.textContent = `專用迴路${label.dataset.circuitNumber}－${socketListName(item)}`;
                    }
                }
            }
        }
    }
    if (["lightWatts", "lightLumens", "beamAngleDeg", "lightSpecSource"]
        .includes(name) || name === "brandModel" && (isDownlight(item) || isCeilingLight(item)) ||
        name === "spotlightModel" && isTrackLighting(item)) {
        for (const note of content.querySelectorAll(`[data-light-spec-id="${item.id}"]`)) {
            note.textContent = lightSpecificationNote(item);
        }
    }
    scheduleSave(["INPUT", "TEXTAREA"].includes(target.tagName)
        ? `item:${item.id}:${name}` : null);
    if (item.lightType && ["lightWatts", "lightLumens", "beamAngleDeg",
        "lightSpecSource", "brandModel", "spotlightModel"].includes(name)) {
        refreshLightLabels(item.roomId);
        refreshLightingPreview();
    }
    if (name === "quantity" || name === "unitPrice" ||
        name === "installationUnitPrice" || name === "priceCurrency" ||
        name === "trackLengthM" || name === "spotlightQuantity" ||
        name === "spotlightUnitPrice" || name === "fixtureUnitPrice") renderTotals();
}

function setLightChoiceToCustom(item, field) {
    const customCode = field === "lightSelection" && isCeilingLight(item) &&
        item.roomId === "balcony" ? "outdoor-custom" : "custom";
    item[field] = customCode;
    for (const select of content.querySelectorAll(
        `[data-item-id="${item.id}"][data-field="${field}"]`
    )) select.value = customCode;
}

function updateVisibleItemField(item, field, value) {
    item[field] = value;
    for (const input of content.querySelectorAll(
        `[data-item-id="${item.id}"][data-field="${field}"]`
    )) input.value = value ?? "";
}

function clearLightSpecifications(item) {
    updateVisibleItemField(item, "lightWatts", null);
    updateVisibleItemField(item, "lightLumens", null);
    updateVisibleItemField(item, "beamAngleDeg", null);
    updateVisibleItemField(item, "lightSpecSource", "");
}

function clearDraftLightSpecifications(draft, attribute) {
    for (const field of ["lightWatts", "lightLumens", "beamAngleDeg", "lightSpecSource"]) {
        draft[field] = "";
        for (const input of content.querySelectorAll(`[${attribute}="${field}"]`)) {
            input.value = "";
        }
    }
}

function selectedLightPriceSource(item, source) {
    if (item.markerStyle !== "square-label") return source;
    return `新增商品試算，未占用原報額度；${source || "商品單價待補"}`;
}

function changeDoorMaterial(target) {
    const item = state.items.find((entry) => entry.id === target.dataset.itemId);
    const option = DOOR_OPTIONS[target.value];
    if (!item || item.kind !== "door" || !option) {
        setStatus("找不到可切換的報價門片材質。", "error");
        return;
    }
    item.doorMaterial = target.value;
    item.brandModel = option.label;
    if (option.opening === "slide") item.doorOpeningKind = "slide";
    item.unitPrice = option.unitPrice;
    item.priceSource = isShowerDoor(item)
        ? option.unitPrice === null
            ? "自訂玻璃門型（額外價差待報；原玻璃與防爆膜已列於設備）"
            : "原報價｜門片工程（乾濕分離與防爆膜費用另列設備）"
        : option.unitPrice === null
            ? "自訂門片材質（價格待報）"
            : "原報價門片單價（跨材質試算，待廠商確認）";
    scheduleSave();
    render();
}

function changePartitionMaterial(target) {
    const item = state.items.find((entry) => entry.id === target.dataset.itemId);
    const option = BEDROOM2_PARTITION_OPTIONS[target.value];
    if (!item || item.id !== BEDROOM2_PARTITION_ID || !option) {
        setStatus("找不到臥室2輕隔間或所選做法，未修改報價。", "error");
        return;
    }
    if (invalidInputs.size) {
        target.value = item.partitionMaterial;
        setStatus("請先修正無效數字，再切換隔間做法。", "error");
        return;
    }
    item.partitionMaterial = target.value;
    item.brandModel = option.specification;
    item.unitPrice = option.unitPrice;
    item.priceSource = target.value === "double-double"
        ? "原報價｜輕隔間工程"
        : "原報價｜輕隔間工程（替代單價原表未填數量，依臥室2合計坪數暫估）";
    scheduleSave();
    render();
}

function changeSwitchType(target) {
    const item = state.items.find((entry) => entry.id === target.dataset.itemId);
    const option = item && switchOptionFor({
        switchType: target.value,
        switchEnvironment: item.switchEnvironment,
    });
    if (!item || !isSwitch(item) || !option) {
        setStatus("找不到單／雙開關或所選型式，未修改清單。", "error");
        return;
    }
    if (invalidInputs.size) {
        target.value = item.switchType;
        setStatus("請先修正無效數字，再切換開關型式。", "error");
        return;
    }
    item.switchType = target.value;
    item.brandModel = option.brandModel;
    if (!isQuotedSwitch(item) && [
        "新增單開關", "新增雙開關", "新增戶外單開關", "新增戶外雙開關",
    ].includes(item.name)) {
        item.name = `新增${option.label}`;
    }
    scheduleSave();
    render();
}

function changeItemProduct(target) {
    const item = state.items.find((entry) => entry.id === target.dataset.itemProductId);
    if (!item || invalidInputs.size || conflicted) {
        setStatus("找不到物件，或尚有無效欄位／版本衝突；未切換資料庫款式。", "error");
        return;
    }
    if (!target.value) {
        item.productId = null;
        scheduleSave();
        if (view === "plan") renderPlanChange();
        else render();
        setStatus("已解除資料庫售價連動，目前型號與規劃價保留，可個別編輯。");
        return;
    }
    const product = state.products.find((entry) => entry.id === target.value);
    if (!product) {
        target.value = item.productId ?? "";
        setStatus("找不到選擇的資料庫款式，請重新載入。", "error");
        return;
    }
    try {
        Object.assign(item, applyProductToItem(product, item));
    } catch (error) {
        if (!(error instanceof RangeError)) throw error;
        target.value = item.productId ?? "";
        setStatus(error.message, "error");
        return;
    }
    scheduleSave();
    if (view === "plan") renderPlanChange();
    else render();
    setStatus("已切換資料庫款式與規劃售價；原 PDF 的報價基準未變。");
}

function changeLightSelection(target) {
    const item = state.items.find((entry) => entry.id === target.dataset.itemId);
    const downlight = item && isDownlight(item);
    const ceiling = item && isCeilingLight(item);
    const options = downlight ? DOWNLIGHT_OPTIONS : CEILING_LIGHT_OPTIONS;
    const option = options[target.value];
    const outdoorOption = ["outdoor-pending", "outdoor-custom"]
        .includes(target.value);
    if (!item || !(downlight || ceiling) || !option ||
        ceiling && (item.roomId === "balcony") !== outdoorOption) {
        setStatus("找不到可切換的崁燈或吸頂燈選項。", "error");
        return;
    }
    if (invalidInputs.size) {
        target.value = item.lightSelection ?? "";
        setStatus("請先修正無效數字，再切換燈具。", "error");
        return;
    }
    item.lightSelection = target.value;
    item.brandModel = option.model;
    item.priceSource = selectedLightPriceSource(item, option.source);
    clearLightSpecifications(item);
    item.lightWatts = option.wattageW;
    if (downlight) {
        item.fixtureUnitPrice = option.unitPrice;
        item.unitPrice = installedDownlightUnitPrice(
            item.fixtureUnitPrice, item.installationUnitPrice
        );
    } else {
        item.unitPrice = option.unitPrice;
        item.priceCurrency = "TWD";
    }
    scheduleSave();
    render();
}

function changeTrackLightSelection(target) {
    const item = state.items.find((entry) => entry.id === target.dataset.itemId);
    const rail = target.dataset.field === "trackSelection";
    const option = (rail ? TRACK_RAIL_OPTIONS : TRACK_SPOTLIGHT_OPTIONS)[target.value];
    if (!item || !isTrackLighting(item) || !option) {
        setStatus("找不到可切換的軌道或軌道燈選項。", "error");
        return;
    }
    if (invalidInputs.size) {
        target.value = item[target.dataset.field] ?? "";
        setStatus("請先修正無效數字，再切換軌道燈具。", "error");
        return;
    }
    item[target.dataset.field] = target.value;
    if (rail) {
        item.brandModel = option.model;
        item.unitPrice = option.unitPrice;
        item.priceSource = selectedLightPriceSource(item, option.source);
    } else {
        item.spotlightModel = option.model;
        item.spotlightUnitPrice = option.unitPrice;
        item.spotlightPriceSource = selectedLightPriceSource(item, option.source);
        clearLightSpecifications(item);
        item.lightWatts = option.wattageW;
    }
    scheduleSave();
    render();
}

content.addEventListener("input", (event) => {
    const productField = event.target.closest("[data-product-field]");
    if (productField && pendingProduct) {
        const name = productField.dataset.productField;
        if (pendingProduct[name] !== productField.value &&
            (name === "brandModel" && ["ceiling", "recessed"].includes(pendingProduct.type) ||
                name === "spotlightModel" && pendingProduct.type === "track")) {
            clearDraftLightSpecifications(pendingProduct, "data-product-field");
        }
        pendingProduct[name] = productField.value;
        return;
    }
    const addField = event.target.closest("[data-add-field]");
    if (addField && pendingNewItem) {
        const name = addField.dataset.addField;
        if (pendingNewItem[name] !== addField.value &&
            (name === "model" && ["ceiling", "recessed"]
                .includes(pendingNewItem.productType) ||
                name === "spotlightModel" && pendingNewItem.productType === "track")) {
            clearDraftLightSpecifications(pendingNewItem, "data-add-field");
        }
        pendingNewItem[name] = addField.value;
        return;
    }
    const dimensionInput = event.target.closest("[data-room-dimension]");
    if (dimensionInput) {
        const room = state.rooms.find((entry) => entry.id === dimensionInput.dataset.roomId);
        if (!room) {
            setStatus("找不到此房間，請重新載入。", "error");
            return;
        }
        const value = dimensionInput.value.trim();
        const key = `room:${room.id}:${dimensionInput.dataset.roomDimension}`;
        const ceiling = dimensionInput.dataset.roomDimension === "ceilingHeightCm";
        if (!dimensionInput.checkValidity() ||
            (value && (!Number.isFinite(Number(value)) ||
                Number(value) < (ceiling ? 180 : 1) ||
                ceiling && Number(value) > 600))) {
            invalidInputs.add(key);
            dirty = true;
            clearTimeout(saveTimer);
            setStatus(ceiling
                ? "天花至地板高度須在 180–600cm，或留白待量；目前尚未儲存。"
                : "房間尺寸必須大於 0 cm；目前尚未儲存。", "error");
            return;
        }
        invalidInputs.delete(key);
        room[dimensionInput.dataset.roomDimension] = value === "" ? null : Number(value);
        if (!ceiling) room.dimensionStatus = room.widthCm && room.depthCm ? "user" : null;
        scheduleSave(`room:${room.id}:${dimensionInput.dataset.roomDimension}`);
        if (ceiling) {
            refreshLightLabels(room.id);
            refreshLightingPreview();
        }
        return;
    }
    const target = event.target.closest("[data-item-id][data-field]");
    if (target && !["roomId", "priceCurrency", "doorMaterial", "doorOpeningKind",
        "partitionMaterial", "switchType", "lightSelection", "trackSelection",
        "spotlightSelection"]
        .includes(target.dataset.field)) {
        itemFieldChanged(target);
    }
});

content.addEventListener("focusout", (event) => {
    if (event.target.closest("[data-item-id][data-field], [data-room-dimension]")) {
        inputGroupKey = null;
        inputGroupBefore = null;
    }
}, true);

content.addEventListener("toggle", (event) => {
    if (event.target.matches("details.grouped-device-group") &&
        event.target.isConnected) {
        if (event.target.open) openDeviceGroups.add(event.target.dataset.deviceGroup);
        else openDeviceGroups.delete(event.target.dataset.deviceGroup);
        return;
    }
    if (event.target.matches("details.door-choices")) {
        if (event.target.open) openDoorRooms.add(event.target.dataset.roomId);
        else openDoorRooms.delete(event.target.dataset.roomId);
        return;
    }
    if (!event.target.matches("details.equipment")) return;
    if (event.target.open) expandedItems.add(event.target.dataset.id);
    else expandedItems.delete(event.target.dataset.id);
}, true);

content.addEventListener("change", (event) => {
    if (pendingProduct) {
        const productType = event.target.closest("[data-product-type]");
        if (productType) {
            pendingProduct.type = productType.value;
            Object.assign(pendingProduct, {
                lightWatts: "", lightLumens: "", beamAngleDeg: "", lightSpecSource: "",
            });
            pendingProduct.unit = productUnit(productType.value);
            if (productType.value !== "equipment" &&
                pendingProduct.environment === "any" ||
                ["recessed", "track"].includes(productType.value) &&
                    pendingProduct.environment === "balcony") {
                pendingProduct.environment = "indoor";
            }
            if (!["equipment", "ceiling"].includes(productType.value)) {
                pendingProduct.priceCurrency = "TWD";
            }
            render();
            content.querySelector('[data-product-field="name"]')?.focus();
            return;
        }
        const environment = event.target.closest("[data-product-environment]");
        if (environment) {
            pendingProduct.environment = environment.value;
            render();
            content.querySelector('[data-product-field="brandModel"]')?.focus();
            return;
        }
        const productField = event.target.closest("[data-product-field]");
        if (productField) {
            pendingProduct[productField.dataset.productField] = productField.value;
            return;
        }
    }
    if (pendingNewItem) {
        const room = event.target.closest("[data-add-room]");
        if (room) {
            pendingNewItem.roomId = room.value;
            pendingNewItem.templateId = "";
            pendingNewItem.circuitOutletId = "";
            if (room.value === "ac-platform" &&
                pendingNewItem.productType !== "equipment" ||
                room.value === "balcony" &&
                    ["recessed", "track"].includes(pendingNewItem.productType)) {
                pendingNewItem.productType = "";
            }
            render();
            content.querySelector("[data-add-product-type]")?.focus();
            return;
        }
        const productType = event.target.closest("[data-add-product-type]");
        if (productType) {
            pendingNewItem.productType = productType.value;
            Object.assign(pendingNewItem, {
                lightWatts: "", lightLumens: "", beamAngleDeg: "", lightSpecSource: "",
            });
            pendingNewItem.unit = productUnit(productType.value);
            pendingNewItem.templateId = "";
            pendingNewItem.circuitOutletId = "";
            pendingNewItem.unitPrice = productType.value === "outlet-general"
                ? String(SOCKET_UNIT_PRICE_TWD) :
                productType.value === "dedicated-circuit"
                    ? String(DEDICATED_CIRCUIT_UNIT_PRICE_TWD) : "";
            render();
            content.querySelector("[data-add-template]")?.focus();
            return;
        }
        const template = event.target.closest("[data-add-template]");
        if (template) {
            pendingNewItem.templateId = template.value;
            render();
            content.querySelector(template.value === "custom" ?
                '[data-add-field="name"]' : "[data-add-template]")?.focus();
            return;
        }
        const circuitOutlet = event.target.closest("[data-add-circuit-outlet-id]");
        if (circuitOutlet) {
            pendingNewItem.circuitOutletId = circuitOutlet.value;
            return;
        }
        const addField = event.target.closest("[data-add-field]");
        if (addField) {
            pendingNewItem[addField.dataset.addField] = addField.value;
            return;
        }
    }
    if (event.target.closest("[data-room-dimension]")) {
        if (!invalidInputs.size &&
            event.target.dataset.roomDimension !== "ceilingHeightCm") render();
        return;
    }
    const lightPlane = event.target.closest("[data-light-plane]");
    if (lightPlane) {
        const height = Number(lightPlane.value);
        if (!Object.values(LIGHT_PREVIEW_PLANES_CM).includes(height)) {
            setStatus("請選地板或 80cm 桌面評估平面。", "error");
            return;
        }
        lightingPlaneCm = height;
        renderPlanChange();
        return;
    }
    const zoom = event.target.closest("[data-survey-zoom]");
    if (zoom) {
        if (!["fit", "1", "1.5"].includes(zoom.value)) {
            setStatus("不支援的現況圖縮放比例。", "error");
            return;
        }
        survey.zoom = zoom.value;
        renderSurveyAtSameCenter();
        return;
    }
    const roomSelect = event.target.closest("[data-plan-room-select]");
    if (roomSelect) {
        selectPlanRoom(roomSelect.value);
        return;
    }
    const outdoorWindow = event.target.closest("[data-outdoor-ac-window]");
    if (outdoorWindow) {
        changeOutdoorWindow(outdoorWindow);
        return;
    }
    const itemSelect = event.target.closest("[data-plan-item-select]");
    if (itemSelect) {
        selectedPlanItemId = itemSelect.value;
        rotateHandleHidden = false;
        pendingDeleteId = null;
        pendingMoveOutletId = null;
        render();
        return;
    }
    const itemProductSelect = event.target.closest("[data-item-product-id]");
    if (itemProductSelect) {
        changeItemProduct(itemProductSelect);
        return;
    }
    const target = event.target.closest("[data-item-id][data-field]");
    if (!target) return;
    if (target.dataset.field === "circuitOutletId") {
        const previousId = state.items.find((entry) =>
            entry.id === target.dataset.itemId)?.circuitOutletId;
        itemFieldChanged(target);
        render();
        if (state.items.find((entry) =>
            entry.id === target.dataset.itemId)?.circuitOutletId !== previousId) {
            setStatus("已暫改綁專用迴路；高負載共線可能跳電，配電容量與保護開關須電工核對。正在儲存。");
        }
        return;
    }
    const editedItem = state.items.find((entry) => entry.id === target.dataset.itemId);
    if (editedItem?.productId && ["switchType", "lightSelection", "trackSelection",
        "spotlightSelection"].includes(target.dataset.field)) {
        target.value = editedItem[target.dataset.field] ?? "";
        setStatus("此物件的選款與資料庫連動；請使用「物件資料庫款式」下拉切換。", "error");
        return;
    }
    if (target.dataset.field === "spotlightQuantity" ||
        ["outdoorWidthCm", "outdoorDepthCm"].includes(target.dataset.field)) {
        if (!invalidInputs.size) {
            if (view === "plan") renderPlanChange();
            else render();
        }
        return;
    }
    if (editedItem?.kind === "door" && ["widthCm", "heightCm"].includes(target.dataset.field)) {
        if (!invalidInputs.size) render();
        return;
    }
    if (target.dataset.field === "doorMaterial") return changeDoorMaterial(target);
    if (target.dataset.field === "partitionMaterial") return changePartitionMaterial(target);
    if (target.dataset.field === "switchType") return changeSwitchType(target);
    if (target.dataset.field === "lightSelection") return changeLightSelection(target);
    if (["trackSelection", "spotlightSelection"].includes(target.dataset.field)) {
        return changeTrackLightSelection(target);
    }
    if (target.dataset.field === "doorOpeningKind") {
        itemFieldChanged(target);
        render();
        return;
    }
    if (target.dataset.field === "priceCurrency") {
        if (!Object.hasOwn(currencySymbols, target.value)) {
            setStatus("無效的價格幣別，請重新選擇。", "error");
            return;
        }
        itemFieldChanged(target);
        return;
    }
    if (target.dataset.field === "roomId") {
        if (invalidInputs.size) {
            setStatus("請先修正無效數字，再變更房間。", "error");
            const item = state.items.find((entry) => entry.id === target.dataset.itemId);
            if (item) target.value = item.roomId;
            return;
        }
        itemFieldChanged(target);
        render();
        return;
    }
    if (target.dataset.field === "name" && view === "plan" && !invalidInputs.size) {
        renderPlanChange();
    }
});

content.addEventListener("submit", (event) => {
    if (event.target.matches("#new-equipment-form")) {
        event.preventDefault();
        confirmNewItem(event.target);
    } else if (event.target.matches("#product-form")) {
        event.preventDefault();
        saveProductForm(event.target);
    }
});

content.addEventListener("invalid", (event) => {
    if (event.target.closest("#new-equipment-form")) {
        setStatus("請選房間與商品，填寫自訂名稱，並修正空白或負數欄位；尚未新增設備。", "error");
    } else if (event.target.closest("#product-form")) {
        setStatus("請先填寫商品種類、名稱與規格，並修正負數或空白必填欄位；未儲存商品。", "error");
    }
}, true);

const objectTransferType = "application/x-renovation-object";
content.addEventListener("dragstart", (event) => {
    const source = event.target.closest("[data-furniture-template], [data-existing-item-id]");
    if (!source || !event.dataTransfer) return;
    const data = source.dataset.furnitureTemplate
        ? { kind: "template", type: source.dataset.furnitureTemplate }
        : { kind: "existing", id: source.dataset.existingItemId };
    event.dataTransfer.setData(objectTransferType, JSON.stringify(data));
    event.dataTransfer.effectAllowed = "copy";
});

content.addEventListener("dragover", (event) => {
    const diagram = event.target.closest("[data-room-canvas]");
    if (!diagram || !Array.from(event.dataTransfer?.types ?? []).includes(objectTransferType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    diagram.classList.add("drop-target");
});

content.addEventListener("drop", (event) => {
    const diagram = event.target.closest("[data-room-canvas]");
    if (!diagram || !Array.from(event.dataTransfer?.types ?? []).includes(objectTransferType)) return;
    event.preventDefault();
    diagram.classList.remove("drop-target");
    const position = roomPoint(diagram, event);
    if (!position) return;
    let data;
    try {
        data = JSON.parse(event.dataTransfer.getData(objectTransferType));
    } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        setStatus("拖曳資料格式不正確，未放置物件。", "error");
        return;
    }
    if (data?.kind === "template") addFurniture(data.type, position);
    else if (data?.kind === "existing") placeExistingItem(data.id, position);
    else setStatus("不認得這個拖曳物件，未放置。", "error");
});

content.addEventListener("dragend", () => {
    content.querySelector("[data-room-canvas].drop-target")?.classList.remove("drop-target");
});

content.addEventListener("pointerdown", (event) => {
    if (event.target.closest('[data-action="rotate-outdoor-ac"]')) return;
    const outdoor = event.target.closest(".detail-outdoor-ac[data-outdoor-id]");
    if (outdoor && (event.pointerType !== "mouse" || event.button === 0)) {
        const svg = outdoor.closest("[data-room-canvas]");
        const item = state?.items.find((entry) => entry.id === outdoor.dataset.outdoorId);
        if (!svg || !item || !isActiveSplitAirConditioner(item) ||
            !item.outdoorPlacement || typeof svg.setPointerCapture !== "function") {
            setStatus("室外機圖示未連結到可編輯的冷氣配置，請重新載入。", "error");
            return;
        }
        outdoorDrag = {
            pointerId: event.pointerId,
            itemId: item.id,
            marker: outdoor,
            svg,
            startX: event.clientX,
            startY: event.clientY,
            original: {
                outdoorZoneId: item.outdoorZoneId,
                outdoorPlacement: { ...item.outdoorPlacement },
            },
            moved: false,
        };
        svg.setPointerCapture(event.pointerId);
        return;
    }
    const marker = event.target.closest(".room-marker");
    if (!marker || outdoorDrag || (event.pointerType === "mouse" && event.button !== 0)) return;
    const svg = marker.closest("[data-room-canvas]");
    const item = state?.items.find((entry) => entry.id === marker.dataset.markerId);
    if (lightingPreview && (item?.switchType || item?.lightType)) return;
    if (!svg || !item?.placement || item.roomId !== planRoomId ||
        typeof svg.setPointerCapture !== "function") return;
    const anchor = marker.closest(".placed-item");
    if (!anchor) {
        setStatus("圖上物件無法拖曳，請重新載入。", "error");
        return;
    }
    furnitureDrag = {
        pointerId: event.pointerId,
        itemId: item.id,
        anchor,
        svg,
        startX: event.clientX,
        startY: event.clientY,
        original: { ...item.placement },
        moved: false,
    };
    svg.setPointerCapture(event.pointerId);
});

content.addEventListener("pointermove", (event) => {
    const outside = outdoorDrag;
    if (outside && outside.pointerId === event.pointerId) {
        if (!outside.moved &&
            Math.hypot(event.clientX - outside.startX, event.clientY - outside.startY) < 4) return;
        const point = diagramWorldPoint(outside.svg, event);
        const item = state.items.find((entry) => entry.id === outside.itemId);
        if (!point || !item) return;
        const placement = clampOutdoorPlacement(item, point);
        if (!placement) return;
        item.outdoorZoneId = placement.outdoorZoneId;
        item.outdoorPlacement = placement.placement;
        const center = outdoorACPosition(item);
        outside.marker.setAttribute("transform", `translate(${center.x} ${center.y})`);
        outside.moved = true;
        event.preventDefault();
        return;
    }
    const drag = furnitureDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved && Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 4) return;
    const position = roomPoint(drag.svg, event, true);
    const item = state.items.find((entry) => entry.id === drag.itemId);
    if (!position || !item) return;
    const placement = clampPlacement(item, position.x, position.y);
    if (!placement) return;
    item.placement = placement;
    const geometry = roomGeometry(state.rooms.find((room) => room.id === item.roomId));
    const center = markerPosition(item, geometry);
    drag.anchor.setAttribute("transform", `translate(${center.x} ${center.y})`);
    drag.moved = true;
    event.preventDefault();
});

function finishFurnitureDrag(event, cancelled) {
    const drag = furnitureDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    furnitureDrag = null;
    if (drag.svg.hasPointerCapture(event.pointerId)) drag.svg.releasePointerCapture(event.pointerId);
    if (!drag.moved) {
        if (!cancelled) {
            selectedPlanItemId = drag.itemId;
            rotateHandleHidden = false;
            render();
            suppressClick = true;
            setTimeout(() => { suppressClick = false; }, 0);
        }
        return;
    }
    const item = state.items.find((entry) => entry.id === drag.itemId);
    if (!item) {
        setStatus("拖曳的家具已不存在，請重新載入。", "error");
        return;
    }
    if (cancelled) {
        item.placement = drag.original;
        setStatus("已取消家具拖曳。");
    } else {
        selectedPlanItemId = item.id;
        rotateHandleHidden = true;
        scheduleSave();
        suppressClick = true;
        setTimeout(() => { suppressClick = false; }, 0);
    }
    render();
}

function finishOutdoorDrag(event, cancelled) {
    const drag = outdoorDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    outdoorDrag = null;
    if (drag.svg.hasPointerCapture(event.pointerId)) drag.svg.releasePointerCapture(event.pointerId);
    const item = state.items.find((entry) => entry.id === drag.itemId);
    if (!item) {
        setStatus("拖曳的室外機圖示已不存在，請重新載入。", "error");
        return;
    }
    if (cancelled) {
        item.outdoorZoneId = drag.original.outdoorZoneId;
        item.outdoorPlacement = drag.original.outdoorPlacement;
        render();
        setStatus("已取消室外機暫位拖曳。");
        return;
    }
    if (drag.moved) {
        rotateHandleHidden = true;
        scheduleSave();
        render();
    } else {
        selectPlanRoom(item.roomId, item.id);
    }
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
}

content.addEventListener("pointerup", (event) => {
    finishOutdoorDrag(event, false);
    finishFurnitureDrag(event, false);
});
content.addEventListener("pointercancel", (event) => {
    finishOutdoorDrag(event, true);
    finishFurnitureDrag(event, true);
});

function focusBedroom2Partition() {
    if (invalidInputs.size) {
        setStatus("請先修正無效數字，再切換到輕隔間設定。", "error");
        return;
    }
    if (!state.items.some((item) => item.id === BEDROOM2_PARTITION_ID)) {
        setStatus("臥室2輕隔間報價明細尚未載入，請重新載入清單。", "error");
        return;
    }
    if (planRoomId !== "bedroom-2") selectPlanRoom("bedroom-2");
    const select = content.querySelector('select[data-field="partitionMaterial"]');
    if (!select) {
        setStatus("找不到臥室2輕隔間設定，請重新載入。", "error");
        return;
    }
    select.focus();
}

content.addEventListener("click", (event) => {
    if (suppressClick) {
        suppressClick = false;
        event.preventDefault();
        return;
    }
    const button = event.target.closest("[data-action]");
    if (!state) return;
    if (button) {
        const { action, roomId, itemId } = button.dataset;
        if (action === "toggle-plan-layer") {
            const layer = button.dataset.layer;
            if (!Object.hasOwn(visiblePlanLayers, layer)) {
                setStatus("找不到這個格局圖圖例分類。", "error");
                return;
            }
            visiblePlanLayers[layer] = !visiblePlanLayers[layer];
            renderPlanChange();
            return;
        }
        if (action === "toggle-light-preview") {
            toggleLightSimulation();
            return;
        }
        if (action === "toggle-all-lights") {
            toggleAllPreviewLights();
            return;
        }
        if (action === "survey-grid") survey.grid = !survey.grid;
        if (action === "survey-windows") survey.windows = !survey.windows;
        if (action === "survey-doors") survey.doors = !survey.doors;
        if (action === "survey-exterior-rail") survey.exteriorRail = !survey.exteriorRail;
        if (action.startsWith("survey-")) {
            renderSurveyAtSameCenter();
            return;
        }
        if (action === "choose-object") {
            const type = button.dataset.furnitureTemplate;
            const id = button.dataset.existingItemId;
            if (type && !Object.hasOwn(FURNITURE_TEMPLATES, type)) {
                setStatus("這種家具不在新增家具範本中。", "error");
                return;
            }
            if (id && !state.items.some((item) => item.id === id && item.roomId === planRoomId &&
                isPlaceableItem(item))) {
                setStatus("這項設備不在目前房間。", "error");
                return;
            }
            const choice = type ? { kind: "template", type } : { kind: "existing", id };
            const repeated = pendingObject?.kind === choice.kind &&
                (choice.kind === "template" ? pendingObject.type === type : pendingObject.id === id);
            pendingObject = repeated ? null : choice;
            for (const entry of content.querySelectorAll("[data-furniture-template], [data-existing-item-id]")) {
                const pressed = pendingObject?.kind === "template"
                    ? entry.dataset.furnitureTemplate === pendingObject.type
                    : pendingObject?.kind === "existing" &&
                        entry.dataset.existingItemId === pendingObject.id;
                entry.setAttribute("aria-pressed", String(pressed));
            }
            const name = type ? FURNITURE_TEMPLATES[type].name
                : state.items.find((item) => item.id === id)?.name;
            setStatus(pendingObject ? `已選「${name}」，請點房間內放置。` : "已取消物件放置。");
            return;
        }
        if (action === "toggle-plan-source") {
            showSourceOverlay = !showSourceOverlay;
            render();
            return;
        }
        if (action === "go-product-database") {
            view = "database";
            render();
            setStatus("先在物件資料庫新增款式；完成後可返回正在新增的設備。");
            return;
        }
        if (action === "return-to-new-item") {
            if (!pendingNewItem) {
                setStatus("目前沒有正在新增的設備。", "error");
                return;
            }
            view = newItemOriginView ?? "room";
            render();
            content.querySelector("[data-add-template]")?.focus();
            return;
        }
        if (action === "add-product") {
            openProductForm();
            return;
        }
        if (action === "edit-product") {
            openProductForm(button.dataset.productId);
            return;
        }
        if (action === "cancel-product-form") {
            pendingProduct = null;
            render();
            setStatus("已取消編輯，商品與已連動物件的價格未變更。");
            void refreshIfClean();
            return;
        }
        if (action === "request-remove-product") {
            requestRemoveProduct(button.dataset.productId);
            return;
        }
        if (action === "confirm-remove-product") {
            confirmRemoveProduct(button.dataset.productId);
            return;
        }
        if (action === "cancel-remove-product") {
            pendingProductDeleteId = null;
            render();
            setStatus("已取消刪除資料庫商品。");
            return;
        }
        if (action === "add-item") openNewItem(roomId);
        if (action === "add-socket") openNewItem(roomId, "outlet-general");
        if (action === "add-dedicated-circuit") {
            openNewItem(roomId, "dedicated-circuit");
        }
        if (action === "cancel-new-item") {
            pendingNewItem = null;
            newItemOriginView = null;
            render();
            setStatus("已取消新增，設備與報價未變更。");
        }
        if (action === "add-switch") addSwitch(roomId);
        if (action === "request-remove-item" || action === "remove-item") {
            event.preventDefault();
            requestRemoveItem(itemId);
        }
        if (action === "request-move-outlet") {
            event.preventDefault();
            requestMoveQuotedOutlet(itemId);
        }
        if (action === "show-paired-circuit") {
            const paired = state.items.find((entry) =>
                entry.id === itemId && isDedicatedCircuit(entry));
            if (!paired) setStatus("找不到配對的專用迴路，請重新載入。", "error");
            else selectPlanRoom(paired.roomId, paired.id);
            return;
        }
        if (action === "restore-switch") {
            event.preventDefault();
            restoreSwitch(itemId);
        }
        if (action === "confirm-remove-item") confirmRemoveItem(itemId);
        if (action === "confirm-move-quoted-outlet") {
            const target = button.closest(".delete-confirmation")
                ?.querySelector("[data-outlet-move-target]")?.value;
            confirmMoveQuotedOutlet(itemId, target);
        }
        if (action === "cancel-remove-item") cancelRemoveItem();
        if (action === "cancel-move-outlet") {
            pendingMoveOutletId = null;
            render();
            setStatus("已取消移轉，插座及迴路未變更。");
        }
        if (action === "rename-room") renameRoom(roomId);
        if (action === "remove-room") removeRoom(roomId);
        if (action === "restore-split-ac") restoreSplitAC(itemId);
        if (action === "place-item") {
            if (invalidInputs.size) {
                setStatus("請先修正無效數字，再切換到格局圖。", "error");
                return;
            }
            const item = state.items.find((entry) => entry.id === itemId);
            if (item) selectPlanRoom(item.roomId, item.id);
        }
        if (action === "select-plan-room") selectPlanRoom(roomId);
        if (action === "all-rooms") {
            planRoomId = null;
            selectedPlanItemId = null;
            rotateHandleHidden = false;
            pendingDeleteId = null;
            pendingMoveOutletId = null;
            render();
        }
        if (action === "finish-rotation") {
            finishRotation();
            return;
        }
        if (action === "rotate-marker") rotateItem(itemId);
        if (action === "rotate-outdoor-ac") rotateOutdoorUnit(itemId);
        if (action === "clear-placement") {
            const item = state.items.find((entry) => entry.id === selectedPlanItemId);
            if (isQuotedOutlet(item)) {
                setStatus("原報插座仍需標位；要減少數量請按「刪除」，或拖曳改位置。", "error");
                return;
            }
            if (isSocket(item) && state.items.some((entry) =>
                isDedicatedCircuit(entry) && entry.circuitOutletId === item.id)) {
                setStatus("此插座綁定專用迴路；請先改綁或刪除迴路再清除標位。", "error");
                return;
            }
            if (item && item.roomId === planRoomId) {
                item.placement = null;
                scheduleSave();
                render();
            }
        }
        if (action === "remove-plan-item" && selectedPlanItemId) requestRemoveItem(selectedPlanItemId);
        if (action === "add-plan-item") {
            openNewItem(planRoomId);
        }
        return;
    }
    if (event.target.closest("[data-select-partition]")) {
        focusBedroom2Partition();
        return;
    }
    const outdoor = event.target.closest("[data-outdoor-id]");
    if (outdoor) {
        const item = state.items.find((entry) => entry.id === outdoor.dataset.outdoorId);
        if (!item) setStatus("找不到此室外機對應的分離式冷氣。", "error");
        else selectPlanRoom(item.roomId, item.id);
        return;
    }
    const previewMarker = event.target.closest("[data-preview-item-id], [data-marker-id]");
    if (lightingPreview && previewMarker) {
        const previewItemId = previewMarker.dataset.previewItemId ??
            previewMarker.dataset.markerId;
        const previewItem = state.items.find((entry) => entry.id === previewItemId);
        if (previewItem?.switchType || previewItem?.lightType) {
            togglePreviewMarker(previewItemId);
            return;
        }
    }
    const zone = event.target.closest("[data-select-room]");
    if (zone) {
        selectPlanRoom(zone.dataset.selectRoom);
        return;
    }
    const marker = event.target.closest("[data-marker-id]");
    if (marker) {
        if (pendingObject) {
            setStatus("請點房間空白處放置物件，或拖到預定位置。", "error");
            return;
        }
        selectedPlanItemId = marker.dataset.markerId;
        rotateHandleHidden = false;
        render();
        return;
    }
    const diagram = event.target.closest("[data-room-canvas]");
    if (diagram) placeOnRoomDiagram(diagram, event);
});

content.addEventListener("toggle", (event) => {
    if (event.target.matches("details.preview-mapping") && event.target.isConnected) {
        circuitListOpen = event.target.open;
    } else if (event.target.matches("details.furniture-templates") &&
        event.target.isConnected) {
        furnitureTemplatesOpen = event.target.open;
    }
}, true);

content.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const rotateHandle = event.target.closest('[data-action="rotate-marker"]');
    if (rotateHandle) {
        event.preventDefault();
        rotateItem(rotateHandle.dataset.itemId);
        return;
    }
    const outdoorRotateHandle = event.target.closest('[data-action="rotate-outdoor-ac"]');
    if (outdoorRotateHandle) {
        event.preventDefault();
        rotateOutdoorUnit(outdoorRotateHandle.dataset.itemId);
        return;
    }
    const previewMarker = event.target.closest("[data-preview-item-id], [data-marker-id]");
    if (lightingPreview && previewMarker) {
        const previewItemId = previewMarker.dataset.previewItemId ??
            previewMarker.dataset.markerId;
        const previewItem = state.items.find((entry) => entry.id === previewItemId);
        if (previewItem?.switchType || previewItem?.lightType) {
            event.preventDefault();
            togglePreviewMarker(previewItemId);
            return;
        }
    }
    const outdoor = event.target.closest("[data-outdoor-id]");
    if (outdoor) {
        event.preventDefault();
        const item = state.items.find((entry) => entry.id === outdoor.dataset.outdoorId);
        if (!item) setStatus("找不到此室外機對應的分離式冷氣。", "error");
        else selectPlanRoom(item.roomId, item.id);
        return;
    }
    if (event.target.closest("[data-select-partition]")) {
        event.preventDefault();
        focusBedroom2Partition();
        return;
    }
    const room = event.target.closest("[data-select-room]");
    if (room) {
        event.preventDefault();
        selectPlanRoom(room.dataset.selectRoom);
        return;
    }
    const marker = event.target.closest("[data-marker-id]");
    if (marker) {
        event.preventDefault();
        selectedPlanItemId = marker.dataset.markerId;
        rotateHandleHidden = false;
        render();
    }
});

function openNewItem(roomId = "", productType = "") {
    if (invalidInputs.size || conflicted) {
        setStatus("請先修正無效數字或版本衝突，再新增設備。", "error");
        return;
    }
    if (roomId && !state.rooms.some((room) => room.id === roomId)) {
        setStatus("找不到要新增設備的房間，請重新載入。", "error");
        return;
    }
    if (productType && !["outlet-general", "dedicated-circuit"].includes(productType)) {
        setStatus("無效的快速新增種類。", "error");
        return;
    }
    newItemOriginView = view;
    pendingNewItem = {
        roomId, templateId: "", productType, name: "", circuitOutletId: "",
        model: "", quantity: "1", unit: productType ? productUnit(productType) : "組",
        unitPrice: productType === "outlet-general" ? String(SOCKET_UNIT_PRICE_TWD) :
            productType === "dedicated-circuit"
                ? String(DEDICATED_CIRCUIT_UNIT_PRICE_TWD) : "",
        installationPrice: "", spotlightModel: "", spotlightPrice: "",
        lightWatts: "", lightLumens: "", beamAngleDeg: "", lightSpecSource: "",
        priceCurrency: "TWD", priceSource: "", note: "",
    };
    render();
    content.querySelector(roomId ? "[data-add-product-type]" : "[data-add-room]")?.focus();
    setStatus("請選房間、物件種類與商品款式；尚未新增設備。");
}

function confirmNewItem(form) {
    const draft = pendingNewItem;
    if (!draft || !form.reportValidity()) return;
    if (invalidInputs.size || conflicted) {
        setStatus("請先修正無效數字或版本衝突，再新增設備。", "error");
        return;
    }
    if (!state.rooms.some((room) => room.id === draft.roomId)) {
        setStatus("請選擇有效的設備所屬房間。", "error");
        return;
    }
    if (!Object.hasOwn(PRODUCT_TYPES, draft.productType) || !draft.templateId) {
        setStatus("請依序選物件種類與商品款式，或選擇自行填寫。", "error");
        return;
    }
    if (state.items.length >= 600) {
        setStatus("設備清單已達容量上限，無法新增商品。", "error");
        return;
    }
    let item;
    let targetSocket = null;
    try {
        if (draft.productType === "dedicated-circuit") {
            targetSocket = state.items.find((entry) =>
                entry.id === draft.circuitOutletId && isSocket(entry) &&
                entry.roomId === draft.roomId && entry.placement &&
                !state.items.some((circuit) => isDedicatedCircuit(circuit) &&
                    circuit.circuitOutletId === entry.id));
            if (!targetSocket) {
                throw new RangeError("請先選本房一個已標位且尚未配對的一般插座。");
            }
        }
        const id = crypto.randomUUID();
        if (draft.templateId === "custom") {
            item = customEquipment({
                ...draft, customType: draft.productType,
            }, id);
        } else if (draft.templateId.startsWith("product:")) {
            const product = state.products.find((entry) =>
                entry.id === draft.templateId.slice("product:".length));
            if (!product || product.type !== draft.productType ||
                !productAllowedInRoom(product, draft.roomId)) {
                throw new RangeError("這款資料庫商品不適用於所選房間；請重新選款。");
            }
            item = equipmentFromProduct(product, draft.roomId, id);
        } else if (draft.templateId.startsWith("item:")) {
            const entry = equipmentCatalog(state.items, draft.roomId)
                .find((option) => option.id === draft.templateId.slice("item:".length) &&
                    catalogType(option.source) === draft.productType &&
                    !option.source.productId);
            if (!entry) throw new RangeError("選擇的商品已不適用於這個房間；請重新選款。");
            item = equipmentFromTemplate(entry.source, draft.roomId, id);
        } else {
            throw new RangeError("新增設備的款式格式不正確；請重新選擇。");
        }
        if (targetSocket) {
            item.circuitOutletId = targetSocket.id;
            const preferred = circuitPlacement(targetSocket.placement);
            const placement = clampPlacement(item, preferred.x, preferred.y);
            if (!placement) return;
            item.placement = placement;
        }
    } catch (error) {
        if (!(error instanceof RangeError || error instanceof TypeError)) throw error;
        setStatus(error.message, "error");
        return;
    }
    state.items.push(item);
    selectedPlanItemId = item.id;
    expandedItems.add(item.id);
    pendingNewItem = null;
    newItemOriginView = null;
    scheduleSave();
    if (view === "plan" || view === "device") {
        selectPlanRoom(item.roomId, item.id);
    } else {
        render();
        content.querySelector(`[data-id="${item.id}"]`)?.scrollIntoView({ block: "nearest" });
        content.querySelector(`[data-item-id="${item.id}"][data-field="name"]`)?.focus();
    }
    if (targetSocket) {
        setStatus("已暫新增一條專用迴路並配對插座；須由電工核對配電容量及跳電風險。正在儲存。");
    }
}

function addFurniture(type, position) {
    const template = FURNITURE_TEMPLATES[type];
    if (!template || !state.rooms.some((room) => room.id === planRoomId) ||
        !Number.isFinite(position?.x) || !Number.isFinite(position?.y)) {
        setStatus("請先選擇房間內的位置與家具種類。", "error");
        return;
    }
    const appliance = ["washer", "dryer", "refrigerator", "television"].includes(type);
    const item = {
        id: crypto.randomUUID(),
        roomId: planRoomId,
        name: template.name,
        quantity: 1,
        unit: appliance ? "台" : "件",
        brandModel: "",
        unitPrice: null,
        priceCurrency: "TWD",
        priceSource: "",
        note: type.startsWith("kitchen-")
            ? `廚房圖例尺寸為暫估，型號與價格待報。${KITCHEN_SAFETY}`
            : type === "refrigerator"
            ? "冰箱暫按 70×70cm 占地；機型、實際尺寸、開門方向、供電與走道淨距待確認。"
            : type === "television"
                ? "壁掛電視暫按 120×10cm 占地；安裝、插座、弱電及實際尺寸待確認。弱電配置列電視線不代表電視本體已報價。"
                : appliance
                    ? "暫按 60×60cm 占地示意；機型、實際尺寸、供電、給排水或排氣與價格待確認。"
                    : "家具外形為圖面示意，實際尺寸與價格待確認。",
        placement: null,
        orientation: null,
        kind: "furniture",
        furnitureType: type,
        widthCm: template.widthCm,
        depthCm: template.depthCm,
    };
    const placement = clampPlacement(item, position.x, position.y);
    if (!placement) return;
    item.placement = placement;
    state.items.push(item);
    selectedPlanItemId = item.id;
    pendingObject = null;
    rotateHandleHidden = false;
    scheduleSave();
    render();
}

function addSwitch(roomId) {
    if (invalidInputs.size || conflicted) {
        setStatus("請先修正未儲存的輸入或版本衝突，再新增開關。", "error");
        return;
    }
    if (!state.rooms.some((room) => room.id === roomId) ||
        roomId === "ac-platform") {
        setStatus("外推鐵窗不是室內房間，不能直接放開關；陽台須選戶外防潮款。", "error");
        return;
    }
    if (state.items.length >= 600) {
        setStatus("設備清單已達容量上限，無法再新增開關。", "error");
        return;
    }
    const outdoor = roomId === "balcony";
    const option = outdoor ? OUTDOOR_SWITCH_TYPES.double : SWITCH_TYPES.double;
    const item = {
        id: crypto.randomUUID(),
        roomId,
        name: `新增${option.label}`,
        quantity: 1,
        unit: "個",
        brandModel: option.brandModel,
        unitPrice: SWITCH_QUOTED_UNIT_PRICE_TWD,
        priceCurrency: "TWD",
        priceSource: outdoor
            ? "戶外防潮開關暫借原室內開關 NT$2,250 作基準；防水材料／配線實價待報"
            : "參考原水電報價單／雙開關每個 NT$2,250；新增配置與施工實價待廠商確認",
        note: outdoor
            ? "陽台新增的戶外防潮雙開關，暫沿用原室內開關 NT$2,250 單價試算；不是已選定的防水產品或已確認施工價。門側暫標位置須避雨，防護等級、防水盒與進線、漏電保護及陽台燈迴路須合格電工現場核對。"
            : "原報價僅含 15 個開關；本筆新增按原單價暫列追加，實際型號、配線與安裝待核。請在室內乾區或門旁標位，雙開關左右鍵與燈具對應尚未確定。",
        placement: null,
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
        switchType: "double",
        switchEnvironment: outdoor ? "outdoor" : "indoor",
        switchPlanStatus: "active",
        quotedUnitPrice: null,
        quotedQuantity: null,
    };
    state.items.push(item);
    selectedPlanItemId = item.id;
    expandedItems.add(item.id);
    pendingDeleteId = null;
    pendingObject = null;
    scheduleSave();
    render();
    setStatus(outdoor
        ? "已新增戶外防潮開關暫位（暫增 NT$2,250）；防水材料及安裝補差待報，請在陽台圖選點。"
        : "已新增雙開關（暫增 NT$2,250）；請到格局圖點選放置位置。");
}

function requestRemoveItem(id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item) {
        setStatus("找不到要刪除的設備，請重新載入。", "error");
        return;
    }
    if (isQuotedSwitch(item) && item.switchPlanStatus === "removed") {
        setStatus("此原報價開關已從規劃移除，可按「恢復」重新配置。", "error");
        return;
    }
    if (item.kind === "door" ||
        isQuotedEquipment(item) && !isQuotedSwitch(item) &&
            !isSocket(item) && !isDedicatedCircuit(item)) {
        setStatus("原報價內的門位、衛浴施工、滑門軌道及其他施工明細不可刪除。", "error");
        return;
    }
    pendingDeleteId = id;
    pendingMoveOutletId = null;
    render();
}

function requestMoveQuotedOutlet(id) {
    if (!state.items.some((item) => item.id === id && isQuotedOutlet(item))) {
        setStatus("找不到要移轉的原報插座，請重新載入。", "error");
        return;
    }
    if (invalidInputs.size || conflicted) {
        setStatus("請先修正無效數字或版本衝突，再移轉插座。", "error");
        return;
    }
    pendingMoveOutletId = id;
    pendingDeleteId = null;
    render();
}

function confirmRemoveItem(id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item || pendingDeleteId !== id) {
        setStatus("刪除確認已失效，請重新選取設備。", "error");
        return;
    }
    if (conflicted) {
        setStatus("設備版本已有衝突，請重新載入後再刪除。", "error");
        return;
    }
    if (isSocket(item) && state.items.some((entry) =>
        isDedicatedCircuit(entry) && entry.circuitOutletId === id)) {
        setStatus("此插座已配專用迴路，請先將迴路改綁其他插座或刪除迴路。", "error");
        return;
    }
    if (item.kind === "door" ||
        isQuotedEquipment(item) && !isQuotedSwitch(item) &&
            !isSocket(item) && !isDedicatedCircuit(item)) {
        setStatus("原報價內的明細不可刪除。", "error");
        return;
    }
    if ([...invalidInputs].some((key) => !key.startsWith(`${id}:`))) {
        setStatus("請先修正其他設備的無效數字，再刪除。", "error");
        return;
    }
    for (const key of [...invalidInputs]) {
        if (key.startsWith(`${id}:`)) invalidInputs.delete(key);
    }
    if (isQuotedSwitch(item)) {
        if (item.switchPlanStatus === "removed") {
            setStatus("此原報價開關已移除，請使用恢復按鈕。", "error");
            return;
        }
        item.switchPlanStatus = "removed";
        item.quantity = 0;
        if (selectedPlanItemId === id) selectedPlanItemId = null;
        if (focusedCircuitId === id) focusedCircuitId = null;
        pendingDeleteId = null;
        scheduleSave();
        render();
        return;
    }
    state.items = state.items.filter((entry) => entry.id !== id);
    if (selectedPlanItemId === id) selectedPlanItemId = null;
    if (focusedCircuitId === id) focusedCircuitId = null;
    litItemIds.delete(id);
    pendingDeleteId = null;
    expandedItems.delete(id);
    scheduleSave();
    render();
    if (isSocket(item)) {
        setStatus(`已暫刪除此插座；目前 ${state.items.filter(isSocket).length} 個，
            原報以 50 個 × NT$1,800 計算。正在儲存，實際增減待電工確認。`
            .replace(/\s+/g, " "));
    } else if (isDedicatedCircuit(item)) {
        const count = state.items.filter(isDedicatedCircuit).length;
        setStatus(`已暫刪除此專用迴路；目前 ${count} 條，原報 7 條 × NT$4,500。
            ${count < QUOTED_DEDICATED_COUNT
                ? "少於 7 條可能增加高負載共線跳電風險，建議至少保留 7 條。" : ""}
            正在儲存；任何迴路變動的跳電風險均須請電工確認。`.replace(/\s+/g, " "));
    }
}

function confirmMoveQuotedOutlet(id, target) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item || !isQuotedOutlet(item) || pendingMoveOutletId !== id) {
        setStatus("插座移轉確認已失效，請重新選取原報插座。", "error");
        return;
    }
    if (invalidInputs.size || conflicted) {
        setStatus("請先修正無效數字或版本衝突，再移轉原報插座。", "error");
        return;
    }
    const replacement = target?.startsWith("replace:")
        ? state.items.find((entry) => entry.id === target.slice(8)) : null;
    const room = state.rooms.find((entry) => entry.id ===
        (replacement?.roomId ?? (target?.startsWith("room:") ? target.slice(5) : null)));
    if (!room || room.id === item.roomId || room.id === "ac-platform" ||
        target?.startsWith("replace:") && (!replacement ||
            replacement.outletCircuit !== "additional-general" ||
            !replacement.placement)) {
        setStatus("請選擇不同房間，或該房已標位的新增一般插座。", "error");
        return;
    }
    const originalCircuit = state.items.find((entry) =>
        isDedicatedCircuit(entry) && entry.circuitOutletId === id);
    const replacementCircuit = replacement && state.items.find((entry) =>
        isDedicatedCircuit(entry) && entry.circuitOutletId === replacement.id);
    if (originalCircuit && replacementCircuit) {
        setStatus("來源與要取代的插座都已配專用迴路；請先改綁或刪除其中一條，避免同一插座接兩條迴路。", "error");
        return;
    }
    const circuitProduct = originalCircuit?.productId
        ? state.products.find((product) => product.id === originalCircuit.productId) : null;
    if (circuitProduct && !productAllowedInRoom(circuitProduct, room.id)) {
        setStatus("此專用迴路連動的商品款式不適用新房間；請先改選或解除資料庫連動。", "error");
        return;
    }
    const previousRoom = roomName(item.roomId);
    const moveNote = `原報插座名額由${previousRoom}改放${room.name}；
        ${replacement ? "已取代該房新增插座，不再另列新增費用。" :
            "新位置暫標，請拖曳至合適牆側。"}
        ${originalCircuit ? "其專用迴路已一同移至新房，原用途待重新核對。" : ""}
        電壓、用途、配線及防潮等級仍待電工確認。`.replace(/\s+/g, " ");
    const note = [
        moveNote,
        item.note ? `原點備註：${item.note}` : null,
        replacement?.note ? `取代點備註：${replacement.note}` : null,
    ].filter(Boolean).join("\n");
    const priceSource = replacement?.priceSource &&
        replacement.priceSource !== item.priceSource
        ? `${item.priceSource}；移轉前新增點參考：${replacement.priceSource}`
        : item.priceSource;
    const name = replacement
        ? replacement.name.replace(/^新增/, "") ||
            `一般插座－${room.name}`
        : `一般插座－${room.name}（用途待定）`;
    if (note.length > 1000 || priceSource.length > 500 || name.length > 120) {
        setStatus("移轉後的名稱、備註或價格來源過長；請先縮短原點／新增點資料，尚未移轉。", "error");
        return;
    }
    const moved = {
        ...item,
        roomId: room.id,
        name,
        note,
        priceSource,
        brandModel: replacement?.brandModel ?? item.brandModel,
        unitPrice: replacement ? replacement.unitPrice : item.unitPrice,
        orientation: replacement ? replacement.orientation : null,
        productId: null,
    };
    const preferred = replacement?.placement ?? { x: .5, y: .5 };
    const placement = clampPlacement(moved, preferred.x, preferred.y);
    if (!placement) return;
    if (replacement && (Math.abs(placement.x - preferred.x) > .005 ||
        Math.abs(placement.y - preferred.y) > .005)) {
        setStatus("新增插座的標位不適合移入的原報插座；請先調整新增點的位置，尚未移轉。", "error");
        return;
    }
    moved.placement = placement;
    let movedCircuit = null;
    if (originalCircuit) {
        movedCircuit = { ...originalCircuit, roomId: room.id };
        if (originalCircuit.placement) {
            const preferredCircuit = circuitPlacement(placement);
            const circuitPlacementInRoom = clampPlacement(
                movedCircuit, preferredCircuit.x, preferredCircuit.y);
            if (!circuitPlacementInRoom) return;
            movedCircuit.placement = circuitPlacementInRoom;
        }
    }
    state.items = state.items.filter((entry) => entry.id !== replacement?.id)
        .map((entry) => entry.id === id ? moved :
            entry.id === originalCircuit?.id ? movedCircuit :
                entry.id === replacementCircuit?.id
                    ? { ...entry, circuitOutletId: id } : entry);
    if (pendingObject?.kind === "existing" &&
        (pendingObject.id === id || pendingObject.id === replacement?.id)) pendingObject = null;
    if (replacement) expandedItems.delete(replacement.id);
    if (view === "plan") {
        planRoomId = room.id;
        selectedPlanItemId = id;
        rotateHandleHidden = true;
    } else if (selectedPlanItemId === replacement?.id) {
        selectedPlanItemId = id;
    }
    pendingMoveOutletId = null;
    scheduleSave();
    render();
    setStatus(`已暫將原報插座移至${room.name}${replacement
        ? "並取代該房的新增插座" : "暫標位置"}；
        目前 ${state.items.filter(isSocket).length} 個插座、
        ${state.items.filter(isDedicatedCircuit).length} 條專用迴路。
        原報 50 個／7 條基準不變，正在儲存；新用途與跳電風險須電工核對。`
        .replace(/\s+/g, " "));
}

function restoreSwitch(id) {
    const item = state.items.find((entry) => entry.id === id);
    if (!item || !isQuotedSwitch(item) || item.switchPlanStatus !== "removed") {
        setStatus("找不到可恢復的原報價開關。", "error");
        return;
    }
    if (invalidInputs.size || conflicted) {
        setStatus("請先修正未儲存的輸入或版本衝突，再恢復開關。", "error");
        return;
    }
    item.switchPlanStatus = "active";
    item.quantity = 1;
    pendingDeleteId = null;
    scheduleSave();
    render();
}

function cancelRemoveItem() {
    pendingDeleteId = null;
    render();
    setStatus("已取消刪除。");
}

function renameRoom(id) {
    if (invalidInputs.size) {
        setStatus("請先修正無效數字，再修改房間。", "error");
        return;
    }
    const room = state.rooms.find((entry) => entry.id === id);
    if (!room) return;
    const name = window.prompt("修改房間名稱：", room.name)?.trim();
    if (!name || name === room.name) return;
    if (name.length > 60) {
        setStatus("房間名稱不可超過 60 字元。", "error");
        return;
    }
    if (state.rooms.some((entry) => entry.name === name)) {
        setStatus("這個房間名稱已存在。", "error");
        return;
    }
    room.name = name;
    scheduleSave();
    render();
}

function removeRoom(id) {
    if (knownRoomIds.has(id)) {
        setStatus("既有格局房間不可刪除，請修改房間名稱或設備清單。", "error");
        return;
    }
    if (invalidInputs.size) {
        setStatus("請先修正無效數字，再刪除房間。", "error");
        return;
    }
    const room = state.rooms.find((entry) => entry.id === id);
    if (!room) return;
    if (state.items.some((item) => item.roomId === id)) {
        setStatus("請先將此房間的設備移到其他房間，才能刪除房間。", "error");
        return;
    }
    if (!window.confirm(`確定刪除房間「${room.name}」？`)) return;
    state.rooms = state.rooms.filter((entry) => entry.id !== id);
    if (planRoomId === id) planRoomId = null;
    scheduleSave();
    render();
}

function datedFileName(extension) {
    const date = new Date().toLocaleDateString("sv-SE");
    return `裝修設備規劃-${date}.${extension}`;
}

async function downloadSave() {
    if (!state || invalidInputs.size || conflicted || saving) {
        setStatus("請先載入清單，修正無效輸入或等待儲存／版本衝突處理後再存檔。", "error");
        return;
    }
    try {
        if (dirty && !isPortableMode()) await save();
        if (dirty && !isPortableMode()) {
            setStatus("修改尚未成功寫入本機，請先處理儲存錯誤再下載存檔。", "error");
            return;
        }
        if (!isPortableMode()) {
            const latest = await fetchState();
            if (latest.revision !== state.revision) {
                state = latest;
                render();
                setStatus("已同步另一視窗的更新；請確認後再按一次「存檔 JSON」。", "error");
                return;
            }
        }
        const document = encodeSave(state);
        if (new Blob([document]).size > MAX_SAVE_BYTES) {
            throw new RangeError("存檔超過 4 MB，請先檢查設備備註或圖片資料。");
        }
        downloadFile(datedFileName("json"), document, "application/json;charset=utf-8");
        setStatus(isPortableMode() && dirty
            ? "JSON 已下載；此瀏覽器無法保證自動保存，請妥善保管存檔。"
            : "完整房間、設備和物件資料庫已下載為 JSON。", "saved");
    } catch (error) {
        setStatus(error.message, "error");
    }
}

function downloadItemList() {
    if (!state || invalidInputs.size) {
        setStatus("請先載入清單並修正無效數字，才能匯出物件清單。", "error");
        return;
    }
    try {
        downloadFile(datedFileName("csv"), itemListCsv(state), "text/csv;charset=utf-8");
        setStatus(dirty ? "已輸出目前畫布上的已放置物件（含尚未儲存的修改）。" :
            "已輸出已放置物件 CSV；未標位工程明細請查完整 JSON 存檔。", "saved");
    } catch (error) {
        setStatus(error.message, "error");
    }
}

async function loadSave(file) {
    if (!file) return;
    if (saving || file.size > MAX_SAVE_BYTES) {
        setStatus(saving ? "目前正在儲存，請稍後再讀檔。" :
            "JSON 存檔超過 4 MB，未改動目前規劃。", "error");
        return;
    }
    let imported;
    try {
        imported = decodeSave(await file.text());
    } catch (error) {
        setStatus(error.message, "error");
        return;
    }
    const itemCount = imported.items.length;
    const roomCount = imported.rooms.length;
    if (!window.confirm(`讀檔將以「${file.name}」的 ${roomCount} 間房、` +
        `${itemCount} 筆物件及 ${imported.products.length} 款商品，` +
        "取代目前畫布的全部規劃（包含未儲存的變更）。確定嗎？")) return;
    clearTimeout(saveTimer);
    const prior = state ? stateSnapshot() : imported.undo ?? null;
    try {
        const updated = await writePlannerState({
            version: PLANNER_STATE_VERSION,
            expectedRevision: state?.revision ?? 0,
            importing: true,
            rooms: imported.rooms,
            items: imported.items,
            products: imported.products,
            undo: prior,
        });
        state = { ...updated, products: updated.products ?? [] };
        resetActionTracking();
        dirty = Boolean(updated.storageWarning);
        conflicted = false;
        invalidInputs.clear();
        pendingNewItem = null;
        pendingProduct = null;
        pendingDeleteId = null;
        pendingMoveOutletId = null;
        pendingProductDeleteId = null;
        selectedPlanItemId = null;
        planRoomId = null;
        pendingObject = null;
        lightingPreview = false;
        litItemIds = new Set();
        focusedCircuitId = null;
        view = "plan";
        reloadButton.hidden = true;
        render();
        setStatus(updated.storageWarning ||
            `已讀入 ${roomCount} 間房、${itemCount} 筆物件；目前顯示存檔中的配置。`,
        updated.storageWarning ? "error" : "saved");
    } catch (error) {
        conflicted = Boolean(error.conflict);
        reloadButton.hidden = !conflicted;
        setStatus(`讀檔未套用：${error.message}`, "error");
    }
}

document.querySelector("#add-item").addEventListener("click", () => {
    if (view === "survey") {
        setStatus("請切回格局圖或依房間後新增設備。", "error");
        return;
    }
    openNewItem(view === "plan" ? planRoomId ?? "" : "");
});
document.querySelector("#save-now").addEventListener("click", () => void save());
undoButton.addEventListener("click", () => void undoLastChange());
document.querySelector("#save-file").addEventListener("click", () => void downloadSave());
document.querySelector("#export-items").addEventListener("click", downloadItemList);
document.querySelector("#load-file").addEventListener("click", () => {
    document.querySelector("#load-file-input").click();
});
document.querySelector("#load-file-input").addEventListener("change", (event) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (file) void loadSave(file);
});
reloadButton.addEventListener("click", async () => {
    if (dirty && !window.confirm("重新載入會捨棄尚未儲存的變更，確定嗎？")) return;
    try {
        state = await fetchState();
        resetActionTracking();
        dirty = false;
        conflicted = false;
        invalidInputs.clear();
        pendingDeleteId = null;
        pendingMoveOutletId = null;
        reloadButton.hidden = true;
        render();
        setStatus("已載入最新資料", "saved");
    } catch (error) {
        setStatus(error.message, "error");
    }
});

for (const button of document.querySelectorAll("[data-view]")) {
    button.addEventListener("click", () => {
        if (invalidInputs.size) {
            setStatus("請先修正無效數字，再切換檢視方式。", "error");
            return;
        }
        view = button.dataset.view;
        pendingDeleteId = null;
        pendingMoveOutletId = null;
        if (view !== "plan") pendingObject = null;
        render();
    });
}

window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || view !== "plan" || !planRoomId ||
        pendingNewItem || pendingProduct ||
        event.target?.closest?.("input, select, textarea") ||
        rotateHandleHidden && !pendingObject) return;
    event.preventDefault();
    finishRotation();
});

window.addEventListener("keydown", (event) => {
    if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey ||
        event.key.toLowerCase() !== "z" ||
        event.target?.closest?.("input, textarea, select, [contenteditable]")) return;
    event.preventDefault();
    void undoLastChange();
});

window.addEventListener("beforeunload", (event) => {
    if (dirty || saving || undoing) {
        event.preventDefault();
        event.returnValue = "";
    }
});

async function refreshIfClean() {
    if (!state || dirty || saving || conflicted || pendingProduct ||
        furnitureDrag || outdoorDrag) return;
    try {
        const latest = await fetchState();
        if (latest.revision > state.revision) {
            state = latest;
            resetActionTracking();
            render();
            setStatus("已同步其他視窗的修改", "saved");
        }
    } catch (error) {
        setStatus(error.message, "error");
    }
}

window.addEventListener("focus", () => void refreshIfClean());
setInterval(() => void refreshIfClean(), 15000);

try {
    state = await fetchState();
    resetActionTracking();
    render();
    setStatus(globalThis.__RENOVATION_OFFLINE_STORE__?.demo
        ? "已載入規劃；修改只保存在此瀏覽器，不會更新公開儲存庫，請下載 JSON 備份。"
        : "已載入本機清單", "saved");
} catch (error) {
    if (isPortableMode() && error.noState) {
        const demoFailed = error.demoLoadFailed || error.demoStorageUnavailable;
        content.textContent = demoFailed
            ? "公開示例尚未載入；仍可按上方「讀檔 JSON」手動選擇設備規劃存檔。"
            : "尚未讀取裝修規劃。請按上方「讀檔 JSON」選擇設備規劃存檔。";
        document.querySelector("#download-portable").hidden = true;
        document.querySelector("#portable-note").hidden = false;
        setStatus(demoFailed ? error.message
            : "請先讀入 JSON 存檔；此離線 HTML 不含個人設備資料。",
        demoFailed ? "error" : "info");
    } else {
        content.textContent = "設備資料載入失敗，請檢查檔案或擴充功能日誌。";
        setStatus(error.message, "error");
        reloadButton.hidden = false;
    }
}
