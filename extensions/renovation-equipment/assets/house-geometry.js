import { isConditionalFloorDryer } from "./laundry-notes.js";

// One SVG unit follows the source plan's 1:60 scale at 144 pixels per inch.
export const PLAN_PIXELS_PER_CM = 2 * 72 / (2.54 * 60);
export const HOUSE_SIZE = Object.freeze({ width: 945, height: 1980 });
export const BALCONY_SINK = Object.freeze({ x: 582, y: 1757, width: 66, height: 62 });
export const EXTERIOR_PLATFORM = Object.freeze({
    x: 259.68, y: 1838.32, width: 557.04, height: 73.8,
});

function zone(id, coordinates, labelX, labelY, tone) {
    const points = Object.freeze(coordinates.map(([x, y]) => Object.freeze({ x, y })));
    const xs = points.map((point) => point.x);
    const ys = points.map((point) => point.y);
    const x = Math.min(...xs);
    const y = Math.min(...ys);
    return Object.freeze({
        id, x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y,
        path: `M${points.map((point) => `${point.x} ${point.y}`).join(" L")} Z`,
        points, labelX, labelY, tone,
    });
}

export function rectangularZone(id, x, y, width, height) {
    return zone(id, [[x, y], [x + width, y], [x + width, y + height], [x, y + height]],
        x + width / 2, y + height / 2, "utility");
}

function cubic(a, b, c, d) {
    return Array.from({ length: 33 }, (_, index) => {
        const t = index / 32;
        const u = 1 - t;
        return [0, 1].map((axis) => Math.round(100 * (
            u ** 3 * a[axis] + 3 * u ** 2 * t * b[axis] +
            3 * u * t ** 2 * c[axis] + t ** 3 * d[axis]
        )) / 100);
    });
}

const masterArc = cubic(
    [580.49, 38.82], [666.29, 14.62], [756.85, 57.06], [793.14, 138.49]
);

// Coordinates are inner wall faces from PDF page 1 after rotation: (1273 - pdfY, pdfX - 122).
export const HOUSE_ZONES = Object.freeze([
    zone("living-dining", [
        [352, 192], [569, 192], [569, 1045], [200, 1045],
        [200, 730], [291, 730], [291, 651], [231, 651],
        [231, 253], [321, 253], [321, 210], [352, 210],
    ], 391, 590, "living"),
    zone("entry", [[31, 902], [200, 902], [200, 1050], [31, 1050]],
        116, 981, "entry"),
    rectangularZone("corridor", 468, 1045, 101, 474),
    zone("master", [
        ...masterArc, [793, 192], [824, 192], [824, 211], [855, 211],
        [855, 655], [827, 655], [827, 717], [580, 717],
    ], 705, 395, "sleep"),
    rectangularZone("bath-main", 580, 728, 273, 156),
    zone("bedroom-1", [
        [580, 904], [853, 904], [853, 1213], [826, 1213], [826, 1238], [580, 1238],
    ], 711, 1100, "sleep"),
    zone("kitchen", [
        [580, 1251], [826, 1251], [826, 1284], [853, 1284], [853, 1407], [580, 1407],
    ], 715, 1350, "utility"),
    zone("studio", [
        [580, 1417], [854, 1417], [854, 1679], [800, 1679], [800, 1737], [580, 1737],
    ], 715, 1570, "work"),
    rectangularZone("balcony", 580, 1749, 274, 76),
    rectangularZone("ac-platform", EXTERIOR_PLATFORM.x, EXTERIOR_PLATFORM.y,
        EXTERIOR_PLATFORM.width, EXTERIOR_PLATFORM.height),
    rectangularZone("bedroom-2", 260, 1045, 208, 291),
    rectangularZone("bath-guest", 263, 1352, 194, 156),
    rectangularZone("bedroom-3", 260, 1519, 309, 306),
].map((entry) => {
    const labels = {
        "bath-main": [721, 810, "bath"],
        balcony: [676, 1790, "balcony"],
        "ac-platform": [535, 1882, "exterior"],
        "bedroom-2": [361, 1180, "sleep"],
        corridor: [518, 1282, "corridor"],
        "bath-guest": [359, 1430, "bath"],
        "bedroom-3": [412, 1660, "sleep"],
    };
    const label = labels[entry.id];
    return label ? Object.freeze({
        ...entry, labelX: label[0], labelY: label[1], tone: label[2],
    }) : entry;
}));

