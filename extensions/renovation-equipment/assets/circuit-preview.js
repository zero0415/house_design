import { isPlacedLight } from "./lighting-preview.js";

export function previewTargetRoomId(switchItem) {
    if (!switchItem?.switchType || typeof switchItem.roomId !== "string") {
        throw new TypeError("照明對應只能從已配置的開關讀取。");
    }
    if (switchItem.roomId === "entry") {
        return "corridor";
    }
    if (switchItem.id === "quoted-switch-12" && switchItem.roomId === "studio") {
        return "balcony";
    }
    return switchItem.roomId;
}

export function previewControlledLights(switchItem, items) {
    if (!Array.isArray(items)) throw new TypeError("照明對應缺少設備清單。");
    if (switchItem.switchPlanStatus === "removed") return [];
    const targetRoomId = previewTargetRoomId(switchItem);
    return items.filter((item) =>
        item.roomId === targetRoomId && isPlacedLight(item));
}

export function previewCircuitLinks(items) {
    if (!Array.isArray(items)) throw new TypeError("照明對應缺少設備清單。");
    return items.filter((item) => item.switchType && item.placement &&
        item.switchPlanStatus !== "removed")
        .flatMap((switchItem) => previewControlledLights(switchItem, items)
            .map((lightItem) => ({ switchItem, lightItem })));
}
