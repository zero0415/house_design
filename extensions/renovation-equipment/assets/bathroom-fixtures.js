export const BATHROOM_FRESH_AIR = Object.freeze({
    "bath-main": Object.freeze({
        id: "bath-main-heater",
        placement: Object.freeze({ x: 0.436, y: 0.205 }),
    }),
    "bath-guest": Object.freeze({
        id: "bath-guest-heater",
        placement: Object.freeze({ x: 0.649, y: 0.532 }),
    }),
});

export const BATHROOM_RINSE_KITS = Object.freeze({
    "bath-main": Object.freeze({
        id: "bath-main-rinse-kit",
        placement: Object.freeze({ x: 0.366, y: 0.615 }),
    }),
    "bath-guest": Object.freeze({
        id: "bath-guest-rinse-kit",
        placement: Object.freeze({ x: 0.655, y: 0.353 }),
    }),
});

export const RINSE_KIT_REFERENCE_PRICE_TWD = 769;

export const BATHROOM_HEATED_TOWEL_RAILS = Object.freeze({
    "bath-main": Object.freeze({
        id: "bath-main-heated-towel-rail",
        placement: Object.freeze({ x: 0.330, y: 0.077 }),
    }),
    "bath-guest": Object.freeze({
        id: "bath-guest-heated-towel-rail",
        placement: Object.freeze({ x: 0.655, y: 0.039 }),
    }),
});

export const GUEST_BATH_GRAB_BAR = Object.freeze({
    id: "bath-guest-tub-grab-bar",
    roomId: "bath-guest",
    placement: Object.freeze({ x: 0.191, y: 0.083 }),
});

export function isFreshAirUnit(item) {
    return item?.equipmentType === "fresh-air";
}

export function isToiletRinseKit(item) {
    return item?.equipmentType === "rinse-kit";
}

export function isHeatedTowelRail(item) {
    return item?.equipmentType === "heated-towel-rail";
}

export function isBathGrabBar(item) {
    return item?.equipmentType === "bath-grab-bar";
}