export const HOUSE_ZONE_BY_ID = new Map(HOUSE_ZONES.map((entry) => [entry.id, entry]));
export const ENTRY_LIVING_PASSAGE = Object.freeze({
    x: 200, yStart: 915, yEnd: 1020,
    label: "現況圖玄關－客餐廳木作拱門；開口位置依圖示意，淨寬與高度待現場核對",
});
export const ROOM_DRAWING_DIMENSIONS = Object.freeze({
    "bath-main": Object.freeze({ widthCm: 289, depthCm: 165, kind: "inner", source: "現況圖牆內緣" }),
    "bath-guest": Object.freeze({ widthCm: 205, depthCm: 165, kind: "inner", source: "現況圖牆內緣" }),
    master: Object.freeze({ widthCm: 291, depthCm: 725, kind: "bounds", source: "現況圖弧形外接輪廓" }),
    "bedroom-1": Object.freeze({ widthCm: 289, depthCm: 353.5, kind: "bounds", source: "現況圖牆內緣；角落有柱位" }),
    "bedroom-2": Object.freeze({ widthCm: 220, depthCm: 308, kind: "inferred", source: "新增隔間依 6.78㎡ 與相鄰原牆推算" }),
    corridor: Object.freeze({ widthCm: 107, depthCm: 502, kind: "bounds",
        source: "現況圖走廊外接跨度；新隔間與門洞待現場核對" }),
    "bedroom-3": Object.freeze({ widthCm: 327.5, depthCm: 324, kind: "inner", source: "現況圖牆內緣及 327.5cm 標註" }),
    "living-dining": Object.freeze({ widthCm: 391, depthCm: 903, kind: "bounds", source: "現況圖凹凸外接輪廓" }),
    kitchen: Object.freeze({ widthCm: 289, depthCm: 165, kind: "bounds", source: "現況圖牆內緣；角落有柱位" }),
    studio: Object.freeze({ widthCm: 290, depthCm: 338.5, kind: "bounds", source: "現況圖牆內緣；後側有柱位" }),
    balcony: Object.freeze({ widthCm: 290, depthCm: 81, kind: "inner", source: "現況圖牆內緣及 81cm 標註" }),
    "ac-platform": Object.freeze({ widthCm: 590, depthCm: 78, kind: "platform", source: "現況圖 U 形外推線；深度按圖面量繪" }),
    entry: Object.freeze({ widthCm: 179, depthCm: 157, kind: "bounds", source: "現況圖入口外接範圍" }),
});
for (const [id, measured] of Object.entries(ROOM_DRAWING_DIMENSIONS)) {
    const geometry = HOUSE_ZONE_BY_ID.get(id);
    if (!geometry || Math.abs(geometry.width / PLAN_PIXELS_PER_CM - measured.widthCm) > 1 ||
        Math.abs(geometry.height / PLAN_PIXELS_PER_CM - measured.depthCm) > 1) {
        throw new RangeError(`房間 ${id} 的圖面尺寸與輪廓不符。`);
    }
}
export const MASTER_ARC_POINTS = Object.freeze(HOUSE_ZONE_BY_ID.get("master").points.slice(0, 33));
export const CORRIDOR_PATH = "M468 1045 H569 V1519 H468 Z";
export const EXISTING_CURVED_BAY_PATH =
    "M569.2 30.38 C520.51 48.48 481.29 85.6 460.53 133.2 L460.53 173.4 H569.2 Z";

export function pointInZone(room, x, y) {
    if (!room?.points || !Number.isFinite(x) || !Number.isFinite(y)) return false;
    let inside = false;
    const { points } = room;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
        const a = points[j];
        const b = points[i];
        const cross = (x - a.x) * (b.y - a.y) - (y - a.y) * (b.x - a.x);
        if (Math.abs(cross) < 0.000001 &&
            x >= Math.min(a.x, b.x) && x <= Math.max(a.x, b.x) &&
            y >= Math.min(a.y, b.y) && y <= Math.max(a.y, b.y)) return true;
        if ((a.y > y) !== (b.y > y) &&
            x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) inside = !inside;
    }
    return inside;
}

export function footprintFits(room, x, y, width, height, item = null) {
    if (!(width > 0 && height > 0)) return false;
    const clearance = 0.75;
    const left = x - width / 2 - clearance;
    const top = y - height / 2 - clearance;
    const right = x + width / 2 + clearance;
    const bottom = y + height / 2 + clearance;
    if (left < room.x || right > room.x + room.width ||
        top < room.y || bottom > room.y + room.height) return false;
    if (room.id === "balcony" && !isConditionalFloorDryer(item) &&
        left < BALCONY_SINK.x + BALCONY_SINK.width &&
        right > BALCONY_SINK.x &&
        top < BALCONY_SINK.y + BALCONY_SINK.height &&
        bottom > BALCONY_SINK.y) return false;
    for (let ix = 0; ix <= 4; ix++) {
        for (let iy = 0; iy <= 4; iy++) {
            if (!pointInZone(room, left + (right - left) * ix / 4,
                top + (bottom - top) * iy / 4)) return false;
        }
    }
    return true;
}

export function nearestRoomCenter(room, x, y, width, height, item = null) {
    const clearance = 0.75;
    const minX = room.x + width / 2 + clearance;
    const maxX = room.x + room.width - width / 2 - clearance;
    const minY = room.y + height / 2 + clearance;
    const maxY = room.y + room.height - height / 2 - clearance;
    if (minX > maxX || minY > maxY) return null;
    const keepInsideBounds = (cx, cy) => ({
        x: Math.max(minX, Math.min(maxX, cx)),
        y: Math.max(minY, Math.min(maxY, cy)),
    });
    const start = keepInsideBounds(x, y);
    if (footprintFits(room, start.x, start.y, width, height, item)) return start;
    for (let radius = 2; radius <= 180 * PLAN_PIXELS_PER_CM; radius += 2) {
        let nearest = null;
        let distance = Infinity;
        for (let step = 0; step < 32; step++) {
            const angle = 2 * Math.PI * step / 32;
            const point = keepInsideBounds(start.x + radius * Math.cos(angle),
                start.y + radius * Math.sin(angle));
            const candidateDistance = Math.hypot(point.x - x, point.y - y);
            if (candidateDistance < distance &&
                footprintFits(room, point.x, point.y, width, height, item)) {
                nearest = point;
                distance = candidateDistance;
            }
        }
        if (nearest) return nearest;
    }
    return null;
}
