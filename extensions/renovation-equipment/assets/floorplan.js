import { FURNITURE_TEMPLATES } from "./furniture.js";
import { switchOptionFor } from "./switch-options.js";
import {
    isActiveSplitAirConditioner, isSplitAirConditioner, outdoorACFootprint,
    outdoorACPosition, outdoorACSceneConflict, outdoorACZone, OUTDOOR_AC_ESTIMATED_SIZE_CM,
    OUTDOOR_AC_ZONES,
} from "./ac-outdoors.js";
import {
    isBathGrabBar, isFreshAirUnit, isHeatedTowelRail, isToiletRinseKit,
} from "./bathroom-fixtures.js";
import { trackLengthCm } from "./track-lighting.js";
import { objectIconKind, renderObjectIcon } from "./plan-icons.js";
import { isUnknownDepthGuestTub } from "./guest-bath-plan.js";
import {
    KITCHEN_V_LAYOUT_TAG, KITCHEN_V_FILL_NOTE, kitchenDrawOrder, kitchenFillPattern,
} from "./kitchen-icons.js";
import { diagramPointSymbol } from "./outlet-diagram.js";
import { planDisplayCategory } from "./plan-visibility.js";
import {
    isDedicatedCircuit, isQuotedOutlet, isSocket, isWeakCurrent,
} from "./socket-plan.js";
import { isQuotedEquipment } from "./budget.js";
import { markerQuoteProvenance, quoteProvenance } from "./quote-provenance.js";
import {
    isConditionalFloorDryer, isConditionalOutboardSink, laundryMarkerNote,
} from "./laundry-notes.js";
import { renderLightingPreview } from "./lighting-preview.js";
import { previewCircuitLinks } from "./circuit-preview.js";
import { BEDROOM2_PARTITION_ID, BEDROOM2_PARTITION_OPTIONS } from "./partition-options.js";
import {
    BALCONY_SINK, CORRIDOR_PATH, EXISTING_CURVED_BAY_PATH,
    ENTRY_LIVING_PASSAGE, EXTERIOR_PLATFORM, HOUSE_SIZE, HOUSE_ZONES, HOUSE_ZONE_BY_ID,
    MASTER_ARC_POINTS,
    PLAN_PIXELS_PER_CM, ROOM_DRAWING_DIMENSIONS, footprintFits, rectangularZone,
} from "./house-geometry.js";

const doors = Object.freeze([
    { id: "entry-door", owner: "entry", roomIds: ["entry"], x: 31, y: 949,
        side: "left", length: 80, kind: "swing", label: "玄關大門（非本次門片報價）" },
    { id: "master", owner: "master", roomIds: ["master", "living-dining"],
        x: 575, y: 655, side: "left", length: 80, kind: "swing", label: "客餐廳－主臥門" },
    { id: "main-bath-master", owner: "bath-main", roomIds: ["bath-main", "master"],
        x: 621, y: 722, side: "top", length: 64, kind: "swing", label: "主臥－主浴門" },
    { id: "main-bath-hall", owner: "bath-main", roomIds: ["bath-main", "living-dining"],
        x: 575, y: 780, side: "left", length: 70, kind: "slide", label: "客餐廳－主浴拉門" },
    { id: "main-shower", owner: "bath-main", roomIds: ["bath-main"],
        x: 735, y: 760, side: "partition", length: 55, kind: "swing",
        glass: true, label: "主浴乾濕分離玻璃門" },
    { id: "bedroom-1", owner: "bedroom-1", roomIds: ["bedroom-1", "corridor"],
        x: 575, y: 1190, side: "left", length: 80, kind: "swing", label: "臥室1門（走道側）" },
    { id: "bedroom-2", owner: "bedroom-2", roomIds: ["bedroom-2", "corridor"],
        x: 468, y: 1154, side: "right", length: 70, kind: "slide", label: "臥室2拉門（走道側）" },
    { id: "guest-bath", owner: "bath-guest", roomIds: ["bath-guest", "corridor"],
        x: 463, y: 1469, side: "right", length: 70, kind: "swing", label: "客浴門（走道側）" },
    { id: "guest-shower", owner: "bath-guest", roomIds: ["bath-guest"],
        x: 339, y: 1485, side: "partition", length: 45, kind: "swing",
        glass: true, label: "客浴乾濕分離玻璃門" },
    { id: "bedroom-3", owner: "bedroom-3", roomIds: ["bedroom-3", "corridor"],
        x: 519, y: 1514, side: "top", length: 65, kind: "swing",
        label: "臥室3門（走道側）" },
    { id: "kitchen", owner: "kitchen", roomIds: ["kitchen", "corridor"],
        x: 575, y: 1365, side: "left", length: 75, kind: "swing", label: "廚房門（走道側）" },
    { id: "studio", owner: "studio", roomIds: ["studio", "corridor"],
        x: 575, y: 1457, side: "left", length: 70, kind: "swing",
        label: "工作室門（走道側）" },
    { id: "bedroom-3-studio", owner: "bedroom-3", roomIds: ["bedroom-3", "studio"],
        x: 575, y: 1692, side: "right", length: 85, kind: "slide",
        label: "臥室3－工作室新增拉門（未列門片報價）" },
    { id: "balcony", owner: "studio", roomIds: ["studio", "balcony"],
        x: 646, y: 1743, side: "bottom", length: 130, kind: "slide",
        label: "工作室－陽台拉門" },
]);

function wallWindow(id, roomId, x, y, widthCm, heightCm, side) {
    const roomNames = {
        master: "主臥", "living-dining": "客餐廳", "bath-main": "主浴",
        "bedroom-1": "臥室1", kitchen: "廚房", studio: "工作室",
        "bedroom-3": "臥室3",
    };
    const roomName = roomNames[roomId];
    if (!roomName) throw new RangeError(`未對應現況窗洞所屬空間：${roomId}`);
    if (!["top", "right", "bottom"].includes(side)) {
        throw new RangeError(`未對應現況窗洞所在牆面：${side}`);
    }
    const half = widthCm * PLAN_PIXELS_PER_CM / 2;
    const round = (value) => Math.round(value * 100) / 100;
    return {
        id, roomId, x, y, widthCm, heightCm, side,
        path: side === "right"
            ? `M${x} ${round(y - half)} V${round(y + half)}`
            : `M${round(x - half)} ${y} H${round(x + half)}`,
        label: `現況圖 W:${widthCm}/${heightCm}（${roomName}外牆）`,
    };
}

function curvedWindowPath(points, start, widthCm) {
    let remaining = widthCm * PLAN_PIXELS_PER_CM;
    const path = [points[start]];
    for (let index = start + 1; index < points.length && remaining > 0; index++) {
        const previous = path[path.length - 1];
        const next = points[index];
        const segment = Math.hypot(next.x - previous.x, next.y - previous.y);
        if (segment >= remaining) {
            const ratio = remaining / segment;
            path.push({
                x: Math.round((previous.x + (next.x - previous.x) * ratio) * 100) / 100,
                y: Math.round((previous.y + (next.y - previous.y) * ratio) * 100) / 100,
            });
            remaining = 0;
        } else {
            path.push(next);
            remaining -= segment;
        }
    }
    if (remaining > 0) throw new RangeError("現況弧窗長度超出外牆範圍。");
    return `M${path.map((point) => `${point.x} ${point.y}`).join(" L")}`;
}

const windows = Object.freeze([
    { id: "master-curve", roomId: "master",
        path: curvedWindowPath(MASTER_ARC_POINTS, 11, 51.5),
        x: MASTER_ARC_POINTS[15].x, y: MASTER_ARC_POINTS[15].y,
        widthCm: 51.5, heightCm: 156, side: "curve",
        label: "現況圖 W:51.5/156（主臥弧牆）" },
    wallWindow("master-right", "master", 855, 308, 40, 156, "right"),
    wallWindow("living-top", "living-dining", 518, 192, 51.5, 156, "top"),
    wallWindow("living-top-west", "living-dining", 410, 192, 117, 93, "top"),
    wallWindow("main-bath-right", "bath-main", 854, 784, 96, 111.5, "right"),
    wallWindow("bedroom-1-upper", "bedroom-1", 854, 1010, 50, 154.5, "right"),
    wallWindow("bedroom-1-lower", "bedroom-1", 854, 1145, 119, 88.5, "right"),
    wallWindow("kitchen-right", "kitchen", 854, 1345, 125, 84, "right"),
    wallWindow("studio-upper", "studio", 854, 1488, 118, 91, "right"),
    wallWindow("studio-lower", "studio", 854, 1646, 54, 156, "right"),
    wallWindow("bedroom-3-end", "bedroom-3", 454, 1825, 124, 140, "bottom"),
]);

const BATH_DIVIDERS = Object.freeze({
    "bath-main": { x: 735, top: 735, bottom: 876, labelX: 796, labelY: 859,
        label: "淋浴區", doorId: "main-shower" },
    "bath-guest": { x: 339, top: 1359, bottom: 1500, labelX: 299, labelY: 1400,
        label: "浴缸區", doorId: "guest-shower" },
});

export const knownRoomIds = new Set(HOUSE_ZONES.map((entry) => entry.id));
export const planDoors = doors;
export const planWindows = windows;
const ICON_SCALE = 1.7;
const ROTATE_HANDLE_OFFSET = 8 * ICON_SCALE;
const ROTATE_HIT_RADIUS = 7.5 * ICON_SCALE;
const WALL_HEATER_MARKER = Object.freeze({ width: 46, height: 10 });
const DEFAULT_VISIBLE_LAYERS = Object.freeze({
    furniture: true, lights: true, switches: true, outlets: true,
});

function markerVisible(item, visibleLayers) {
    if (!visibleLayers || ["furniture", "lights", "switches", "outlets"].some(
        (key) => typeof visibleLayers[key] !== "boolean")) {
        throw new TypeError("格局圖顯示設定須包含家具、燈、開關與插座。");
    }
    const category = planDisplayCategory(item);
    if (category === "structure") return true;
    if (category === "outlets") return visibleLayers.outlets;
    if (category === "lights") return visibleLayers.lights;
    if (category === "switches") {
        return visibleLayers.switches && item.switchPlanStatus !== "removed";
    }
    return visibleLayers.furniture;
}

function renderCircuitPairings(geometry, items) {
    const sockets = new Map(items.filter((item) => isSocket(item) && item.placement)
        .map((item) => [item.id, item]));
    const paths = items.filter((item) => isDedicatedCircuit(item) && item.placement)
        .map((circuit) => {
            const socket = sockets.get(circuit.circuitOutletId);
            if (!socket) return "";
            const from = markerPosition(circuit, geometry);
            const to = markerPosition(socket, geometry);
            return `<path data-circuit-link-id="${escapeSvg(circuit.id)}"
                d="M${from.x} ${from.y} L${to.x} ${to.y}"/>`;
        }).join("");
    return paths ? `<g class="dedicated-circuit-links" aria-hidden="true">
        ${paths}</g>` : "";
}

export function isBalconyHeaterPlaceholder(item) {
    return item.kind === "equipment" && item.id === "balcony-water-heater" &&
        item.roomId === "balcony" && !(item.widthCm && item.depthCm);
}

export function roomGeometry(room) {
    const traced = HOUSE_ZONE_BY_ID.get(room?.id);
    if (traced) {
        return { ...traced, left: traced.x, top: traced.y,
            cmScale: PLAN_PIXELS_PER_CM, traced: true,
            ceilingHeightCm: room.ceilingHeightCm ?? null };
    }
    if (!room) throw new TypeError("房間不存在，無法繪製格局。");
    const cmScale = room.widthCm && room.depthCm
        ? Math.min(PLAN_PIXELS_PER_CM, 480 / room.widthCm, 480 / room.depthCm) : null;
    const fallback = rectangularZone(room.id, 50, 50,
        cmScale ? room.widthCm * cmScale : 180,
        cmScale ? room.depthCm * cmScale : 140);
    return { ...fallback, left: fallback.x, top: fallback.y, cmScale, traced: false,
        ceilingHeightCm: room.ceilingHeightCm ?? null };
}

export function doorsForRoom(roomId) {
    return doors.filter((door) => door.roomIds.includes(roomId));
}

export function windowsForRoom(roomId) {
    return windows.filter((window) => window.roomId === roomId);
}

