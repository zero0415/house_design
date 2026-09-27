import { CEILING_LIGHT_PLACEHOLDER_MODEL } from "./ceiling-lights.js";
import { DOWNLIGHT_REFERENCE_MODEL } from "./downlights.js";
import {
    CORRIDOR_SPOTLIGHT_MODEL, CORRIDOR_SPOTLIGHT_PRICE_TWD,
    CORRIDOR_TRACK_MODEL, CORRIDOR_TRACK_PRICE_TWD,
} from "./track-lighting.js";
import { PLANNER_STATE_VERSION } from "./socket-plan.js";

export const DOWNLIGHT_FIXTURE_ESTIMATE_TWD = 200;
export const DOWNLIGHT_INSTALL_ESTIMATE_TWD = 750;

export function installedDownlightUnitPrice(fixtureUnitPrice, installationUnitPrice) {
    if (fixtureUnitPrice == null || installationUnitPrice == null) return null;
    if (!Number.isFinite(fixtureUnitPrice) || fixtureUnitPrice < 0 ||
        !Number.isFinite(installationUnitPrice) || installationUnitPrice < 0) {
        throw new RangeError("崁燈燈具與安裝拆估單價須為非負數。");
    }
    return Math.round((fixtureUnitPrice + installationUnitPrice +
        Number.EPSILON) * 100) / 100;
}

export const DOWNLIGHT_OPTIONS = Object.freeze({
    quoted: Object.freeze({
        label: "舞光索爾（原報價；燈具約200＋安裝約750）",
        model: DOWNLIGHT_REFERENCE_MODEL,
        wattageW: null,
        unitPrice: DOWNLIGHT_FIXTURE_ESTIMATE_TWD,
        source: "原報價｜水電工程；燈具暫拆 NT$200／顆參考 PChome 舞光索爾16W兩入組 NT$399：https://24h.pchome.com.tw/prod/DMALGB-A900GNHU7",
    }),
    "dance-12w": Object.freeze({
        label: "舞光索爾 12W／15cm（兩入均攤 NT$173.5／顆）",
        model: "舞光 LED 索爾平面嵌燈 12W／15cm（色溫待選）",
        wattageW: 12,
        unitPrice: 173.5,
        source: "PChome 24h（2026-09-27：兩入 NT$347，均攤 NT$173.5／顆）：https://24h.pchome.com.tw/prod/DQBP8O-A900JYBH4",
    }),
    custom: Object.freeze({
        label: "自訂嵌燈（請填燈具單價）",
        model: "嵌燈（自訂型號待填）",
        wattageW: null,
        unitPrice: null,
        source: "自訂燈具；採購單價與原含燈具折抵待廠商確認",
    }),
});

export const CEILING_LIGHT_OPTIONS = Object.freeze({
    pending: Object.freeze({
        label: "燈具待選（本體價格待填）",
        model: CEILING_LIGHT_PLACEHOLDER_MODEL,
        wattageW: null,
        unitPrice: null,
        source: "",
    }),
    "sylvania-32w": Object.freeze({
        label: "喜萬年 32W 調光調色（NT$690）",
        model: "喜萬年 32W LED 遙控／壁切調光調色吸頂燈",
        wattageW: 32,
        unitPrice: 690,
        source: "PChome 24h（2026-09-27 商品參考價 NT$690）：https://24h.pchome.com.tw/prod/DQBP3W-A900JM6PQ",
    }),
    "aiwa-32w": Object.freeze({
        label: "AIWA ALD-3201 32W（NT$1,692）",
        model: "AIWA 愛華 ALD-3201 32W LED 遙控調光調色吸頂燈",
        wattageW: 32,
        unitPrice: 1692,
        source: "PChome 24h（2026-09-27 商品參考價 NT$1,692）：https://24h.pchome.com.tw/prod/DQBP3W-A900JF9HE",
    }),
    custom: Object.freeze({
        label: "自訂吸頂燈（請填本體單價）",
        model: "吸頂燈（自訂型號待填）",
        wattageW: null,
        unitPrice: null,
        source: "自訂吸頂燈；本體價格待填，配線安裝另計",
    }),
    "outdoor-pending": Object.freeze({
        label: "陽台防潮吸頂燈待選（需確認戶外適用）",
        model: "陽台防潮吸頂燈（型號／防護等級待核）",
        wattageW: null,
        unitPrice: null,
        source: "",
    }),
    "outdoor-custom": Object.freeze({
        label: "自訂陽台防潮吸頂燈（請填單價）",
        model: "陽台防潮吸頂燈（自訂戶外型號待填）",
        wattageW: null,
        unitPrice: null,
        source: "自訂陽台防潮燈；防護等級、天花固定及價格待核",
    }),
});

