export const BATHROOM_INSTALLATION_QUOTE = Object.freeze({
    suites: 2,
    unitPriceTWD: 8000,
    totalTWD: 16000,
});

const BATHROOM_ROOMS = new Set(["bath-main", "bath-guest"]);
const INCLUDED_FIXTURE_IDS = new Set([
    ...[...BATHROOM_ROOMS].flatMap((roomId) =>
        ["toilet", "vanity", "basin-tap", "shower"]
            .map((suffix) => `${roomId}-${suffix}`)),
    "bath-main-urinal-u0211-a624",
    "bath-guest-tub",
]);

export function isBathroomFixtureId(id) {
    return INCLUDED_FIXTURE_IDS.has(id);
}

export function isBathroomInstallationIncluded(item) {
    return item?.kind === "equipment" && BATHROOM_ROOMS.has(item.roomId) &&
        isBathroomFixtureId(item.id);
}

export function normalizeBathroomInstallationNote(item) {
    if (!isBathroomInstallationIncluded(item)) return item.note;
    return item.note.replace(
        "PChome商品標示不含安裝；價格可能變動。",
        "PChome商品售價不含安裝；原報兩套衛浴安裝已含，本件另加 NT$0；價格可能變動。",
    ).replace(
        "固定方式與安裝費待確認。",
        "固定方式與超出原安裝額度的補差待確認；本件安裝另加 NT$0（原報已含）。",
    ).replace(
        "排水與安裝費均待確認。",
        "排水改管與超出原安裝額度的補差待核；本件安裝另加 NT$0（原報已含）。",
    );
}