function entryLivingWall(geometry) {
    if (geometry.id !== "entry" && geometry.id !== "living-dining") return "";
    const { x, yStart, yEnd } = ENTRY_LIVING_PASSAGE;
    const points = geometry.points;
    const edge = points.findIndex((point, index) => {
        const next = points[(index + 1) % points.length];
        return point.x === x && next.x === x &&
            Math.min(point.y, next.y) < yStart &&
            Math.max(point.y, next.y) > yEnd;
    });
    if (edge < 0) throw new RangeError("玄關與客餐廳未找到共用牆，無法保留拱門開口。");
    const ascending = points[edge].y < points[(edge + 1) % points.length].y;
    const path = [`M${x} ${ascending ? yEnd : yStart}`];
    for (let step = 1; step <= points.length; step++) {
        const point = points[(edge + step) % points.length];
        path.push(`L${point.x} ${point.y}`);
    }
    path.push(`L${x} ${ascending ? yStart : yEnd}`);
    return `<path class="entry-living-wall" d="${path.join(" ")}"/>`;
}

function renderEntryLivingPassage(overview, interactive = true) {
    const { x, yStart, yEnd, label } = ENTRY_LIVING_PASSAGE;
    const y = (yStart + yEnd) / 2;
    return `<g class="${overview ? "plan-passage" : "detail-passage"}"
        ${overview && interactive ? `data-select-room="entry" role="button" tabindex="0"
            aria-label="${escapeSvg(label)}"` : 'aria-hidden="true" pointer-events="none"'}>
        <title>${escapeSvg(label)}；玄關外側大門仍在原位，不新增門片報價</title>
        ${overview ? `<rect class="passage-hitbox" x="${x - 15}" y="${y - 19}"
            width="30" height="38"/>` : ""}
        <text x="${x}" y="${y + 5}" text-anchor="middle">
            ${overview ? "拱" : "拱門"}</text>
    </g>`;
}

function itemDimensions(item, template) {
    return {
        widthCm: item.widthCm === undefined ? template?.widthCm ?? null : item.widthCm,
        depthCm: item.depthCm === undefined ? template?.depthCm ?? null : item.depthCm,
    };
}

export function itemFootprint(item, geometry) {
    if (item.kind === "door") return null;
    if (isUnknownDepthGuestTub(item)) {
        const width = item.widthCm *
            (geometry.cmScale ?? PLAN_PIXELS_PER_CM);
        return [90, 270].includes(item.orientation)
            ? { width: 28, height: width } : { width, height: 28 };
    }
    if (item.outletPlanPointId) return { width: 12, height: 12 };
    if (planDisplayCategory(item) === "outlets") return { width: 18, height: 18 };
    if (isFreshAirUnit(item)) {
        return [90, 270].includes(item.orientation)
            ? { width: 28, height: 32 } : { width: 32, height: 28 };
    }
    if (isToiletRinseKit(item)) return { width: 20, height: 20 };
    if (isHeatedTowelRail(item) || isBathGrabBar(item)) {
        const width = isHeatedTowelRail(item) ? 30 : 34;
        return [90, 270].includes(item.orientation)
            ? { width: isHeatedTowelRail(item) ? 10 : 12, height: width }
            : { width, height: isHeatedTowelRail(item) ? 10 : 12 };
    }
    if (item.switchType) return { width: 24, height: 24 };
    if (item.lightType === "recessed") return { width: 24, height: 24 };
    if (item.lightType === "ceiling") return { width: 36, height: 36 };
    if (item.lightType === "track") {
        const length = item.trackLengthCm *
            (geometry.cmScale ?? PLAN_PIXELS_PER_CM);
        return [90, 270].includes(item.orientation)
            ? { width: length, height: 30 } : { width: 30, height: length };
    }
    if (isSplitAirConditioner(item) || item.name.includes("冷氣")) {
        return [0, 180].includes(item.orientation)
            ? { width: 18 * ICON_SCALE, height: 42 * ICON_SCALE }
            : { width: 42 * ICON_SCALE, height: 18 * ICON_SCALE };
    }
    if (isBalconyHeaterPlaceholder(item)) {
        return [90, 270].includes(item.orientation)
            ? { width: WALL_HEATER_MARKER.height, height: WALL_HEATER_MARKER.width }
            : WALL_HEATER_MARKER;
    }
    const template = FURNITURE_TEMPLATES[objectIconKind(item)] ?? null;
    const { widthCm, depthCm } = itemDimensions(item, template);
    const width = widthCm && depthCm && geometry.cmScale
        ? widthCm * geometry.cmScale : 22 * ICON_SCALE;
    const height = widthCm && depthCm && geometry.cmScale
        ? depthCm * geometry.cmScale : 22 * ICON_SCALE;
    return [90, 270].includes(item.orientation)
        ? { width: height, height: width } : { width, height };
}

export function placementFootprint(item, geometry) {
    const footprint = itemFootprint(item, geometry);
    if (!footprint) return null;
    if (item.markerStyle === "square-label") return footprint;
    if (isFreshAirUnit(item) || isToiletRinseKit(item) ||
        isHeatedTowelRail(item) || isBathGrabBar(item) || item.switchType ||
        planDisplayCategory(item) === "outlets" ||
        item.lightType === "recessed" ||
        item.lightType === "ceiling" || item.lightType === "track" ||
        isBalconyHeaterPlaceholder(item)) return footprint;
    if (isSplitAirConditioner(item) || item.name.includes("冷氣") || !geometry.cmScale ||
        item.kind === "equipment" && !(item.widthCm && item.depthCm)) {
        return { width: 1, height: 1 };
    }
    return footprint;
}

export function markerPosition(item, geometry) {
    return { x: geometry.x + item.placement.x * geometry.width,
        y: geometry.y + item.placement.y * geometry.height };
}

export function guestVanityAssessment(items, geometry) {
    const ids = ["bath-guest-vanity", "bath-guest-tub", "bath-guest-toilet"];
    const fixtures = ids.map((id) => items.find((item) => item.id === id &&
        item.roomId === "bath-guest"));
    const vanity = fixtures[0];
    if (!vanity) return null;
    const caution = "客浴壁掛浴櫃僅條件式圖面暫位，非可施工配置；" +
        "圖面移動不代表給排水或牆體錨固已核准搬移。" +
        "門扇、浴缸／馬桶、磁磚完成面、固定承重及管線仍須現場實測。";
    if (!geometry.cmScale || fixtures.some((item) =>
        !item?.placement || !item.widthCm || !item.depthCm)) {
        const [, tub, toilet] = fixtures;
        if (geometry.cmScale && isUnknownDepthGuestTub(tub) &&
            [0, 180].includes(tub.orientation) &&
            fixtures.every((item) => item?.placement) &&
            vanity.widthCm && vanity.depthCm &&
            toilet.widthCm && toilet.depthCm) {
            const horizontal = (item, width) => {
                const center = item.placement.x *
                    geometry.width / geometry.cmScale;
                return { left: center - width / 2,
                    right: center + width / 2 };
            };
            const tubX = horizontal(tub, tub.widthCm);
            const cabinetSize = itemFootprint(vanity, geometry);
            const toiletSize = itemFootprint(toilet, geometry);
            const cabinetX = horizontal(vanity,
                cabinetSize.width / geometry.cmScale);
            const toiletX = horizontal(toilet,
                toiletSize.width / geometry.cmScale);
            const cabinetY = markerPosition(vanity, geometry).y;
            const toiletY = markerPosition(toilet, geometry).y;
            const toiletConflict = cabinetX.left < toiletX.right &&
                cabinetX.right > toiletX.left &&
                Math.abs(cabinetY - toiletY) <
                    (cabinetSize.height + toiletSize.height) / 2;
            return {
                incomplete: true, conflict: toiletConflict,
                tubDepthUnknown: true,
                warning: `${caution} 浴缸深度／高度未定，80cm僅水平區段，` +
                    "虛線帶不是實際占地；" +
                    `浴櫃${vanity.widthCm}×${vanity.depthCm}cm仍是條件目標。` +
                    `僅按圖面水平投影：浴缸區右緣約${tubX.right.toFixed(1)}cm、` +
                    `浴櫃左緣約${cabinetX.left.toFixed(1)}cm；` +
                    "無法判定浴缸完整占地、門扇或膝腿淨空，" +
                    "不以未見重疊認定能安裝。" +
                    (toiletConflict ? "浴櫃與馬桶已知圖示占地仍相交，須重新核對。" : ""),
            };
        }
        return { incomplete: true, conflict: false,
            warning: `${caution} 尺寸或標位尚未齊全，深度／淨距未定，不能確認間隙。` };
    }
    const [cabinet, tub, toilet] = fixtures.map((item) => {
        const point = markerPosition(item, geometry);
        const size = placementFootprint(item, geometry);
        return {
            left: (point.x - geometry.x - size.width / 2) / geometry.cmScale,
            right: (point.x - geometry.x + size.width / 2) / geometry.cmScale,
            top: (point.y - geometry.y - size.height / 2) / geometry.cmScale,
            bottom: (point.y - geometry.y + size.height / 2) / geometry.cmScale,
        };
    });
    const overlaps = (other) => cabinet.top < other.bottom && cabinet.bottom > other.top
        ? Math.max(0, Math.min(cabinet.right, other.right) - Math.max(cabinet.left, other.left)) : 0;
    const tubOverlapCm = overlaps(tub);
    const toiletOverlapCm = overlaps(toilet);
    const gapCm = toilet.left - tub.right;
    const centerXCm = (tub.right + toilet.left) / 2;
    const moveXCm = centerXCm - (cabinet.left + cabinet.right) / 2;
    const sideClearanceCm = (gapCm - (cabinet.right - cabinet.left)) / 2;
    const cm = (value) => value.toFixed(2);
    const overlapText = [
        tubOverlapCm > 0 ? `與浴缸圖示水平重疊約${cm(tubOverlapCm)}cm` : "",
        toiletOverlapCm > 0 ? `與馬桶圖示水平重疊約${cm(toiletOverlapCm)}cm` : "",
    ].filter(Boolean).join("、");
    const comparison = gapCm > 0 && sideClearanceCm >= 0
        ? `僅作比較：若置中，左右各約${cm(sideClearanceCm)}cm，中心距房間左緣約${cm(centerXCm)}cm` +
            `（相對現位${moveXCm >= 0 ? "向右" : "向左"}約${cm(Math.abs(moveXCm))}cm），不自動套用且非建議施工定位。`
        : "目前寬度無法在該橫向間隙置中，不提供自動定位。";
    return { gapCm, centerXCm, moveXCm, sideClearanceCm, tubOverlapCm, toiletOverlapCm,
        conflict: tubOverlapCm > 0 || toiletOverlapCm > 0,
        warning: `${caution} 目前寬${vanity.widthCm}×深${vanity.depthCm}cm；` +
            `按目前圖示寬${cm(geometry.width / geometry.cmScale)}cm、轉向與占地，浴缸右緣約${cm(tub.right)}cm、馬桶左緣約${cm(toilet.left)}cm，` +
            `橫向間隙約${cm(gapCm)}cm。${overlapText ? `${overlapText}，原位保留待核。` :
                "未見這兩個圖示的占地重疊，不等於淨空、管線或施工已核可。"}${comparison}` };
}

