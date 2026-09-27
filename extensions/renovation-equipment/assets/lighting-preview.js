import { PLAN_PIXELS_PER_CM, pointInZone } from "./house-geometry.js";

export const ILLUSTRATIVE_LIGHT_RANGE_CM = Object.freeze({
    ceiling: 140,
    "ceiling-32w": 170,
    "ceiling-outdoor": 100,
    recessed: 100,
    "recessed-12w": 85,
    track: 85,
});
export const LIGHT_PREVIEW_PLANES_CM = Object.freeze({ floor: 0, desk: 80 });

export function isPlacedLight(item) {
    return item?.placement != null &&
        (item.lightType === "ceiling" || item.lightType === "recessed" ||
            item.lightType === "track" && item.spotlightQuantity > 0);
}

function validatePlane(heightCm) {
    if (!Object.values(LIGHT_PREVIEW_PLANES_CM).includes(heightCm)) {
        throw new RangeError("照度評估平面須選地板或 80cm 高的桌面。");
    }
}

export function lightDataStatus(item, room, planeHeightCm = 80) {
    validatePlane(planeHeightCm);
    const missing = [];
    if (item.lightLumens == null) missing.push("流明");
    if (item.beamAngleDeg == null) missing.push("光束角");
    if (!item.lightSpecSource?.trim()) missing.push("光學資料來源");
    if (room.ceilingHeightCm == null) missing.push("天花淨高");
    else if (room.ceilingHeightCm <= planeHeightCm) {
        throw new RangeError("天花高度須高於目前選定的照度評估平面。");
    }
    if (room.cmScale === null) missing.push("房間平面尺寸");
    return {
        mode: missing.length ? item.lightWatts == null
            ? "default-illustration" : "watt-relative" : "lux-estimate",
        missing,
    };
}

function legacyLightRangeCm(item) {
    if (item.lightType === "ceiling") {
        if (item.roomId === "balcony") return ILLUSTRATIVE_LIGHT_RANGE_CM["ceiling-outdoor"];
        if (["sylvania-32w", "aiwa-32w"].includes(item.lightSelection)) {
            return ILLUSTRATIVE_LIGHT_RANGE_CM["ceiling-32w"];
        }
    }
    if (item.lightType === "recessed" && item.lightSelection === "dance-12w") {
        return ILLUSTRATIVE_LIGHT_RANGE_CM["recessed-12w"];
    }
    return ILLUSTRATIVE_LIGHT_RANGE_CM[item.lightType] ?? 0;
}

function lightParameters(item, room, planeHeightCm) {
    const { mode } = lightDataStatus(item, room, planeHeightCm);
    const scale = room.cmScale ?? PLAN_PIXELS_PER_CM;
    if (mode === "lux-estimate") {
        const heightM = (room.ceilingHeightCm - planeHeightCm) / 100;
        const halfBeam = item.beamAngleDeg * Math.PI / 360;
        const intensityCd = item.lightLumens /
            (2 * Math.PI * (1 - Math.cos(halfBeam)));
        const centerLux = intensityCd / (heightM * heightM);
        const radius = Math.min(heightM * 100 * Math.tan(halfBeam) * scale,
            Math.hypot(room.width, room.height) + 50 * scale);
        return {
            mode, radius, centerLux, heightM, halfBeam, intensityCd,
            opacity: Math.max(.35, Math.min(1, Math.sqrt(centerLux / 300))),
        };
    }
    if (item.lightWatts == null) {
        return { mode, radius: legacyLightRangeCm(item) * scale, opacity: 1 };
    }
    const reference = item.lightType === "ceiling"
        ? { watts: 32, radius: item.roomId === "balcony" ? 100 : 170 }
        : { watts: 12, radius: 85 };
    const ratio = Math.sqrt(item.lightWatts / reference.watts);
    return {
        mode,
        radius: Math.max(40, Math.min(400, reference.radius * ratio)) * scale,
        opacity: Math.max(.45, Math.min(1, ratio)),
    };
}

