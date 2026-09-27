import { isPlacedLight } from "./lighting-preview.js";

export const CONTROL_RELATIONS_VERSION = 1;
export const CONTROL_RELATIONS_CAUTION =
    "屋主指定對應待電工核／非實際配管走線／非施工圖";

export function isControlTarget(item) {
    return isPlacedLight(item) && item.quantity > 0 &&
        Number.isFinite(item.placement.x) && Number.isFinite(item.placement.y);
}

export function validateControlRelations(items) {
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const item of items) {
        if (!Object.hasOwn(item, "controlledLightIds")) continue;
        const ids = item.controlledLightIds;
        if (!item.switchType || !Array.isArray(ids) || ids.length > 600 ||
            ids.some((id) => typeof id !== "string" || !id.length) ||
            new Set(ids).size !== ids.length) {
            throw new TypeError("開關對應須為不重複的燈具ID清單，且只能填於開關面板。");
        }
        if (ids.length && (item.switchPlanStatus !== "active" || !item.placement)) {
            throw new RangeError("移除開關或清除標位前，請先在燈具配置圖解除對應。");
        }
        if (ids.some((id) => !isControlTarget(byId.get(id)))) {
            throw new RangeError(
                "開關對應的燈具不存在、未標位或無有效燈頭；請先解除對應，再刪除或停用燈具。"
            );
        }
    }
}

export function hasControlRelations(state) {
    return [state?.items, state?.undo?.items].some((items) =>
        items?.some((item) => Object.hasOwn(item, "controlledLightIds")));
}

export function guardControlRelationsUpdate(current, candidate) {
    if ((hasControlRelations(current) || hasControlRelations(candidate)) &&
        candidate?.controlRelationsVersion !== CONTROL_RELATIONS_VERSION) {
        throw new TypeError(
            "此存檔含開關燈具對應（含復原紀錄）；舊版畫布不能寫入，請重新載入支援對應的版本。"
        );
    }
}

export function itemHasControlRelations(item, items) {
    return Boolean(item?.controlledLightIds?.length ||
        items.some((entry) => entry.controlledLightIds?.includes(item?.id)));
}

export function previewControlledLights(switchItem, items) {
    if (!Array.isArray(items)) throw new TypeError("照明對應缺少設備清單。");
    if (!switchItem?.switchType || switchItem.switchPlanStatus !== "active" ||
        !switchItem.placement) return [];
    const ids = new Set(switchItem.controlledLightIds ?? []);
    return items.filter((item) => ids.has(item.id) && isControlTarget(item));
}

export function previewCircuitLinks(items) {
    if (!Array.isArray(items)) throw new TypeError("照明對應缺少設備清單。");
    return items.filter((item) => item.switchType && item.placement &&
        item.switchPlanStatus === "active")
        .flatMap((switchItem) => previewControlledLights(switchItem, items)
            .map((lightItem) => ({ switchItem, lightItem })));
}