export const TRACK_SPOTLIGHT_OPTIONS = Object.freeze({
    "tr-plus-12w": Object.freeze({
        label: "特力屋 12W 黑色自然光（屋主提供 NT$299）",
        model: CORRIDOR_SPOTLIGHT_MODEL,
        wattageW: 12,
        unitPrice: CORRIDOR_SPOTLIGHT_PRICE_TWD,
        source: "特力屋（屋主提供 12W 黑色自然光軌道燈 NT$299；商品連結待核）",
    }),
    "bright-12w": Object.freeze({
        label: "亮博士 12W 尊爵黑溫潤白（NT$320）",
        model: "亮博士 LED 軌道燈 12W 尊爵黑・溫潤白",
        wattageW: 12,
        unitPrice: 320,
        source: "PChome 24h（2026-09-27 商品參考價 NT$320；溫潤白並非原自然光）：https://24h.pchome.com.tw/prod/DQBP75-A900K5O1F",
    }),
    custom: Object.freeze({
        label: "自訂軌道燈（請填每盞單價）",
        model: "軌道燈（自訂型號待填）",
        wattageW: null,
        unitPrice: null,
        source: "自訂軌道燈；價格與軌道相容性待核",
    }),
});

export const TRACK_RAIL_OPTIONS = Object.freeze({
    "tr-plus-150": Object.freeze({
        label: "特力屋黑色軌道 1.5 米（屋主提供 NT$349）",
        model: CORRIDOR_TRACK_MODEL,
        unitPrice: CORRIDOR_TRACK_PRICE_TWD,
        source: "特力屋（屋主提供黑色 1.5 米軌道 NT$349；商品連結待核）",
    }),
    custom: Object.freeze({
        label: "自訂 1.5 米軌道（請填單價）",
        model: "軌道 1.5 米（自訂型號待填）",
        unitPrice: null,
        source: "自訂 1.5 米軌道；價格、軌道與燈具相容性待核",
    }),
});

export function legacyLightWatts(entry) {
    const type = entry.lightType ?? entry.type;
    const selected = type === "ceiling" ? CEILING_LIGHT_OPTIONS[entry.lightSelection] :
        type === "recessed" ? DOWNLIGHT_OPTIONS[entry.lightSelection] :
            type === "track" ? TRACK_SPOTLIGHT_OPTIONS[entry.spotlightSelection] : null;
    if (selected?.wattageW != null) return selected.wattageW;
    const model = type === "track" ? entry.spotlightModel : entry.brandModel;
    const match = typeof model === "string"
        ? model.match(/(\d+(?:\.\d+)?)\s*[WＷ](?![A-Za-z])/i) : null;
    return match ? Number(match[1]) : null;
}

function upgradeLightRecord(entry) {
    const type = entry.lightType ?? entry.type;
    if (!["ceiling", "recessed", "track"].includes(type)) return entry;
    return {
        ...entry,
        lightWatts: entry.lightWatts === undefined ? legacyLightWatts(entry) : entry.lightWatts,
        lightLumens: entry.lightLumens === undefined ? null : entry.lightLumens,
        beamAngleDeg: entry.beamAngleDeg === undefined ? null : entry.beamAngleDeg,
        lightSpecSource: entry.lightSpecSource === undefined ? "" : entry.lightSpecSource,
    };
}

export function upgradeLegacyLightingState(data) {
    if (data?.version !== 4 || !Array.isArray(data.rooms) ||
        !Array.isArray(data.items) || data.products != null &&
            !Array.isArray(data.products)) {
        throw new TypeError("舊版照明資料缺少完整房間、物件或商品清單。");
    }
    const rooms = (snapshot) => snapshot.map((room) => ({
        ...room,
        ceilingHeightCm: room.ceilingHeightCm === undefined ? null : room.ceilingHeightCm,
    }));
    const items = (snapshot) => snapshot.map(upgradeLightRecord);
    const products = (snapshot) => snapshot.map(upgradeLightRecord);
    const undo = data.undo == null || !Array.isArray(data.undo.rooms) ||
        !Array.isArray(data.undo.items) || !Array.isArray(data.undo.products)
        ? data.undo : {
            ...data.undo,
            rooms: rooms(data.undo.rooms),
            items: items(data.undo.items),
            products: products(data.undo.products),
        };
    return {
        ...data, version: PLANNER_STATE_VERSION,
        rooms: rooms(data.rooms),
        items: items(data.items),
        products: products(data.products ?? []),
        undo,
    };
}