export function lightSourcesForRoom(room, items, activeLightIds, planeHeightCm = 80) {
    if (!(activeLightIds instanceof Set)) {
        throw new TypeError("照明模擬須提供已開啟的燈具清單。");
    }
    validatePlane(planeHeightCm);
    return items.filter((item) => item.roomId === room.id && isPlacedLight(item) &&
        activeLightIds.has(item.id)).flatMap((item) => {
        const x = room.x + item.placement.x * room.width;
        const y = room.y + item.placement.y * room.height;
        const light = lightParameters(item, room, planeHeightCm);
        if (item.lightType !== "track") return [{ x, y, ...light, itemId: item.id }];
        if (!Number.isSafeInteger(item.spotlightQuantity) ||
            item.spotlightQuantity < 1 || item.spotlightQuantity > 12 ||
            !Number.isFinite(item.trackLengthCm) || item.trackLengthCm <= 0) {
            throw new RangeError("軌道燈盞數或軌道長度無效，無法模擬照明。");
        }
        const length = item.trackLengthCm * (room.cmScale ?? PLAN_PIXELS_PER_CM);
        const angle = (item.orientation ?? 0) * Math.PI / 180;
        return Array.from({ length: item.spotlightQuantity }, (_, index) => ({
            x: x - ((index + .5) / item.spotlightQuantity * length - length / 2) *
                Math.sin(angle),
            y: y + ((index + .5) / item.spotlightQuantity * length - length / 2) *
                Math.cos(angle),
            ...light,
            itemId: item.id,
        }));
    });
}

function directLux(source, distanceM) {
    if (Math.atan2(distanceM, source.heightM) > source.halfBeam) return 0;
    const squared = source.heightM ** 2 + distanceM ** 2;
    // Uniform-cone direct illuminance only; room reflections and obstructions are not modeled.
    return source.intensityCd * source.heightM / squared ** 1.5;
}

export function estimateRoomIlluminance(room, items, activeLightIds,
    planeHeightCm = 80) {
    const placed = items.filter((item) => item.roomId === room.id && isPlacedLight(item));
    const incomplete = placed.map((item) => ({ item,
        ...lightDataStatus(item, room, planeHeightCm) }))
        .filter((entry) => entry.mode !== "lux-estimate");
    const sources = lightSourcesForRoom(room, items, activeLightIds, planeHeightCm);
    const complete = sources.filter((source) => source.mode === "lux-estimate");
    if (!complete.length) return {
        minLux: null, averageLux: null, maxLux: null, sampleCount: 0,
        completeCount: 0, incomplete,
    };
    const scale = room.cmScale ?? PLAN_PIXELS_PER_CM;
    const step = Math.max(40 * scale, Math.max(room.width, room.height) / 48);
    let minimum = Infinity;
    let maximum = 0;
    let total = 0;
    let count = 0;
    for (let y = room.y + step / 2; y < room.y + room.height; y += step) {
        for (let x = room.x + step / 2; x < room.x + room.width; x += step) {
            if (!pointInZone(room, x, y)) continue;
            const lux = complete.reduce((amount, source) =>
                amount + directLux(source,
                    Math.hypot(x - source.x, y - source.y) / scale / 100), 0);
            minimum = Math.min(minimum, lux);
            maximum = Math.max(maximum, lux);
            total += lux;
            count++;
        }
    }
    return {
        minLux: count ? minimum : null,
        averageLux: count ? total / count : null,
        maxLux: count ? maximum : null,
        sampleCount: count,
        completeCount: complete.length,
        incomplete,
    };
}

export function renderLightingPreview(room, items, activeLightIds,
    planeHeightCm = 80) {
    if (activeLightIds === null) return "";
    const sources = lightSourcesForRoom(room, items, activeLightIds, planeHeightCm);
    const clipId = `lighting-clip-${room.id}`;
    const glowId = `lighting-glow-${room.id}`;
    return `<g class="lighting-preview" aria-hidden="true" pointer-events="none">
        <defs>
            <clipPath id="${clipId}"><path d="${room.path}"/></clipPath>
            <radialGradient id="${glowId}">
                <stop offset="0%" stop-color="#fff4ba" stop-opacity=".98"/>
                <stop offset="46%" stop-color="#ffdf76" stop-opacity=".81"/>
                <stop offset="78%" stop-color="#ffd46a" stop-opacity=".36"/>
                <stop offset="100%" stop-color="#ffd46a" stop-opacity="0"/>
            </radialGradient>
        </defs>
        <path class="lighting-preview-dark" d="${room.path}"/>
        <g clip-path="url(#${clipId})">
            ${sources.map(({ x, y, radius, itemId, mode, opacity, centerLux }) =>
                `<circle class="lighting-preview-glow" data-light-source="${itemId}"
                    data-preview-mode="${mode}"
                    ${centerLux == null ? "" :
                        `data-estimated-center-lux="${Math.round(centerLux * 10) / 10}"`}
                    cx="${x}" cy="${y}" r="${radius}" opacity="${opacity}"
                    fill="url(#${glowId})"/>`).join("")}
        </g>
    </g>`;
}