function escapeSvg(value) {
    return String(value ?? "").replace(/[&<>"']/g, (character) => ({
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[character]);
}

function quoteMarkerAttributes(source) {
    return source ? `data-quote-provenance="${escapeSvg(source)}"
        aria-description="${escapeSvg(source)}"` : "";
}

export function renderReferenceSchematic(rooms, {
    proposed = false, labels = true, windowsVisible = true, doorsVisible = true,
} = {}) {
    const roomNames = new Map(rooms.map((room) => [room.id, room.name]));
    const partition = HOUSE_ZONE_BY_ID.get("bedroom-2");
    return `<g class="reference-schematic" aria-hidden="true">
        <path class="reference-bay" d="${EXISTING_CURVED_BAY_PATH}"/>
        ${HOUSE_ZONES.map((zone) => `<path class="reference-zone" d="${zone.path}"/>
            ${labels && roomNames.has(zone.id) ? `<text class="reference-room-label"
                x="${zone.labelX}" y="${zone.labelY}" text-anchor="middle"
                ${zone.id === "corridor"
                    ? `transform="rotate(-90 ${zone.labelX} ${zone.labelY})"` : ""}>
                ${escapeSvg(roomNames.get(zone.id))}</text>` : ""}`).join("")}
        <path class="reference-passage" d="M${ENTRY_LIVING_PASSAGE.x}
            ${ENTRY_LIVING_PASSAGE.yStart} V${ENTRY_LIVING_PASSAGE.yEnd}"/>
        ${proposed ? `<path class="reference-partition"
            d="M${partition.x} ${partition.y} H${partition.x + partition.width}
                V${partition.y + partition.height}"/>` : ""}
        ${windowsVisible ? windows.map((window) =>
            `<g class="reference-window"><title>${escapeSvg(window.label)}</title>
                <path d="${window.path}"/>
                <text x="${window.x + 12}" y="${window.y - 12}">W${window.widthCm}</text>
            </g>`).join("") : ""}
        ${doorsVisible ? doors.map((door) =>
            `<g class="reference-door"><title>${escapeSvg(door.label)}</title>
                <circle cx="${door.x}" cy="${door.y}" r="14"/>
                <text x="${door.x}" y="${door.y + 5}" text-anchor="middle">
                    ${door.glass ? "玻" : door.kind === "slide" ? "拉" : "門"}</text>
            </g>`).join("") : ""}
    </g>`;
}

export function renderReferenceSvg(rooms, options = {}) {
    return `<svg class="reference-svg" viewBox="0 0 ${HOUSE_SIZE.width} ${HOUSE_SIZE.height}"
        role="img" aria-label="依規劃幾何重新繪製的房間、窗洞及門位示意圖">
        ${renderReferenceSchematic(rooms, options)}
    </svg>`;
}

function squareLabelText(item, overview) {
    const label = isDedicatedCircuit(item) ? "迴" : item.switchType
        ? item.switchType === "single" ? "單" : "雙"
        : item.outletCircuit
            ? "座"
            : item.lightType
                ? ({ recessed: "崁", ceiling: "頂", track: "軌" })[item.lightType]
                : Array.from(item.name.trim()).slice(0, overview ? 1 : 2).join("");
    return label || "新";
}

function squareLabelSymbol(item, size, overview) {
    const label = squareLabelText(item, overview);
    const half = size / 2;
    return `<g class="square-label-body" transform="rotate(${item.orientation ?? 0})">
        <rect class="square-label-plate" x="${-half}" y="${-half}"
            width="${size}" height="${size}" rx="2"/>
        <path class="square-label-direction" d="M-4 ${-half + 4} H4"/>
    </g>
    <text class="square-label-text ${label.length > 1 ? "long" : ""}
        ${label.length > 1 && size < 25 ? "compact" : ""}"
        y="${overview ? 3.5 : 4.5}"
        font-size="${overview ? 11 : label.length > 1 ? 12 : 16}"
        text-anchor="middle">${escapeSvg(label)}</text>`;
}

function usesSquareLabel(item, iconKind) {
    if (item.markerStyle !== "square-label") return false;
    return !(iconKind || planDisplayCategory(item) === "outlets" ||
        switchOptionFor(item) || ["recessed", "ceiling", "track"].includes(item.lightType) ||
        isFreshAirUnit(item) || isToiletRinseKit(item) || isHeatedTowelRail(item) ||
        isBathGrabBar(item) || isBalconyHeaterPlaceholder(item) ||
        isSplitAirConditioner(item) || item.name?.includes("冷氣"));
}

function trackLightingSymbol(item, scale = PLAN_PIXELS_PER_CM) {
    const railLength = trackLengthCm(item.trackLengthCm);
    if (!Number.isSafeInteger(item.spotlightQuantity) ||
        item.spotlightQuantity < 0 || item.spotlightQuantity > 12) {
        throw new RangeError("走廊軌道燈長度或燈具數量無效，無法繪圖。");
    }
    const length = railLength * scale;
    const half = length / 2;
    const lamps = Array.from({ length: item.spotlightQuantity }, (_, index) => {
        const y = (index + 0.5) / item.spotlightQuantity * length - half;
        const radius = Math.min(11, length / (item.spotlightQuantity + 1) * 0.35);
        return `<circle class="track-lamp" cy="${y}" r="${radius}"/>
            <circle class="track-lamp-core" cy="${y}" r="${Math.max(1, radius / 4)}"/>`;
    }).join("");
    return `<path class="track-rail" d="M0 ${-half} V${half}
            M-12 ${-half} H12 M-12 ${half} H12"/>
        ${lamps}
        <circle class="track-rail-start" cy="${-half + 8}" r="3"/>
        <path class="track-hitbox" d="M0 ${-half} V${half}"/>`;
}

function socketSymbol(item, compact = false) {
    const size = compact ? 14 : 18;
    const orientation = item.orientation ?? 0;
    return `<g class="socket-body" transform="rotate(${orientation})">
        <rect class="socket-plate" x="${-size / 2}" y="${-size / 2}"
            width="${size}" height="${size}" rx="3"/>
        <path class="socket-orientation" d="M-4 ${-size / 2 + 2} H4"/>
        <path class="socket-holes"
            d="M-3 -3 V0 M3 -3 V0"/>
        <circle class="socket-ground" cx="0" cy="4" r="1.1"/>
    </g>`;
}

function directionName(orientation) {
    return ({ 0: "向右", 90: "向下", 180: "向左", 270: "向上" })[orientation] ?? "未指定";
}

function selectedDoor(door, items) {
    const choice = items.find((item) => item.kind === "door" && item.doorId === door.id);
    return choice ? {
        ...door, kind: choice.doorOpeningKind, quoted: true,
        length: choice.widthCm ? choice.widthCm * PLAN_PIXELS_PER_CM : door.length,
        widthCm: choice.widthCm ?? null, heightCm: choice.heightCm ?? null,
        material: choice.doorMaterial, materialLabel: choice.brandModel,
    } : {
        ...door, quoted: false, widthCm: null, heightCm: null,
        material: "unquoted", materialLabel: "未列門片報價",
    };
}

function doorShape(door) {
    const { x, y, length, side } = door;
    const half = length / 2;
    if (door.glass) {
        return `<path class="glass-door-edge" d="M${x} ${y - half} V${y + half}"/>
            <path class="glass-door-${door.kind}" d="${door.kind === "slide"
                ? `M${x - 4} ${y - half} V${y + half} M${x + 4} ${y - half} V${y + half}`
                : `M${x} ${y - half} H${x + length}
                    A${length} ${length} 0 0 1 ${x} ${y + half}`}"/>`;
    }
    const vertical = side === "left" || side === "right";
    const gap = vertical
        ? `M${x} ${y - half} V${y + half}` : `M${x - half} ${y} H${x + half}`;
    const slide = vertical
        ? `M${x - 4} ${y - half} V${y + half - 7}
            M${x + 4} ${y - half + 7} V${y + half}`
        : `M${x - half} ${y - 4} H${x + half - 12}
            M${x - half + 12} ${y + 4} H${x + half}`;
    const verticalDirection = side === "right" ? -1 : 1;
    const horizontalDirection = side === "bottom" ? -1 : 1;
    const swing = vertical
        ? `M${x} ${y - half} H${x + verticalDirection * length}
            A${length} ${length} 0 0 ${verticalDirection === 1 ? 1 : 0} ${x} ${y + half}`
        : `M${x - half} ${y} V${y + horizontalDirection * length}
            A${length} ${length} 0 0 ${horizontalDirection === 1 ? 0 : 1} ${x + half} ${y}`;
    return `<path class="door-opening" d="${gap}"/>
        <path class="${door.kind === "slide" ? "door-slide" : "door-swing"}"
            d="${door.kind === "slide" ? slide : swing}"/>`;
}

function renderDoorDimension(door) {
    const half = door.length / 2;
    const vertical = ["left", "right", "partition"].includes(door.side);
    const measured = Number.isFinite(door.widthCm) && door.widthCm > 0;
    const label = measured ? `寬 ${dimensionCm(door.widthCm)} cm` : null;
    let path;
    let labelX;
    let labelY;
    if (vertical) {
        const lineX = door.x + (door.side === "right" || door.side === "partition" ? 18 : -18);
        const y0 = door.y - half;
        const y1 = door.y + half;
        const head = Math.min(7, door.length / 5);
        path = `M${lineX} ${y0} V${y1}
            M${lineX - 4} ${y0 + head} L${lineX} ${y0} L${lineX + 4} ${y0 + head}
            M${lineX - 4} ${y1 - head} L${lineX} ${y1} L${lineX + 4} ${y1 - head}`;
        labelX = lineX;
        labelY = y0 - 10;
    } else {
        const lineY = door.y + (door.side === "top" ? 16 : -16);
        const x0 = door.x - half;
        const x1 = door.x + half;
        const head = Math.min(7, door.length / 5);
        path = `M${x0} ${lineY} H${x1}
            M${x0 + head} ${lineY - 4} L${x0} ${lineY} L${x0 + head} ${lineY + 4}
            M${x1 - head} ${lineY - 4} L${x1} ${lineY} L${x1 - head} ${lineY + 4}`;
        labelX = door.x;
        labelY = lineY + (door.side === "top" ? 19 : -10);
    }
    return `<g class="door-width-dimension ${measured ? "measured" : "unmeasured"}"
        data-door-id="${escapeSvg(door.id)}"
        data-width-cm="${door.widthCm ?? ""}"
        aria-label="${escapeSvg(door.label)}：${measured ?
            `門洞淨寬 ${door.widthCm} 公分` : "門洞淨寬待現場量測，圖上開口長度僅示意"}">
        <path d="${path}"/>
        ${measured ? `<text x="${labelX}" y="${labelY}"
            text-anchor="middle">${label}</text>` : ""}
    </g>`;
}

function renderDoor(door, items, overview, showDimension = true, interactive = true) {
    const chosen = selectedDoor(door, items);
    const item = items.find((entry) => entry.kind === "door" && entry.doorId === door.id);
    const source = markerQuoteProvenance(item, items);
    const icon = chosen.glass ? "玻" : chosen.kind === "slide" ? "拉" : "門";
    return `<g class="${overview ? "plan-door-mark" : "detail-door"}
        ${chosen.kind} ${chosen.glass ? "glass" : ""} ${chosen.quoted ? "" : "unpriced"}
        material-${escapeSvg(chosen.material)}"
        data-door-material="${escapeSvg(chosen.material)}"
        ${quoteMarkerAttributes(source)}
        ${overview && interactive ? `data-select-room="${escapeSvg(chosen.owner)}"
            role="button" tabindex="0"` : source ? 'role="img" tabindex="0"' : ""}
        aria-label="${escapeSvg(chosen.label)}（${escapeSvg(chosen.materialLabel)}；
            ${chosen.quoted ? "已列原報價" : "未列門片報價"}）">
        <title>${escapeSvg(chosen.label)}；${escapeSvg(chosen.materialLabel)}；
            ${chosen.widthCm ?
            `門洞淨寬 ${chosen.widthCm}cm` : "門洞淨寬待量，開口線僅示意"}；
            ${chosen.heightCm ? `門洞淨高 ${chosen.heightCm}cm` : "門高待確認"}；
            ${chosen.quoted ? "原報價已有此門片，門型變更需重新估價" :
                "新增或既有入口，未列入本次門片報價"}${source ? `；${escapeSvg(source)}` : ""}</title>
        ${doorShape(chosen)}
        ${overview ? `<rect class="door-hitbox" x="${chosen.x - 18}" y="${chosen.y - 18}"
            width="36" height="36"/>
            <text class="door-overview-label" x="${chosen.x}" y="${chosen.y + 6}"
                text-anchor="middle">${icon}</text>` :
            showDimension ? renderDoorDimension(chosen) : ""}
    </g>`;
}

function renderWindow(window, overview, interactive = true) {
    return `<g class="${overview ? "plan-window-mark" : "detail-window"}"
        ${overview && interactive ? `data-select-room="${escapeSvg(window.roomId)}"
            role="button" tabindex="0"` : ""}
        aria-label="${escapeSvg(window.label)}">
        <title>${escapeSvg(window.label)}；準確洞口須以現場丈量核對</title>
        <path class="window-opening" d="${window.path}"/>
        <path class="window-glass" d="${window.path}"/>
    </g>`;
}

