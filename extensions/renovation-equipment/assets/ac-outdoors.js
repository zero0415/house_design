import {
    EXTERIOR_PLATFORM, HOUSE_SIZE, HOUSE_ZONE_BY_ID, PLAN_PIXELS_PER_CM,
} from "./house-geometry.js";

export const AC_ROOM_IDS = Object.freeze([
    "master", "bedroom-1", "bedroom-2", "bedroom-3", "living-dining", "studio",
]);
export const OUTDOOR_AC_ANCHOR = Object.freeze({ width: 30, height: 24 });
export const OUTDOOR_AC_ESTIMATED_SIZE_CM = Object.freeze({ width: 80, depth: 35 });
export const OUTDOOR_AC_SIZE_BOUNDS_CM = Object.freeze({
    minWidth: 30, maxWidth: 250, minDepth: 15, maxDepth: 150,
});

export const OUTDOOR_AC_ZONES = Object.freeze({
    master: Object.freeze({
        x: 874, y: 250, width: 58, height: 76,
        face: "right",
        windowId: "master-right",
        label: "主臥 W40 窗外（施工出入與固定方式待核）",
        placement: Object.freeze({ x: 0.52, y: 0.40 }),
    }),
    "bedroom-1": Object.freeze({
        x: 874, y: 1084, width: 58, height: 126,
        face: "right",
        windowId: "bedroom-1-lower",
        label: "臥室1較寬的 W119 窗外（結構待核）",
        placement: Object.freeze({ x: 0.52, y: 0.78 }),
    }),
    "living-dining": Object.freeze({
        x: 335, y: 95, width: 122, height: 80,
        face: "top",
        windowId: "living-top-west",
        label: "客餐廳 W117 窗外（外牆固定待核）",
        placement: Object.freeze({ x: 0.615, y: 0.68 }),
    }),
    studio: Object.freeze({
        x: 874, y: 1423, width: 58, height: 130,
        face: "right",
        windowId: "studio-upper",
        label: "工作室 W118 窗外（管線與固定待核）",
        placement: Object.freeze({ x: 0.52, y: 0.83 }),
    }),
    "bedroom-3": Object.freeze({
        x: 370, y: 1844, width: 170, height: 62,
        face: "platform",
        windowId: "bedroom-3-end",
        platform: true,
        label: "臥室3後牆窗外的外推鐵窗；承重、通風及許可待核",
        placement: Object.freeze({ x: 0.50, y: 0.50 }),
    }),
});

const additionalWindowZones = Object.freeze({
    "bedroom-1": Object.freeze([Object.freeze({
        x: 874, y: 950, width: 58, height: 120,
        face: "right",
        windowId: "bedroom-1-upper",
        label: "臥室1 W50 窗外（洞口窄於暫估機長，搬運與固定待核）",
        placement: Object.freeze({ x: 0.52, y: 0.50 }),
    })]),
    "living-dining": Object.freeze([Object.freeze({
        x: 472, y: 95, width: 92, height: 80,
        face: "top",
        windowId: "living-top",
        label: "客餐廳 W51.5 窗外（洞口窄於暫估機長，外牆固定待核）",
        placement: Object.freeze({ x: 0.50, y: 0.65 }),
    })]),
    studio: Object.freeze([Object.freeze({
        x: 874, y: 1585, width: 58, height: 120,
        face: "right",
        windowId: "studio-lower",
        label: "工作室 W54 窗外（洞口窄於暫估機長，配管與固定待核）",
        placement: Object.freeze({ x: 0.52, y: 0.51 }),
    })]),
});

export function outdoorACZoneChoices(roomId) {
    const primary = OUTDOOR_AC_ZONES[roomId];
    return primary ? [primary, ...(additionalWindowZones[roomId] ?? [])] : [];
}

export function outdoorACZone(item) {
    const zoneId = item.outdoorZoneId ?? OUTDOOR_AC_ZONES[item.roomId]?.windowId;
    const zone = outdoorACZoneChoices(item.roomId)
        .find((entry) => entry.windowId === zoneId);
    if (!zone) throw new RangeError(`無效的${item.roomId}室外機窗位，未改動配置。`);
    return zone;
}

