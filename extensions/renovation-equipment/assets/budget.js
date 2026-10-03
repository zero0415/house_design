import {
    materialIncludesTrack, QUOTED_SLIDE_TRACKS, SLIDE_TRACK_RATE_TWD,
} from "./slide-tracks.js";
import {
    isAllocatedDoorItem, isQuotedDoor, isUnquotedBalconyDoor,
} from "./door-allocation.js";
import {
    DEDICATED_CIRCUIT_UNIT_PRICE_TWD, QUOTED_CIRCUITS, QUOTED_OUTLETS,
    SOCKET_UNIT_PRICE_TWD,
} from "./socket-plan.js";
import { managementFeeSummary } from "./management-fee.js";

export const ORIGINAL_QUOTE_TWD = 1_959_530;

export function isSlideTrack(item) {
    return item.kind === "equipment" && item.trackDoorId != null;
}

export function slideTrackNeeded(doorId, items) {
    const door = items.find((item) => item.kind === "door" && item.doorId === doorId);
    if (door) {
        return door.doorOpeningKind === "slide" && !materialIncludesTrack(door.doorMaterial);
    }
    if (doorId === "bedroom-3-studio") return true;
    throw new RangeError(`找不到滑門軌道對應的門位：${doorId}`);
}

export function unquotedTrackCost(door, items) {
    if (door.kind !== "door") throw new TypeError("只能計算門位的滑門軌道費。");
    if (isUnquotedBalconyDoor(door)) return 0;
    if (door.doorOpeningKind !== "slide" || materialIncludesTrack(door.doorMaterial) ||
        items.some((track) => track.trackDoorId === door.doorId) ||
        !items.some(isAllocatedDoorItem) &&
            QUOTED_SLIDE_TRACKS.some((track) => track.doorId === door.doorId)) return 0;
    return door.trackLengthM === null || door.trackLengthM === undefined
        ? null : Math.round((door.trackLengthM * SLIDE_TRACK_RATE_TWD + Number.EPSILON) * 100) / 100;
}

export function itemSubtotal(item, items) {
    if (item.acPlanStatus === "excluded") return 0;
    if (item.switchType && item.switchPlanStatus === "removed") return 0;
    if (isSlideTrack(item)) {
        if (!Array.isArray(items)) throw new TypeError("滑門軌道計價需要門位清單。");
        if (isAllocatedDoorItem(item)) {
            return item.quantity === null || item.unitPrice === null ? null :
                Math.max(item.quotedQuantity * item.quotedUnitPrice,
                    Math.round((item.quantity * item.unitPrice +
                        Number.EPSILON) * 100) / 100);
        }
        if (!slideTrackNeeded(item.trackDoorId, items)) return 0;
    }
    return item.quantity === null || item.unitPrice === null
        ? null
        : Math.round((item.quantity * item.unitPrice + Number.EPSILON) * 100) / 100;
}

export function installationSubtotal(item) {
    if (item.lightType !== "ceiling" && item.lightType !== "track") return 0;
    if (item.quantity == null || item.installationUnitPrice == null) return null;
    if (!Number.isFinite(item.quantity) || !Number.isFinite(item.installationUnitPrice)) {
        throw new TypeError("吸頂燈的數量或安裝單價無效。");
    }
    return Math.round((item.quantity * item.installationUnitPrice + Number.EPSILON) * 100) / 100;
}

export function spotlightSubtotal(item) {
    if (item.lightType !== "track") return 0;
    if (item.spotlightQuantity === 0) return 0;
    if (item.spotlightQuantity == null || item.spotlightUnitPrice == null) return null;
    if (!Number.isSafeInteger(item.spotlightQuantity) ||
        !Number.isFinite(item.spotlightUnitPrice)) {
        throw new TypeError("走廊軌道燈的數量或單價無效。");
    }
    return Math.round((item.spotlightQuantity * item.spotlightUnitPrice +
        Number.EPSILON) * 100) / 100;
}

export function isQuotedEquipment(item) {
    return item.kind === "equipment" &&
        item.quotedUnitPrice !== null && item.quotedUnitPrice !== undefined &&
        item.quotedQuantity !== null && item.quotedQuantity !== undefined;
}

export function calculatePlanTotal(budget, managementFee) {
    return {
        TWD: Math.round((ORIGINAL_QUOTE_TWD + budget.additionalTotals.TWD -
            budget.reductionTWD +
            managementFeeSummary(managementFee).totalTWD +
            Number.EPSILON) * 100) / 100,
        foreignTotals: {
            JPY: budget.additionalTotals.JPY,
            USD: budget.additionalTotals.USD,
        },
    };
}

export function calculateBudget(items, { wholePlan = false } = {}) {
    const pricedTotals = { TWD: 0, JPY: 0, USD: 0 };
    const additionalTotals = { TWD: 0, JPY: 0, USD: 0 };
    let pendingCount = 0;
    let reductionTWD = 0;
    let quotedDoorTotal = 0;
    let quotedEquipmentTotal = 0;
    for (const item of items) {
        const quotedEquipment = isQuotedEquipment(item);
        const quoted = isQuotedDoor(item) || quotedEquipment;
        const baseline = quoted ? item.quotedQuantity * item.quotedUnitPrice : 0;
        if (item.kind === "door") quotedDoorTotal += baseline;
        if (quotedEquipment) quotedEquipmentTotal += baseline;
        const selected = itemSubtotal(item, items);
        if (selected === null) {
            pendingCount += 1;
        } else {
            pricedTotals[item.priceCurrency] += selected;
            if (quoted) {
                const difference = selected - baseline;
                if (difference >= 0) additionalTotals.TWD += difference;
                else reductionTWD -= difference;
            } else {
                additionalTotals[item.priceCurrency] += selected;
            }
        }
        const installation = installationSubtotal(item);
        if (installation === null) pendingCount += 1;
        else {
            pricedTotals.TWD += installation;
            additionalTotals.TWD += installation;
        }
        const spotlights = spotlightSubtotal(item);
        if (spotlights === null) pendingCount += 1;
        else {
            pricedTotals[item.priceCurrency] += spotlights;
            additionalTotals[item.priceCurrency] += spotlights;
        }
        if (item.kind === "door") {
            const trackCost = unquotedTrackCost(item, items);
            if (trackCost === null) pendingCount += 1;
            else {
                pricedTotals.TWD += trackCost;
                additionalTotals.TWD += trackCost;
            }
        }
    }
    if (wholePlan) {
        const presentIds = new Set(items.map((item) => item.id));
        const unusedQuotedAllowance =
            QUOTED_OUTLETS.filter((outlet) => !presentIds.has(outlet.id)).length *
                SOCKET_UNIT_PRICE_TWD +
            QUOTED_CIRCUITS.filter((circuit) => !presentIds.has(circuit.id)).length *
                DEDICATED_CIRCUIT_UNIT_PRICE_TWD;
        reductionTWD += unusedQuotedAllowance;
        quotedEquipmentTotal += unusedQuotedAllowance;
    }
    for (const totals of [pricedTotals, additionalTotals]) {
        for (const code of Object.keys(totals)) {
            totals[code] = Math.round((totals[code] + Number.EPSILON) * 100) / 100;
        }
    }
    return {
        pricedTotal: pricedTotals.TWD,
        pricedTotals,
        additionalTotals,
        reductionTWD: Math.round((reductionTWD + Number.EPSILON) * 100) / 100,
        quotedDoorTotal,
        quotedEquipmentTotal,
        quotedBaselineTotal: quotedDoorTotal + quotedEquipmentTotal,
        pendingCount,
    };
}