function renderBedroom2Partition(items, interactive = true) {
    const partition = items.find((item) => item.id === BEDROOM2_PARTITION_ID);
    if (!partition) return "";
    const option = BEDROOM2_PARTITION_OPTIONS[partition.partitionMaterial];
    const source = quoteProvenance(partition);
    if (!option) throw new RangeError("臥室2輕隔間做法無效，無法標示牆線。");
    const zone = HOUSE_ZONE_BY_ID.get("bedroom-2");
    const door = doors.find((entry) => entry.id === "bedroom-2");
    if (!zone || !door) throw new RangeError("臥室2隔間牆或走道門缺少圖面座標。");
    const right = zone.x + zone.width;
    const bottom = zone.y + zone.height;
    const chosenDoor = selectedDoor(door, items);
    const gapStart = Math.max(zone.y, chosenDoor.y - chosenDoor.length / 2 - 10);
    const gapEnd = Math.min(bottom, chosenDoor.y + chosenDoor.length / 2 + 10);
    const hit = [
        `M${zone.x} ${zone.y} H${right}`,
        gapStart > zone.y ? `M${right} ${zone.y} V${gapStart}` : "",
        gapEnd < bottom ? `M${right} ${gapEnd} V${bottom}` : "",
    ].filter(Boolean).join(" ");
    return `<g class="partition-walls material-${escapeSvg(partition.partitionMaterial)}"
        ${interactive ? `data-select-partition="${BEDROOM2_PARTITION_ID}"
            role="button" tabindex="0"` : 'role="img"'}
        ${quoteMarkerAttributes(source)}
        aria-label="臥室2對客廳和走廊兩道輕隔間共用${escapeSvg(option.label)}，
            合計${escapeSvg(partition.quantity ?? "待填")}坪${interactive ?
                "；點選調整做法" : ""}">
        <title>臥室2兩道輕隔間：${escapeSvg(option.label)}；
            原報價合計 5 坪，線條顏色和粗細不是施工牆厚；${escapeSvg(source)}</title>
        <path class="partition-wall-core"
            d="M${zone.x} ${zone.y} H${right} M${right} ${zone.y} V${bottom}"/>
        <path class="partition-wall-inner"
            d="M${zone.x} ${zone.y + 6} H${right - 6}
                M${right - 6} ${zone.y + 6} V${bottom}"/>
        <path class="partition-wall-hit" d="${hit}"/>
    </g>`;
}

function renderBalconySink() {
    const { x, y, width, height } = BALCONY_SINK;
    const centerX = x + width / 2;
    const centerY = y + height / 2;
    const oldX = centerX - height / 2;
    const oldY = centerY - width / 2;
    return `<g class="fixed-balcony-sink" role="img"
        aria-label="現況後陽台泥作水槽，已按屋主指示旋轉90度；原報價列拆除，是否保留待確認">
        <title>現況圖標示泥作水槽 H:85；朝向按屋主指示旋轉90度，
            大小仍為圖上暫描，原報價列入拆除範圍</title>
        <g transform="rotate(90 ${centerX} ${centerY})">
            <rect class="sink-base" x="${oldX}" y="${oldY}"
                width="${height}" height="${width}" rx="2"/>
            <rect class="sink-bowl" x="${oldX + 5}" y="${oldY + 4}"
                width="${height - 10}" height="${width - 14}" rx="5"/>
            <circle class="sink-drain" cx="${centerX}" cy="${oldY + 15}" r="2"/>
        </g>
        <text x="${centerX}" y="${y + height - 3}"
            text-anchor="middle">水槽</text>
    </g>`;
}

function renderBalconyDemolition(items) {
    if (!items.some(isConditionalFloorDryer)) return "";
    const { x, y, width, height } = BALCONY_SINK;
    return `<g class="balcony-demolition" data-demolition-status="proposed" role="img"
        aria-label="現況泥作水槽擬拆、須核價／許可；舊占地仍保留，尚未拆除">
        <title>條件式烘衣機重疊歷史水槽占地，不代表水槽已拆或取得施工許可</title>
        <rect x="${x}" y="${y}" width="${width}" height="${height}"/>
        <text x="${x}" y="${y - 12}">現況水槽擬拆・須核價／許可</text>
    </g>`;
}

function renderExteriorPlatform(detail = false, items = []) {
    const { x, y, width, height } = EXTERIOR_PLATFORM;
    const hasDryer = items.some((item) =>
        item.roomId === "ac-platform" && item.furnitureType === "dryer");
    const hasSink = items.some(isConditionalOutboardSink);
    const bars = Array.from({ length: Math.floor(width / 35) }, (_, index) =>
        `M${x + (index + 1) * 35} ${y + height - 11} V${y + height}`).join(" ");
    return `<g class="exterior-platform" role="img"
        aria-label="現況圖外側連續 U 形輪廓；室外機${hasDryer ? "及烘衣機" : ""}${hasSink ? "及洗衣盆" : ""}討論暫位，鐵窗承重未確認">
        <title>現況圖外推輪廓跨臥室3及陽台；約 590×78cm 是圖面量繪，
            圖紙未標示鐵窗材質、承重或許可，尚不可認定能放室外機${hasDryer ? "或烘衣機" : ""}${hasSink ? "或洗衣盆；盆體需要獨立可靠混凝土支撐" : ""}。</title>
        <path class="platform-outline"
            d="M${x} ${y} V${y + height} H${x + width} V${y}"/>
        <path class="platform-bars" d="${bars}"/>
        ${detail ? `<text class="platform-adjacent" x="414" y="1828"
            text-anchor="middle">臥室3外側</text>
            <text class="platform-adjacent" x="622" y="1828"
                text-anchor="middle">陽台外側</text>` : ""}
    </g>`;
}