const platform = OUTDOOR_AC_ZONES["bedroom-3"];
if (platform.x < EXTERIOR_PLATFORM.x ||
    platform.x + platform.width > EXTERIOR_PLATFORM.x + EXTERIOR_PLATFORM.width ||
    platform.y < EXTERIOR_PLATFORM.y ||
    platform.y + platform.height > EXTERIOR_PLATFORM.y + EXTERIOR_PLATFORM.height) {
    throw new RangeError("臥室3的室外機預留區超出現況圖外推鐵窗輪廓。");
}

export function isSplitAirConditioner(item) {
    return item?.kind === "equipment" && typeof item.id === "string" &&
        item.id.startsWith("ac-") && AC_ROOM_IDS.includes(item.id.slice(3));
}

export function isActiveSplitAirConditioner(item) {
    return isSplitAirConditioner(item) && item.acPlanStatus !== "excluded";
}

export function outdoorACPosition(item) {
    if (!isSplitAirConditioner(item)) {
        throw new TypeError("只能對已規劃的分離式冷氣讀取室外機位置。");
    }
    if (item.outdoorPlacement == null) return null;
    const zone = outdoorACZone(item);
    return {
        x: zone.x + item.outdoorPlacement.x * zone.width,
        y: zone.y + item.outdoorPlacement.y * zone.height,
    };
}

export function outdoorACFootprint(item) {
    if (!isSplitAirConditioner(item)) {
        throw new TypeError("只有分離式冷氣能設定室外機占地。");
    }
    const widthCm = item.outdoorWidthCm === undefined
        ? OUTDOOR_AC_ESTIMATED_SIZE_CM.width : item.outdoorWidthCm;
    const depthCm = item.outdoorDepthCm === undefined
        ? OUTDOOR_AC_ESTIMATED_SIZE_CM.depth : item.outdoorDepthCm;
    const { minWidth, maxWidth, minDepth, maxDepth } = OUTDOOR_AC_SIZE_BOUNDS_CM;
    if (!Number.isFinite(widthCm) || widthCm < minWidth || widthCm > maxWidth ||
        !Number.isFinite(depthCm) || depthCm < minDepth || depthCm > maxDepth) {
        throw new RangeError("室外機暫估占地寬深必須在合理公分範圍內。");
    }
    const face = outdoorACZone(item).face;
    const orientation = item.outdoorOrientation === undefined
        ? 0 : item.outdoorOrientation;
    if (![0, 90, 180, 270].includes(orientation)) {
        throw new RangeError("室外機方向須為 0、90、180 或 270 度。");
    }
    const longSide = widthCm * PLAN_PIXELS_PER_CM;
    const shortSide = depthCm * PLAN_PIXELS_PER_CM;
    const base = face === "right"
        ? { width: shortSide, height: longSide }
        : { width: longSide, height: shortSide };
    return orientation === 90 || orientation === 270
        ? { width: base.height, height: base.width } : base;
}

export function outdoorACSceneConflict(item) {
    const center = outdoorACPosition(item);
    if (!center) return false;
    const size = outdoorACFootprint(item);
    const zone = outdoorACZone(item);
    const room = HOUSE_ZONE_BY_ID.get(item.roomId);
    if (!zone || !room) throw new RangeError("室外機所屬房間缺少外牆輪廓。");
    const left = center.x - size.width / 2;
    const right = center.x + size.width / 2;
    const top = center.y - size.height / 2;
    const bottom = center.y + size.height / 2;
    if (left < 0 || right > HOUSE_SIZE.width ||
        top < 0 || bottom > HOUSE_SIZE.height) return true;
    if (zone.face === "right") return left < room.x + room.width;
    if (zone.face === "top") return bottom > room.y;
    if (zone.face === "platform") {
        return left < EXTERIOR_PLATFORM.x || right > EXTERIOR_PLATFORM.x + EXTERIOR_PLATFORM.width ||
            top < EXTERIOR_PLATFORM.y || bottom > EXTERIOR_PLATFORM.y + EXTERIOR_PLATFORM.height;
    }
    throw new RangeError("室外機外牆方向無效。");
}