function overviewMarker(item, geometry, name, previewEnabled = false, items = []) {
    const source = markerQuoteProvenance(item, items);
    const vanity = item.id === "bath-guest-vanity" ? guestVanityAssessment(items, geometry) : null;
    const { x, y } = markerPosition(item, geometry);
    const { width, height } = itemFootprint(item, geometry);
    const circuit = isDedicatedCircuit(item);
    const socket = !circuit && !isWeakCurrent(item) && planDisplayCategory(item) === "outlets";
    const airConditioner = !socket && !circuit &&
        (isSplitAirConditioner(item) || item.name.includes("冷氣"));
    const wallHeater = isBalconyHeaterPlaceholder(item);
    const switchOption = switchOptionFor(item);
    const freshAir = isFreshAirUnit(item);
    const rinseKit = isToiletRinseKit(item);
    const towelRail = isHeatedTowelRail(item);
    const grabBar = isBathGrabBar(item);
    const downlight = item.lightType === "recessed";
    const ceilingLight = item.lightType === "ceiling";
    const trackLight = item.lightType === "track";
    const iconKind = objectIconKind(item);
    const squareLabel = circuit || usesSquareLabel(item, iconKind);
    if (item.switchType && !switchOption) throw new RangeError("圖上開關型式無效。");
    const dimensions = itemDimensions(item, FURNITURE_TEMPLATES[iconKind]);
    const actualFootprint = isUnknownDepthGuestTub(item) ||
        Boolean(geometry.cmScale &&
        dimensions.widthCm && dimensions.depthCm);
    const iconWidth = item.kind === "equipment" && !airConditioner && !actualFootprint
        ? Math.min(width, socket || circuit ? 14 : 14 * ICON_SCALE) : width;
    const iconHeight = towelRail || grabBar ? 16 :
        item.kind === "equipment" && !airConditioner && !actualFootprint
            ? Math.min(height, socket || circuit ? 14 : 14 * ICON_SCALE) : height;
    const className = squareLabel
        ? `equipment square-label category-${planDisplayCategory(item)}
            ${circuit ? "dedicated-circuit" : ""}
            ${item.switchEnvironment === "outdoor" ? "environment-outdoor" : ""}
            ` :
        item.kind === "furniture" ? `furniture ${item.furnitureType}` :
        socket ? "equipment outlet general" :
        airConditioner ? "air-conditioner" : freshAir ? "equipment fresh-air" :
            rinseKit ? "equipment rinse-kit" : towelRail ? "equipment towel-rail" :
                grabBar ? "equipment grab-bar" :
                    switchOption ? `equipment switch ${item.switchEnvironment === "outdoor"
                        ? "outdoor" : "indoor"}` :
            downlight ? "equipment downlight" : ceilingLight ? "equipment ceiling-light" :
                trackLight ? "equipment track-light" :
            wallHeater ? "equipment wall-heater" : "equipment";
    const applianceLabel = iconKind === "washer" ? "洗" :
        iconKind === "dryer" ? "烘" : "";
    const iconOrientation = item.orientation ?? 0;
    const turned = [90, 270].includes(iconOrientation);
    const iconBaseWidth = turned ? iconHeight : iconWidth;
    const iconBaseHeight = turned ? iconWidth : iconHeight;
    const previewable = switchOption || downlight || ceilingLight || trackLight;
    const collision = placementFootprint(item, geometry);
    const invalid = footprintFits(geometry, x, y, collision.width, collision.height, item)
        ? "" : " out-of-bounds";
    return `<g class="overview-marker ${className}
        ${!squareLabel && iconKind && item.kind !== "furniture" ? "pictogram" : ""}
        ${invalid} ${vanity?.conflict ? "fixture-overlap" : ""}
        ${isConditionalFloorDryer(item) || isConditionalOutboardSink(item) ?
            "balcony-conditional" : ""}"
        transform="translate(${x} ${y})"
        ${quoteMarkerAttributes(source)}
        ${item.outletPlanPointId ? `data-outlet-point-id="${escapeSvg(item.outletPlanPointId)}"` : ""}
        ${previewEnabled && previewable ? `data-preview-item-id="${escapeSvg(item.id)}"
            role="button" tabindex="0" aria-label="切換${escapeSvg(item.name)}的模擬照明"` :
            source ? `role="button" tabindex="0" aria-label="${escapeSvg(item.name)}"` : ""}>
        <title>${escapeSvg(name)}：${escapeSvg(item.name)}；${escapeSvg(laundryMarkerNote(item))}
            ${escapeSvg(vanity?.warning ?? "")}
            ${airConditioner ? `，出風${directionName(item.orientation)}` :
                freshAir ? "，室外進氣新風機暫定位置；機型、管路與價格待核" :
                    rinseKit ? "，馬桶旁三叉管與沖洗器；安裝及接頭待核" :
                        towelRail ? "，電熱毛巾架牆面暫位；防潮配線與尺寸待核" :
                            grabBar ? "，浴缸牆面防滑扶手；固定承重待核" :
                switchOption ? `，${escapeSvg(switchOption.label)}${item.switchEnvironment ===
                    "outdoor" ? "；防水盒、額定規格與迴路待核" : ""}` :
                    circuit ? "，獨立專用迴路，對應一個一般插座；配線與負載待電工核對" :
                    socket ? `，${isQuotedOutlet(item)
                        ? "原報價插座迴路 NT$1,800；專用迴路若有則另列"
                        : "新增一般插座暫估 NT$1,800；專用迴路須另列"}` :
                    downlight ? "，天花崁燈示意（含燈具、配線及安裝）" :
                        ceilingLight ? "，天花吸頂燈示意（商品與安裝分列；實價待核）" :
                            trackLight ? `，${item.trackLengthCm}cm軌道及${item.spotlightQuantity}盞軌道燈示意，配線安裝另計` : ""}
            ${source ? `；${escapeSvg(source)}` : ""}</title>
        ${item.outletPlanPointId ? diagramPointSymbol(item) : squareLabel ? `${trackLight ? `<g
                transform="rotate(${iconOrientation})">${trackLightingSymbol(item,
                    geometry.cmScale ?? PLAN_PIXELS_PER_CM)}</g>` : ""}
            ${squareLabelSymbol(item, Math.max(16, Math.min(23, iconWidth, iconHeight)), true)}`
            : trackLight ? `<g transform="rotate(${iconOrientation})">
                ${trackLightingSymbol(item, geometry.cmScale ?? PLAN_PIXELS_PER_CM)}</g>` : ceilingLight
            ? `<circle class="ceiling-light-plate" r="17"/>
                <circle class="ceiling-light-ring" r="12"/>`
            : downlight
            ? '<circle class="downlight-plate" r="12"/>'
            : socket
            ? socketSymbol(item, true)
            : switchOption
            ? `<g transform="rotate(${iconOrientation})">
                <rect x="${-iconBaseWidth / 2}" y="${-iconBaseHeight / 2}"
                    width="${iconBaseWidth}" height="${iconBaseHeight}" rx="2"/>
                <path class="overview-orientation-mark" d="M-7 -8 H7"/></g>`
            : freshAir || rinseKit || towelRail || grabBar
            ? `<g transform="rotate(${iconOrientation})">
                <rect x="${-iconBaseWidth / 2}" y="${-iconBaseHeight / 2}"
                    width="${iconBaseWidth}" height="${iconBaseHeight}" rx="2"/>
                <path class="overview-orientation-mark" d="M-5 -4 H5"/></g>`
            : iconKind
            ? `<g class="overview-object-body" transform="rotate(${iconOrientation})">
                ${renderObjectIcon(item, iconBaseWidth, iconBaseHeight)}
            </g>`
            : `<rect x="${-iconWidth / 2}" y="${-iconHeight / 2}"
                width="${iconWidth}" height="${iconHeight}" rx="2"/>`}
        ${!squareLabel && airConditioner ? `<path class="overview-ac-grille"
            d="${height > width
                ? `M${-width * .18} ${-height * .37} V${height * .37}
                    M${width * .08} ${-height * .37} V${height * .37}`
                : `M${-width * .37} ${-height * .18} H${width * .37}
                    M${-width * .37} ${height * .08} H${width * .37}`}"/>` : ""}
        ${!squareLabel && freshAir ? `<circle class="overview-fan-ring" cx="0" cy="-4" r="5"
            transform="rotate(${iconOrientation})"/>
            <circle class="overview-fan-hub" cx="0" cy="-4" r="1.5"
                transform="rotate(${iconOrientation})"/>` : ""}
        ${!squareLabel && (downlight || ceilingLight) ? `<path class="overview-lamp-notch"
            d="M-4 ${downlight ? -9 : -14} H4"
            transform="rotate(${iconOrientation})"/>` : ""}
        ${!squareLabel && downlight ? '<text class="overview-downlight-label" y="5" text-anchor="middle">燈</text>' : ""}
        ${!squareLabel && ceilingLight ? '<text class="overview-ceiling-light-label" y="5" text-anchor="middle">頂</text>' : ""}
        ${!squareLabel && wallHeater ? '<text class="overview-heater-label" y="3" text-anchor="middle">熱</text>' : ""}
        ${!squareLabel && (freshAir || rinseKit) ? `<text class="overview-bathroom-label" y="5"
            text-anchor="middle">${freshAir ? "新" : "沖"}</text>` : ""}
        ${!squareLabel && (towelRail || grabBar) ? `<text class="overview-bathroom-label" y="5"
            text-anchor="middle">${towelRail ? "巾" : "扶"}</text>` : ""}
        ${!squareLabel && switchOption ? `<text class="overview-switch-label" y="5"
            text-anchor="middle">${escapeSvg(switchOption.marker ??
                switchOption.label[0])}</text>` : ""}
        ${!squareLabel && applianceLabel ? `<text class="overview-appliance-label"
            x="${-width / 2 + 4}" y="${-height / 2 + 15}"
            text-anchor="start">${applianceLabel}</text>` : ""}
        ${!squareLabel && airConditioner && item.orientation !== null ? `<path class="ac-direction"
            d="M${8 * ICON_SCALE} 0 H${22 * ICON_SCALE}
                M${18 * ICON_SCALE} ${-3 * ICON_SCALE}
                L${22 * ICON_SCALE} 0 L${18 * ICON_SCALE} ${3 * ICON_SCALE}"
            transform="rotate(${item.orientation})"/>` : ""}
    </g>`;
}

function renderOutdoorAC(item, overview, selectedItemId = null, showRotateHandle = true) {
    const zone = outdoorACZone(item);
    const position = outdoorACPosition(item);
    const window = windows.find((entry) => entry.id === zone?.windowId);
    if (!zone || !position || !window) {
        throw new RangeError(`找不到${item.roomId}室外機的現況窗洞或暫定位置。`);
    }
    const { x, y } = position;
    const footprint = outdoorACFootprint(item);
    const { width, height } = footprint;
    const fanRadius = Math.min(width, height) * .27;
    const fanBlade = fanRadius * .55;
    const beyondExterior = outdoorACSceneConflict(item);
    const lengthCm = item.outdoorWidthCm ?? OUTDOOR_AC_ESTIMATED_SIZE_CM.width;
    const depthCm = item.outdoorDepthCm ?? OUTDOOR_AC_ESTIMATED_SIZE_CM.depth;
    const narrowWindow = window.widthCm < lengthCm;
    const orientation = item.outdoorOrientation ?? 0;
    const inset = Math.min(6, width * .17, height * .17);
    const directionDot = ({
        0: { x: -width / 2 + inset, y: 0 },
        90: { x: 0, y: -height / 2 + inset },
        180: { x: width / 2 - inset, y: 0 },
        270: { x: 0, y: height / 2 - inset },
    })[orientation];
    if (!directionDot) throw new RangeError("室外機轉向角度無效，無法繪圖。");
    return `<g class="${overview ? "plan-outdoor-ac" : "detail-outdoor-ac"}
        ${item.id === selectedItemId ? "selected" : ""}
        ${beyondExterior ? "out-of-bounds" : ""}
        ${narrowWindow ? "access-warning" : ""}"
        transform="translate(${x} ${y})"
        data-outdoor-zone-id="${escapeSvg(zone.windowId)}"
        data-outdoor-width-cm="${lengthCm}" data-outdoor-depth-cm="${depthCm}"
        ${overview ? `data-select-room="${escapeSvg(item.roomId)}"` :
            `data-outdoor-id="${escapeSvg(item.id)}"`}
        role="button" tabindex="0"
        aria-label="${escapeSvg(item.roomId === "bedroom-3" ? "臥室3鐵窗外" :
            zone.label)}的室外機暫位；按長 ${lengthCm}×短 ${depthCm} 公分暫估，
            已轉 ${orientation} 度，
            尺寸依商品或暫估資料，不含維修淨距，不能按圖示判斷可施工">
        <title>${escapeSvg(zone.label)}；與${escapeSvg(item.name)}共用一套機器價格；
            俯視占地長邊 ${lengthCm}×短邊 ${depthCm}cm 暫估，已轉 ${orientation}°；
            ${item.productId ? `${escapeSvg(item.brandModel)}；高度與維修淨距未畫入；` : "型號與機身高度待選；"}
            ${narrowWindow ? `現況 W${window.widthCm}cm 窗洞窄於機長，不能假設可由窗洞搬運；` : ""}
            ${beyondExterior ? "暫估機身超出圖示外側輪廓，須改位置或規格；" : ""}
            固定、鐵窗承重、散熱、維修與合法性待現勘</title>
        <rect class="outdoor-ac-housing" x="${-width / 2}"
            y="${-height / 2}" width="${width}" height="${height}" rx="3"/>
        <circle class="outdoor-ac-fan" r="${fanRadius}"/>
        <path class="outdoor-ac-blades"
            d="M0 ${-fanBlade} V${fanBlade}
                M${-fanBlade} 0 H${fanBlade}"/>
        <circle class="outdoor-ac-orientation-dot"
            cx="${directionDot.x}" cy="${directionDot.y}" r="2.8"/>
        <text class="outdoor-ac-label" x="${width / 2 - 3}"
            y="${-height / 2 + 12}" text-anchor="end">外</text>
        ${overview ? "" : `<text class="outdoor-ac-size-label" x="0"
            y="${height / 2 + 14}" text-anchor="middle">
            ${lengthCm}×${depthCm}cm 暫估</text>
            ${item.id === selectedItemId && showRotateHandle
                ? `<g class="ac-rotate-handle outdoor-rotate-handle"
                data-action="rotate-outdoor-ac"
                data-item-id="${escapeSvg(item.id)}" role="button" tabindex="0"
                aria-label="將${escapeSvg(item.name)}的室外機順時針旋轉90度"
                transform="translate(${width / 2 + ROTATE_HANDLE_OFFSET}
                    ${-height / 2 - ROTATE_HANDLE_OFFSET})">
                <title>將室外機暫估外框順時針旋轉 90°</title>
                <circle class="rotate-hitbox" r="${ROTATE_HIT_RADIUS}"/>
                <circle class="rotate-button" r="${4.5 * ICON_SCALE}"/>
                <text y="${2.5 * ICON_SCALE}" text-anchor="middle">↻</text>
            </g>` : ""}`}
    </g>`;
}

function renderPreviewConnections(rooms, items, focusedCircuitId, roomId = null) {
    const geometryByRoom = new Map(rooms.map((room) => [room.id, roomGeometry(room)]));
    const links = previewCircuitLinks(items).filter(({ switchItem, lightItem }) =>
        geometryByRoom.has(switchItem.roomId) && geometryByRoom.has(lightItem.roomId) &&
        (!roomId || switchItem.roomId === roomId && lightItem.roomId === roomId));
    if (!links.length) return "";
    const position = (item) => markerPosition(item, geometryByRoom.get(item.roomId));
    return `<g class="preview-circuits ${focusedCircuitId ? "has-focus" : ""}"
        aria-hidden="true" pointer-events="none">
        ${links.map(({ switchItem, lightItem }) => {
            const from = position(switchItem);
            const to = position(lightItem);
            return `<g class="preview-circuit ${focusedCircuitId === switchItem.id ||
                focusedCircuitId === lightItem.id ? "is-focused" : ""}"
                data-preview-switch-id="${escapeSvg(switchItem.id)}"
                data-preview-light-id="${escapeSvg(lightItem.id)}">
                <path d="M${from.x} ${from.y} L${to.x} ${to.y}"/>
                <circle cx="${to.x}" cy="${to.y}" r="3"/>
            </g>`;
        }).join("")}
    </g>`;
}

export function kitchenShortWingFill(items, geometry) {
    if (geometry.id !== "kitchen") return null;
    const pair = ["return", "tower"].map((key) =>
        items.find((item) => item.id === `kitchen-plan-${key}` &&
            item.roomId === "kitchen"));
    if (!pair.some((item) => item?.note?.includes(KITCHEN_V_LAYOUT_TAG))) return null;
    const hob = items.find((item) =>
        item.id === "kitchen-plan-cooktop-base" && item.roomId === "kitchen");
    const invalid = { valid: false,
        note: "短翼圖例已移動或缺漏，連續填補停用；請重新核對兩櫃與轉角。" };
    if ([...pair, hob].some((item) => !item?.placement ||
        !Number.isFinite(item.widthCm) || !Number.isFinite(item.depthCm))) {
        return invalid;
    }
    const bounds = (item) => {
        const center = markerPosition(item, geometry);
        const size = itemFootprint(item, geometry);
        return { x: center.x, y: center.y, left: center.x - size.width / 2,
            right: center.x + size.width / 2, top: center.y - size.height / 2,
            bottom: center.y + size.height / 2 };
    };
    const [platform, tower, cooktop] = [...pair, hob].map(bounds);
    if (platform.y >= tower.y || tower.y <= cooktop.y ||
        Math.max(platform.left, tower.left) >= Math.min(platform.right, tower.right) ||
        platform.left < cooktop.x || tower.bottom > geometry.y + geometry.height ||
        platform.top < geometry.y) return invalid;
    const x = Math.min(platform.left, tower.left);
    const right = Math.max(platform.right, tower.right);
    const y = Math.min(cooktop.top, platform.top);
    return { valid: true, x, y, width: right - x,
        height: geometry.y + geometry.height - y, note: KITCHEN_V_FILL_NOTE };
}

function renderKitchenShortWingFill(items, geometry, scope) {
    const fill = kitchenShortWingFill(items, geometry);
    if (!fill) return "";
    const id = `kitchen-${scope}-flex`;
    return `<g class="kitchen-flex-intent"
        data-kitchen-fill="${fill.valid ? "adjustable" : "needs-review"}"
        role="img" tabindex="0" aria-label="${escapeSvg(fill.note)}">
        <title>${escapeSvg(fill.note)}</title>
        ${fill.valid ? `<defs>${kitchenFillPattern(id)}
            <clipPath id="${id}-clip"><path d="${geometry.path}"/></clipPath></defs>
            <rect class="kitchen-adjustable-fill" data-fill-band="short-wing"
                x="${fill.x}" y="${fill.y}" width="${fill.width}" height="${fill.height}"
                fill="url(#${id})" clip-path="url(#${id}-clip)"/>` : ""}
        <text class="kitchen-fill-label" x="${geometry.x + 6}"
            y="${geometry.y + geometry.height - 7}">
            ${fill.valid ? "斜線：訂製伸縮，非實測淨距" : "短翼填補停用：位置／尺寸待核"}
        </text>
    </g>`;
}

export function renderOverviewPlan(rooms, items, showSource = false, activeLightIds = null,
    visibleLayers = DEFAULT_VISIBLE_LAYERS, focusedCircuitId = null,
    planeHeightCm = 80, sheetMarker = null) {
    const byRoom = new Map(rooms.map((room) => [room.id, room]));
    const renderedZones = HOUSE_ZONES.map((zone) => {
        const room = byRoom.get(zone.id);
        if (!room) return "";
        const geometry = roomGeometry(room);
        const roomItems = items.filter((item) => item.roomId === room.id);
        const markers = sheetMarker ? "" : roomItems.filter((item) =>
            item.kind !== "door" && item.placement && markerVisible(item, visibleLayers) &&
            (!isSplitAirConditioner(item) || isActiveSplitAirConditioner(item)))
            .sort((a, b) => Boolean(a.outletPlanPointId) - Boolean(b.outletPlanPointId) ||
                kitchenDrawOrder(a, b))
            .map((item) => overviewMarker(item, geometry, room.name,
                activeLightIds !== null, items)).join("");
        return `<g class="plan-zone tone-${zone.tone}" ${sheetMarker
            ? `aria-label="${escapeSvg(room.name)}"`
            : `data-select-room="${zone.id}" role="button" tabindex="0"
                aria-label="放大查看${escapeSvg(room.name)}"`}>
            <path class="zone-floor ${zone.id === "entry" ||
                zone.id === "living-dining" ? "entry-opening-floor" : ""}"
                d="${zone.path}"/>
            ${entryLivingWall(geometry)}
            <path class="zone-grid" d="${zone.path}" fill="url(#plan-meter-grid)"/>
            ${renderLightingPreview(geometry, items, activeLightIds, planeHeightCm)}
            ${renderWetDryDivider(zone.id, items)}
            ${visibleLayers.furniture
                ? renderKitchenShortWingFill(roomItems, geometry, "overview") : ""}
            ${zone.id === "balcony" && (visibleLayers.furniture || sheetMarker)
                ? renderBalconySink() : ""}
            ${zone.id === "ac-platform" ? renderExteriorPlatform(false, items) : ""}
            ${zone.id === "corridor"
                ? `<text class="corridor-label" x="488" y="${zone.labelY}"
                    text-anchor="middle" transform="rotate(-90 488 ${zone.labelY})">
                    ${escapeSvg(room.name)}</text>`
                : `<text class="plan-zone-label" x="${zone.labelX}" y="${zone.labelY}"
                    text-anchor="middle">${escapeSvg(room.name)}</text>`}
            ${zone.id === "balcony" ? `<text class="plan-zone-area" x="${zone.labelX}"
                y="1812" text-anchor="middle">2.3㎡</text>` : ""}
            ${visibleLayers.outlets && !sheetMarker
                ? renderCircuitPairings(geometry, roomItems) : ""}
            ${markers}
        </g>`;
    }).join("");
    const meter = 100 * PLAN_PIXELS_PER_CM;
    return `<svg class="overview-svg ${showSource ? "with-source" : ""}"
        viewBox="0 0 ${HOUSE_SIZE.width} ${HOUSE_SIZE.height}"
        role="group" aria-label="${sheetMarker
            ? "去識別化房屋輪廓與現況門窗的只讀配置示意；不是印刷比例或施工圖"
            : "依 1:60 圖面資料與牆內緣繪製的格局；每個格線 100 公分"}">
        <defs><pattern id="plan-meter-grid" x="0" y="0"
            width="${meter}" height="${meter}" patternUnits="userSpaceOnUse">
            <path class="grid-line" d="M${meter} 0 H0 V${meter}"/>
        </pattern></defs>
        <rect class="plan-paper" x="8" y="8" width="929" height="1964" rx="18"/>
        ${showSource ? `<g class="plan-source-schematic">
            ${renderReferenceSchematic(rooms, {
                proposed: true, labels: false, windowsVisible: false, doorsVisible: false,
            })}
        </g>` : ""}
        <path class="plan-existing-bay" d="${EXISTING_CURVED_BAY_PATH}">
            <title>現況圖弧形外緣；不計入客餐廳設備擺放範圍</title>
        </path>
        ${byRoom.has("corridor") ? "" : `<path class="plan-corridor" d="${CORRIDOR_PATH}"/>
            <path class="plan-corridor-grid" d="${CORRIDOR_PATH}" fill="url(#plan-meter-grid)"/>`}
        ${renderedZones}
        ${(visibleLayers.furniture || sheetMarker) && byRoom.has("balcony") ?
            renderBalconyDemolition(items) : ""}
        ${byRoom.has("entry") && byRoom.has("living-dining")
            ? renderEntryLivingPassage(true, !sheetMarker) : ""}
        ${activeLightIds !== null && visibleLayers.switches && visibleLayers.lights
            ? renderPreviewConnections(rooms, items, focusedCircuitId) : ""}
        ${renderBedroom2Partition(items, !sheetMarker)}
        ${byRoom.has("corridor") ? "" : `<text class="corridor-label" x="518" y="1282"
            text-anchor="middle" transform="rotate(-90 518 1282)">走廊</text>`}
        ${doors.filter((door) => door.roomIds.some((id) => byRoom.has(id)))
            .map((door) => renderDoor(door, items, true, true, !sheetMarker)).join("")}
        ${windows.filter((window) => byRoom.has(window.roomId))
            .map((window) => renderWindow(window, true, !sheetMarker)).join("")}
        ${sheetMarker ? rooms.filter((room) =>
            HOUSE_ZONE_BY_ID.has(room.id)).map((room) =>
            items.filter((item) => item.roomId === room.id).map((item) =>
                sheetMarker(item, roomGeometry(room), room.name)).join("")).join("") : ""}
        ${visibleLayers.furniture ? items.filter((item) => isActiveSplitAirConditioner(item) &&
            item.outdoorPlacement && byRoom.has(item.roomId))
            .map((item) => renderOutdoorAC(item, true)).join("") : ""}
        <g class="plan-scale" transform="translate(682 1952)">
            <path d="M0 0 H${meter} M0 -6 V6 M${meter} -6 V6"/>
            <text x="${meter / 2}" y="-12" text-anchor="middle">100 cm</text>
        </g>
    </svg>`;
}

function renderWetDryDivider(roomId, items, showRoomLabel = false) {
    const reference = BATH_DIVIDERS[roomId];
    if (!reference) return "";
    const definition = doors.find((door) => door.id === reference.doorId);
    if (!definition) throw new RangeError(`找不到${roomId}的乾濕分離門。`);
    const door = selectedDoor(definition, items);
    const source = items.filter((item) =>
        [`${roomId}-wet-dry-glass`, `${roomId}-safety-film`].includes(item.id))
        .map(quoteProvenance).filter(Boolean).join("\n");
    const gapStart = Math.max(reference.top, door.y - door.length / 2 - 4);
    const gapEnd = Math.min(reference.bottom, door.y + door.length / 2 + 4);
    const segments = [
        gapStart > reference.top ? `M${reference.x} ${reference.top} V${gapStart}` : "",
        gapEnd < reference.bottom ? `M${reference.x} ${gapEnd} V${reference.bottom}` : "",
    ].filter(Boolean).join(" ");
    return `<g class="wet-dry-divider" role="img"
        ${source ? 'tabindex="0"' : ""} ${quoteMarkerAttributes(source)}
        aria-label="${roomId === "bath-main" ? "主浴" : "客浴"}乾濕分離玻璃隔屏虛線，門洞另以玻璃門線表示">
        <title>乾濕分離（一字）位置示意；隔屏長度及門洞淨寬待現場丈量；${escapeSvg(source)}</title>
        <path d="${segments}"/>
    </g>${showRoomLabel ? `<text class="room-reference" x="${reference.labelX}"
        y="${reference.labelY}" text-anchor="middle">${reference.label}</text>` : ""}`;
}

function renderItemDimensions(item, geometry, footprint, x, y) {
    const turned = [90, 270].includes(item.orientation);
    const horizontal = {
        name: turned ? "深" : "寬",
        cm: turned ? item.depthCm : item.widthCm,
    };
    const vertical = {
        name: turned ? "寬" : "深",
        cm: turned ? item.widthCm : item.depthCm,
    };
    const halfWidth = footprint.width / 2;
    const halfHeight = footprint.height / 2;
    const above = y <= geometry.y + geometry.height / 2;
    const left = x <= geometry.x + geometry.width / 2;
    const arrowY = y + (above ? -(halfHeight + 17) : halfHeight + 17);
    const bathroom = geometry.id === "bath-main" || geometry.id === "bath-guest";
    const arrowX = bathroom
        ? left ? geometry.x - 18 : geometry.x + geometry.width + 18
        : x + (left ? -(halfWidth + 17) : halfWidth + 17);
    const labelX = arrowX + (left ? -17 : 17);
    const widthHead = Math.min(7, footprint.width / 4);
    const depthHead = Math.min(7, footprint.height / 4);
    const x0 = x - halfWidth;
    const x1 = x + halfWidth;
    const y0 = y - halfHeight;
    const y1 = y + halfHeight;
    return `<g class="object-dimensions" role="img"
        data-item-id="${escapeSvg(item.id)}"
        data-horizontal-cm="${horizontal.cm}" data-vertical-cm="${vertical.cm}"
        aria-label="${escapeSvg(item.name)}：${horizontal.name} ${horizontal.cm} 公分、
            ${vertical.name} ${vertical.cm} 公分">
        <path class="item-width-arrow" d="M${x0} ${arrowY} H${x1}
            M${x0 + widthHead} ${arrowY - 4} L${x0} ${arrowY}
                L${x0 + widthHead} ${arrowY + 4}
            M${x1 - widthHead} ${arrowY - 4} L${x1} ${arrowY}
                L${x1 - widthHead} ${arrowY + 4}"/>
        <text x="${x}" y="${arrowY + (above ? -8 : 17)}"
            text-anchor="middle">${horizontal.name} ${dimensionCm(horizontal.cm)} cm</text>
        <path class="item-depth-arrow" d="M${arrowX} ${y0} V${y1}
            M${arrowX - 4} ${y0 + depthHead} L${arrowX} ${y0}
                L${arrowX + 4} ${y0 + depthHead}
            M${arrowX - 4} ${y1 - depthHead} L${arrowX} ${y1}
                L${arrowX + 4} ${y1 - depthHead}"/>
        <text x="${labelX}" y="${y}"
            transform="rotate(-90 ${labelX} ${y})"
            text-anchor="middle">${vertical.name} ${dimensionCm(vertical.cm)} cm</text>
    </g>`;
}

function detailMarker(item, geometry, selectedItemId, previewEnabled = false,
    showRotateHandle = true, items = []) {
    const source = markerQuoteProvenance(item, items);
    const vanity = item.id === "bath-guest-vanity" ? guestVanityAssessment(items, geometry) : null;
    const { x, y } = markerPosition(item, geometry);
    const footprint = itemFootprint(item, geometry);
    const furniture = item.kind === "furniture" ? FURNITURE_TEMPLATES[item.furnitureType] : null;
    const iconKind = objectIconKind(item);
    const nativeFurniture = FURNITURE_TEMPLATES[iconKind] ?? null;
    const circuit = isDedicatedCircuit(item);
    const socket = !circuit && !isWeakCurrent(item) && planDisplayCategory(item) === "outlets";
    const airConditioner = !socket && !circuit &&
        (isSplitAirConditioner(item) || item.name.includes("冷氣"));
    const wallHeater = isBalconyHeaterPlaceholder(item);
    const freshAir = isFreshAirUnit(item);
    const rinseKit = isToiletRinseKit(item);
    const towelRail = isHeatedTowelRail(item);
    const grabBar = isBathGrabBar(item);
    const switchOption = switchOptionFor(item);
    const downlight = item.lightType === "recessed";
    const ceilingLight = item.lightType === "ceiling";
    const trackLight = item.lightType === "track";
    const squareLabel = circuit || usesSquareLabel(item, iconKind);
    if (item.switchType && !switchOption) throw new RangeError("圖上開關型式無效。");
    const measured = Boolean(geometry.cmScale && item.widthCm && item.depthCm);
    const sizeCm = itemDimensions(item, nativeFurniture);
    const templateSize = Boolean(geometry.cmScale &&
        sizeCm.widthCm && sizeCm.depthCm);
    const appliance = iconKind === "washer" || iconKind === "dryer";
    const verticalAirConditioner = airConditioner && [0, 180].includes(item.orientation);
    const size = isUnknownDepthGuestTub(item)
        ? { width: item.widthCm *
            (geometry.cmScale ?? PLAN_PIXELS_PER_CM), height: 28 }
        : templateSize
        ? { width: sizeCm.widthCm * geometry.cmScale,
            height: sizeCm.depthCm * geometry.cmScale }
        : freshAir ? { width: 32, height: 28 } :
            rinseKit ? { width: 20, height: 20 } :
            towelRail ? { width: 30, height: 10 } :
            grabBar ? { width: 34, height: 12 } :
            socket || circuit ? { width: 18, height: 18 } :
            switchOption || downlight ? { width: 24, height: 24 } :
            ceilingLight ? { width: 36, height: 36 } :
            trackLight ? { width: 30, height: item.trackLengthCm * PLAN_PIXELS_PER_CM } :
            wallHeater ? WALL_HEATER_MARKER : { width: 22 * ICON_SCALE, height: 22 * ICON_SCALE };
    const orientation = item.orientation ?? 0;
    const label = item.name === "面盆龍頭" ? "龍頭" :
        item.name.startsWith("小便斗") ? "便斗" :
        item.name.includes("淋浴") ? "淋浴" :
            item.name.slice(0, measured && size.width >= 62 ? 4 : 2);
    const squareSize = Math.max(18, Math.min(30, footprint.width, footprint.height));
    const symbol = item.outletPlanPointId ? diagramPointSymbol(item) : squareLabel
        ? `${trackLight ? `<g transform="rotate(${orientation})">${trackLightingSymbol(item,
                geometry.cmScale ?? PLAN_PIXELS_PER_CM)}</g>` : ""}
            ${squareLabelSymbol(item, squareSize, false)}`
        : furniture
        ? `<g class="furniture-body" transform="rotate(${orientation})">
            <rect class="object-hitbox" x="${-size.width / 2}" y="${-size.height / 2}"
                width="${size.width}" height="${size.height}" rx="3"/>
            ${renderObjectIcon(item, size.width, size.height)}
        </g>${appliance ? `<text class="appliance-corner-label"
            x="${-footprint.width / 2 + 5}" y="${-footprint.height / 2 + 16}"
            text-anchor="start">${item.furnitureType === "washer" ? "洗" : "烘"}</text>` : ""}`
        : airConditioner
            ? `<g class="ac-body" transform="rotate(${item.orientation === null
                ? 0 : (orientation + 90) % 360})">
                <rect x="${-21 * ICON_SCALE}" y="${-9 * ICON_SCALE}"
                    width="${42 * ICON_SCALE}" height="${18 * ICON_SCALE}" rx="3"/>
                <path class="ac-grille" d="M${-16 * ICON_SCALE} ${-5 * ICON_SCALE}
                    H${16 * ICON_SCALE} M${-16 * ICON_SCALE} ${-2 * ICON_SCALE}
                    H${16 * ICON_SCALE}"/>
            </g>
            ${item.orientation === null ? "" : `<path class="ac-outlet"
                d="M${9 * ICON_SCALE} ${-14 * ICON_SCALE} V${14 * ICON_SCALE}"
                    transform="rotate(${orientation})"/>
                <path class="ac-direction"
                    d="M${9 * ICON_SCALE} 0 H${27 * ICON_SCALE}
                        M${22 * ICON_SCALE} ${-4 * ICON_SCALE}
                        L${27 * ICON_SCALE} 0 L${22 * ICON_SCALE} ${4 * ICON_SCALE}"
                    transform="rotate(${orientation})"/>`}
            ${verticalAirConditioner
                ? `<text class="ac-label vertical" text-anchor="middle">
                    <tspan x="0" y="-4">冷</tspan>
                    <tspan x="0" y="16">氣</tspan>
                </text>`
                : `<text class="ac-label horizontal" y="${3 * ICON_SCALE}"
                    text-anchor="middle">冷氣</text>`}`
            : wallHeater
                ? `<g class="equipment-body" transform="rotate(${orientation})">
                    <rect class="object-hitbox" x="${-size.width / 2}"
                        y="${-size.height / 2}" width="${size.width}" height="${size.height}" rx="2"/>
                    ${renderObjectIcon(item, size.width, size.height)}
                </g>
                <path class="wall-heater-leader" d="M${footprint.width / 2} 0
                    H${footprint.width / 2 + 8}"/>
                <text class="wall-heater-label" x="${footprint.width / 2 + 10}"
                    y="4">熱水器</text>`
            : socket
                ? socketSymbol(item)
            : switchOption
                ? `<g transform="rotate(${orientation})">
                    <rect class="switch-plate" x="-12" y="-12" width="24"
                        height="24" rx="3"/>
                    <path class="switch-rocker" d="M-7 -8 H7"/></g>
                    <text class="switch-label" y="5" text-anchor="middle">
                        ${escapeSvg(switchOption.marker ?? switchOption.label[0])}</text>`
            : freshAir
                ? `<g transform="rotate(${orientation})">
                    <rect class="fresh-air-plate" x="-16" y="-14" width="32"
                        height="28" rx="3"/>
                    <circle class="fresh-air-fan" cx="0" cy="-4" r="8"/>
                    <path class="fresh-air-blades"
                        d="M0 -11 L3 -5 L0 -4 M7 -2 L1 -1 L0 -4
                            M-5 1 L-2 -4 L0 -4"/>
                    <path class="fresh-air-flow" d="M-9 -8 H9 M4 -12 L9 -8 L4 -4"/>
                    </g>
                    <text class="fresh-air-label" y="9" text-anchor="middle">新</text>`
            : rinseKit
                ? `<g transform="rotate(${orientation})">
                    <rect class="rinse-kit-plate" x="-10" y="-10" width="20"
                        height="20" rx="3"/>
                    <path class="rinse-kit-direction" d="M-5 -6 H5"/></g>
                    <text class="rinse-kit-label" y="5" text-anchor="middle">沖</text>`
            : towelRail
                ? `<g class="wall-accessory" transform="rotate(${orientation})">
                    <rect class="towel-rail-plate" x="-15" y="-5" width="30"
                        height="10" rx="2"/>
                    <path class="wall-accessory-bars"
                        d="M-12 -3 H-8 M8 -3 H12 M-12 3 H-8 M8 3 H12"/>
                </g>
                <text class="wall-accessory-label" y="3" text-anchor="middle">巾</text>`
            : grabBar
                ? `<g class="wall-accessory" transform="rotate(${orientation})">
                    <rect class="grab-bar-plate" x="-17" y="-6" width="34"
                        height="12" rx="6"/>
                    <path class="wall-accessory-bars" d="M-11 0 H-7 M7 0 H11"/>
                </g>
                <text class="wall-accessory-label" y="4" text-anchor="middle">扶</text>`
            : downlight
                ? `<circle class="downlight-plate" r="12"/>
                    <path class="lamp-direction-notch" d="M-4 -9 H4"
                        transform="rotate(${orientation})"/>
                    <text class="downlight-label" y="5" text-anchor="middle">燈</text>`
            : ceilingLight
                ? `<circle class="ceiling-light-plate" r="17"/>
                    <circle class="ceiling-light-ring" r="12"/>
                    <path class="lamp-direction-notch" d="M-4 -14 H4"
                        transform="rotate(${orientation})"/>
                    <text class="ceiling-light-label" y="5" text-anchor="middle">頂</text>`
            : trackLight ? `<g transform="rotate(${orientation})">
                ${trackLightingSymbol(item, geometry.cmScale ?? PLAN_PIXELS_PER_CM)}</g>`
            : iconKind
                ? `<g class="equipment-body" transform="rotate(${orientation})">
                    <rect class="object-hitbox"
                        x="${-size.width / 2}" y="${-size.height / 2}"
                        width="${size.width}" height="${size.height}" rx="3"/>
                    ${renderObjectIcon(item, size.width, size.height)}
                </g>
                ${appliance ? `<text class="appliance-corner-label"
                    x="${-footprint.width / 2 + 5}" y="${-footprint.height / 2 + 16}"
                    text-anchor="start">${iconKind === "washer" ? "洗" : "烘"}</text>` : ""}
                ${item.id === "bath-guest-tub" && !isUnknownDepthGuestTub(item)
                    ? `<text class="object-inline-label"
                    text-anchor="middle" y="4">${escapeSvg(item.name.slice(0, 2))}</text>` : ""}`
            : `<g class="equipment-body" transform="rotate(${orientation})">
                <rect class="${measured ? "measured-equipment" : "unsized-equipment"}"
                    x="${-size.width / 2}" y="${-size.height / 2}"
                    width="${size.width}" height="${size.height}" rx="2"/>
                <path class="equipment-direction-mark"
                    d="M${-Math.min(size.width / 4, 7)} ${-size.height / 2 + 5}
                        H${Math.min(size.width / 4, 7)}"/>
            </g>
            <text y="${3 * ICON_SCALE}" text-anchor="middle">${escapeSvg(label)}</text>
            ${measured ? "" : `<text class="unsized-mark"
                x="${size.width / 2 - 5 * ICON_SCALE}"
                y="${-size.height / 2 + 6 * ICON_SCALE}">?</text>`}`;
    const collision = placementFootprint(item, geometry);
    const invalid = !footprintFits(geometry, x, y,
        collision.width, collision.height, item);
    const rotateHandle = item.kind !== "door" &&
        item.id === selectedItemId && showRotateHandle
        ? `<g class="ac-rotate-handle" data-action="rotate-marker"
            data-item-id="${escapeSvg(item.id)}" role="button" tabindex="0"
            aria-label="將${escapeSvg(item.name)}順時針旋轉90度"
            transform="translate(${(squareLabel ? squareSize : footprint.width) /
                2 + ROTATE_HANDLE_OFFSET}
                ${-(squareLabel ? squareSize : footprint.height) /
                    2 - ROTATE_HANDLE_OFFSET})">
            <title>將物件順時針轉 90°</title>
            <circle class="rotate-hitbox" r="${ROTATE_HIT_RADIUS}"/>
            <circle class="rotate-button" r="${5.5 * ICON_SCALE}"/>
            <text y="${2.5 * ICON_SCALE}" text-anchor="middle">↻</text>
        </g>` : "";
    const dimensions = measured && !airConditioner && item.id === selectedItemId
        ? renderItemDimensions(item, geometry, footprint, x, y) : "";
    return `<g class="placed-item" transform="translate(${x} ${y})">
        <g class="room-marker ${squareLabel ?
            `square-label category-${planDisplayCategory(item)}
                ${circuit ? "dedicated-circuit" : ""}
                ${item.switchEnvironment === "outdoor" ? "environment-outdoor" : ""}
                ` :
            furniture ? `furniture ${escapeSvg(item.furnitureType)}` :
            airConditioner ? "air-conditioner" : freshAir ? "fresh-air" :
                rinseKit ? "rinse-kit" : towelRail ? "towel-rail" :
                    grabBar ? "grab-bar" :
                    socket ? "outlet general" :
                        switchOption ? `switch ${item.switchEnvironment === "outdoor"
                            ? "outdoor" : "indoor"}` :
                downlight ? "downlight" : ceilingLight ? "ceiling-light" :
                    trackLight ? "track-light" :
                    wallHeater ? "unsized wall-heater" :
                    measured ? "" : "unsized"}
            ${!squareLabel && iconKind && !furniture ? "pictogram" : ""}
            ${invalid ? "out-of-bounds" : ""} ${vanity?.conflict ? "fixture-overlap" : ""}
            ${item.id === selectedItemId ? "selected" : ""}"
            data-marker-id="${escapeSvg(item.id)}" role="button" tabindex="0"
            ${quoteMarkerAttributes(source)}
            ${item.outletPlanPointId ? `data-outlet-point-id="${escapeSvg(item.outletPlanPointId)}"` : ""}
            aria-label="${previewEnabled && (switchOption || downlight ||
                ceilingLight || trackLight) ? "切換模擬照明：" : "拖動"}
                ${escapeSvg(item.name)}${previewEnabled && (switchOption || downlight ||
                ceilingLight || trackLight) ? "" : "的位置"}">
            <title>${escapeSvg(item.name)}；${escapeSvg(vanity?.warning ?? "")}${escapeSvg(laundryMarkerNote(item))}${source ? `；${escapeSvg(source)}；` : ""}${airConditioner ? `，出風${directionName(item.orientation)}` :
                freshAir ? "，室外進氣位置示意，機型及浴室適用性待核" :
                    rinseKit ? "，馬桶三叉管和沖洗器；安裝費及接頭待確認" :
                        towelRail ? "，衛浴非淋浴側牆面暫位；配線防潮及安裝待確認" :
                            grabBar ? "，浴缸牆面暫位；固定承重與防水收邊待確認" :
                switchOption ? `，${escapeSvg(switchOption.label)}${item.switchEnvironment ===
                    "outdoor" ? "；戶外防潮等級、接線與安裝待核" : ""}` :
                    circuit ? `，獨立專用迴路，配對插座 ID
                        ${escapeSvg(item.circuitOutletId)}；負載與跳電風險待電工核對` :
                    socket ? `，${isQuotedOutlet(item)
                        ? "原報價實體電源；專用迴路若有另列一筆"
                        : "新增一般插座暫估 NT$1,800；專用迴路另列"}` :
                    downlight ? "，天花崁燈位置示意" :
                        ceilingLight ? "，客廳天花吸頂燈位置示意" :
                            trackLight ? `，${item.trackLengthCm}cm軌道與${item.spotlightQuantity}盞燈的配置` : ""}
                （${circuit ? "紫色標記與配對虛線不是實際配線路徑" :
                    socket ? "圖示非插座實際尺寸、安裝高度或已確認插孔型式" :
                    freshAir ? "圖示非機身尺寸，未繪室外進氣與排濕管路" :
                    rinseKit ? "圖示非實際管件尺寸，配水與防回流待確認" :
                        towelRail || grabBar ? "壁掛圖示非實際寬度或安裝高度" :
                    downlight ? `圖示非開孔尺寸；燈具、配線及安裝${
                        isQuotedEquipment(item) ? "屬原報價額度" : "為新增另計"}` :
                    ceilingLight ? "圖示非燈具尺寸；燈具本體與配線安裝另列、實價待核" :
                        trackLight ? "軌道、燈具及配線安裝按原報價外追加暫估" :
                    measured ? `${item.widthCm}×${item.depthCm}cm，按現況圖比例畫；物件尺寸仍須核對` :
                        "尺寸待填"}；
                ${invalid ? "與牆線或固定設施相交，需確認；" : ""}按住可拖動）</title>
            ${symbol}
        </g>
        ${rotateHandle}
    </g>${dimensions}`;
}

function dimensionCm(value) {
    const rounded = Math.round(value);
    return Math.abs(value - rounded) < 0.15
        ? String(rounded) : String(Math.round(value * 10) / 10);
}

function renderRoomDimensions(room, geometry) {
    if (!geometry.cmScale) {
        return `<g class="detail-dimensions"><text x="${geometry.x + geometry.width / 2}"
            y="${geometry.y - 28}" text-anchor="middle">長寬待填</text></g>`;
    }
    const platform = room.id === "ac-platform";
    const drawing = Object.hasOwn(ROOM_DRAWING_DIMENSIONS, room.id)
        ? ROOM_DRAWING_DIMENSIONS[room.id] : null;
    const irregular = drawing?.kind === "bounds" || geometry.points.length !== 4;
    const widthCm = drawing?.widthCm ?? dimensionCm(geometry.width / geometry.cmScale);
    const depthCm = drawing?.depthCm ?? dimensionCm(geometry.height / geometry.cmScale);
    const labelWidth = platform ? `鐵窗跨度約 ${widthCm} cm` :
        `${irregular ? "外接" : ""}寬約 ${widthCm} cm`;
    const labelDepth = platform ? `外推深約 ${depthCm} cm` :
        `${irregular ? "外接" : ""}長約 ${depthCm} cm`;
    const x0 = geometry.x;
    const x1 = geometry.x + geometry.width;
    const y0 = geometry.y;
    const y1 = geometry.y + geometry.height;
    const horizontalY = platform ? y1 + 27 : y0 - 38;
    const horizontalLabelY = platform ? horizontalY + 22 : horizontalY - 12;
    const horizontalLabelX = platform ? x0 + Math.min(190, geometry.width / 2) :
        (x0 + x1) / 2;
    const verticalX = room.id === "bath-main" || room.id === "bath-guest"
        ? x0 - 72 : x0 - 38;
    const verticalLabelX = verticalX - 16;
    const midY = (y0 + y1) / 2;
    return `<g class="detail-dimensions" role="group"
        aria-label="${escapeSvg(room.name)}圖面長寬標註">
        <g class="room-width-dimension" data-dimension="width"
            data-width-cm="${widthCm}">
            <path d="M${x0} ${horizontalY} H${x1}
                M${x0} ${horizontalY - 7} V${horizontalY + 7}
                M${x1} ${horizontalY - 7} V${horizontalY + 7}"/>
            <text x="${horizontalLabelX}" y="${horizontalLabelY}"
                text-anchor="middle">${labelWidth}</text>
        </g>
        <g class="room-depth-dimension" data-dimension="depth"
            data-depth-cm="${depthCm}">
            <path d="M${verticalX} ${y0} V${y1}
                M${verticalX - 7} ${y0} H${verticalX + 7}
                M${verticalX - 7} ${y1} H${verticalX + 7}"/>
            <text x="${verticalLabelX}" y="${midY}"
                transform="rotate(-90 ${verticalLabelX} ${midY})"
                text-anchor="middle">${labelDepth}</text>
        </g>
    </g>`;
}

function renderWindowDimension(window, geometry) {
    const halfWidth = window.widthCm * geometry.cmScale / 2;
    const label = `W ${dimensionCm(window.widthCm)} cm`;
    let line;
    let x;
    let y;
    let align = "middle";
    if (window.side === "right") {
        const lineX = window.x + 19;
        line = `M${window.x + 6} ${window.y - halfWidth} H${lineX}
            M${lineX} ${window.y - halfWidth} V${window.y + halfWidth}
            M${lineX - 6} ${window.y - halfWidth} H${lineX + 6}
            M${lineX - 6} ${window.y + halfWidth} H${lineX + 6}`;
        x = lineX + 8;
        y = window.y + 5;
        align = "start";
    } else if (window.side === "top" || window.side === "bottom") {
        const lineY = window.side === "top" ? geometry.y + 23 :
            geometry.y + geometry.height + 24;
        line = `M${window.x - halfWidth} ${lineY} H${window.x + halfWidth}
            M${window.x - halfWidth} ${lineY - 6} V${lineY + 6}
            M${window.x + halfWidth} ${lineY - 6} V${lineY + 6}`;
        x = window.x;
        y = lineY + 19;
    } else if (window.side === "curve") {
        line = `M${window.x} ${window.y + 6} V${window.y + 26}`;
        x = window.x;
        y = window.y + 44;
    } else {
        throw new RangeError(`無法標註窗洞所在牆面：${window.side}`);
    }
    return `<g class="window-width-dimension" role="img"
        data-window-id="${escapeSvg(window.id)}"
        data-width-cm="${window.widthCm}"
        aria-label="${escapeSvg(window.label)}，窗洞寬 ${window.widthCm} 公分">
        <path d="${line}"/>
        <text x="${x}" y="${y}" text-anchor="${align}">${label}</text>
    </g>`;
}

export function renderRoomPlan(room, items, selectedItemId, allItems = items,
    showSource = false, activeLightIds = null,
    visibleLayers = DEFAULT_VISIBLE_LAYERS, focusedCircuitId = null,
    showRotateHandle = true, planeHeightCm = 80) {
    const geometry = roomGeometry(room);
    const margin = 110;
    const viewX = geometry.x - margin;
    const viewY = geometry.y - margin;
    const viewWidth = geometry.width + 2 * margin;
    const viewHeight = geometry.height + 2 * margin;
    const gridSize = 50 * (geometry.cmScale ?? PLAN_PIXELS_PER_CM);
    return `<svg class="room-svg ${showSource ? "with-source" : ""}"
        data-room-canvas="${escapeSvg(room.id)}"
        viewBox="${viewX} ${viewY} ${viewWidth} ${viewHeight}" role="group"
        aria-label="${escapeSvg(room.name)}：與全屋同一輪廓、方向及座標的放大圖；點房內可放置物件">
        <defs>
            <clipPath id="room-grid-clip"><path d="${geometry.path}"/></clipPath>
            <pattern id="room-grid" x="0" y="0" width="${gridSize}" height="${gridSize}"
                patternUnits="userSpaceOnUse">
                <path class="grid-line" d="M${gridSize} 0 H0 V${gridSize}"/>
            </pattern>
        </defs>
        <rect class="detail-paper" x="${viewX + 2}" y="${viewY + 2}"
            width="${viewWidth - 4}" height="${viewHeight - 4}" rx="10"/>
        ${showSource ? `<g class="plan-source-schematic">
            ${renderReferenceSchematic([room], {
                proposed: true, labels: false, windowsVisible: false, doorsVisible: false,
            })}
        </g>` : ""}
        ${geometry.traced ? `<path class="plan-existing-bay"
            d="${EXISTING_CURVED_BAY_PATH}"/>` : ""}
        ${geometry.traced && room.id !== "corridor"
            ? `<path class="detail-corridor" d="${CORRIDOR_PATH}"/>` : ""}
        <path class="detail-floor ${room.id === "entry" ||
            room.id === "living-dining" ? "entry-opening-floor" : ""}"
            d="${geometry.path}"/>
        ${entryLivingWall(geometry)}
        <rect class="detail-grid" x="${geometry.x}" y="${geometry.y}"
            width="${geometry.width}" height="${geometry.height}"
            fill="url(#room-grid)" clip-path="url(#room-grid-clip)"/>
        ${renderLightingPreview(geometry, items, activeLightIds, planeHeightCm)}
        ${activeLightIds !== null && visibleLayers.switches && visibleLayers.lights
            ? renderPreviewConnections([room], allItems, focusedCircuitId, room.id) : ""}
        ${room.id === "bedroom-2" ? renderBedroom2Partition(allItems) : ""}
        ${room.id === "balcony" && visibleLayers.furniture ? renderBalconySink() : ""}
        ${room.id === "ac-platform" ? renderExteriorPlatform(true, allItems) : ""}
        ${renderWetDryDivider(room.id, allItems, true)}
        ${visibleLayers.furniture
            ? renderKitchenShortWingFill(items, geometry, "room") : ""}
        ${doorsForRoom(room.id).map((door) =>
            renderDoor(door, allItems, false, room.id !== "corridor")).join("")}
        ${room.id === "entry" || room.id === "living-dining"
            ? renderEntryLivingPassage(false) : ""}
        ${windowsForRoom(room.id).map((window) => renderWindow(window, false)).join("")}
        ${renderRoomDimensions(room, geometry)}
        ${windowsForRoom(room.id).map((window) =>
            renderWindowDimension(window, geometry)).join("")}
        ${visibleLayers.furniture ? allItems.filter((item) => isActiveSplitAirConditioner(item) &&
            item.outdoorPlacement && (item.roomId === room.id ||
                room.id === "ac-platform" && OUTDOOR_AC_ZONES[item.roomId]?.platform))
            .map((item) => renderOutdoorAC(item, false, selectedItemId,
                showRotateHandle)).join("") : ""}
        ${visibleLayers.outlets ? renderCircuitPairings(geometry, items) : ""}
        ${items.filter((item) => item.kind !== "door" && item.placement &&
            markerVisible(item, visibleLayers) &&
            (!isSplitAirConditioner(item) || isActiveSplitAirConditioner(item)))
            .sort((a, b) => Boolean(a.outletPlanPointId) - Boolean(b.outletPlanPointId) ||
                kitchenDrawOrder(a, b))
            .map((item) => detailMarker(item, geometry, selectedItemId,
                activeLightIds !== null, showRotateHandle, items)).join("")}
        ${room.id === "balcony" && visibleLayers.furniture ?
            renderBalconyDemolition(allItems) : ""}
        <g class="detail-scale" transform="translate(${viewX + 22} ${viewY + 40})">
            <path d="M0 0 H${gridSize}
                M0 -5 V5 M${gridSize} -5 V5"/>
            <text x="${gridSize / 2}" y="-10" text-anchor="middle">50 cm</text>
        </g>
    </svg>`;
}
