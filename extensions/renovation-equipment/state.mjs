import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { FURNITURE_TEMPLATES } from "./assets/furniture.js";
import { ROOM_DRAWING_DIMENSIONS } from "./assets/house-geometry.js";
import { DOOR_OPTIONS } from "./assets/door-options.js";
import { QUOTED_SLIDE_TRACKS, SLIDE_TRACK_RATE_TWD } from "./assets/slide-tracks.js";
import {
    BEDROOM2_PARTITION_ID, BEDROOM2_PARTITION_OPTIONS, BEDROOM2_PARTITION_QUOTED_AREA,
} from "./assets/partition-options.js";
import {
    QUOTED_SWITCHES, SWITCH_QUOTED_UNIT_PRICE_TWD, SWITCH_TYPES,
    switchOptionFor,
} from "./assets/switch-options.js";
import {
    createQuotedCircuitItems, createQuotedOutletItems, isDedicatedCircuit, isSocket,
    PLANNER_STATE_VERSION, QUOTED_CIRCUIT_BY_ID, QUOTED_OUTLET_BY_ID,
    SOCKET_PLAN_VERSION, SOCKET_UNIT_PRICE_TWD, DEDICATED_CIRCUIT_UNIT_PRICE_TWD,
    upgradeLegacySocketPlan,
    isWeakCurrent, QUOTED_WEAK_CURRENT_IDS, WEAK_CURRENT_UNIT_PRICE_TWD,
} from "./assets/socket-plan.js";
import {
    DOWNLIGHT_QUOTED_UNIT_PRICE_TWD, QUOTED_DOWNLIGHTS,
} from "./assets/downlights.js";
import {
    CEILING_LIGHT_INSTALL_UNIT_PRICE_TWD, CEILING_LIGHTS,
} from "./assets/ceiling-lights.js";
import {
    CORRIDOR_SPOTLIGHT_PRICE_TWD,
    CORRIDOR_TRACK_ID, CORRIDOR_TRACK_INSTALL_PRICE_TWD, CORRIDOR_TRACK_LENGTH_CM,
    CORRIDOR_TRACK_PLACEMENT, CORRIDOR_TRACK_PRICE_TWD,
} from "./assets/track-lighting.js";
import {
    CEILING_LIGHT_OPTIONS, DOWNLIGHT_FIXTURE_ESTIMATE_TWD,
    DOWNLIGHT_INSTALL_ESTIMATE_TWD, DOWNLIGHT_OPTIONS, installedDownlightUnitPrice,
    legacyLightWatts, TRACK_RAIL_OPTIONS, TRACK_SPOTLIGHT_OPTIONS,
} from "./assets/lighting-options.js";
import {
    BATHROOM_FRESH_AIR, BATHROOM_HEATED_TOWEL_RAILS, BATHROOM_RINSE_KITS,
    GUEST_BATH_GRAB_BAR, RINSE_KIT_REFERENCE_PRICE_TWD,
} from "./assets/bathroom-fixtures.js";
import {
    AC_ROOM_IDS, isSplitAirConditioner, OUTDOOR_AC_ESTIMATED_SIZE_CM,
    OUTDOOR_AC_SIZE_BOUNDS_CM, OUTDOOR_AC_ZONES, outdoorACZoneChoices,
} from "./assets/ac-outdoors.js";
import { ORIGINAL_QUOTE_TWD, calculateBudget, calculatePlanTotal } from "./assets/budget.js";
import {
    linkedProductMismatch, productUnit, PRODUCT_ENVIRONMENTS, PRODUCT_TYPES,
} from "./assets/product-database.js";

const ROOM_DEFINITIONS = [
    ["bath-main", "衛浴1（主浴）"],
    ["bath-guest", "衛浴2（客浴）"],
    ["master", "主臥"],
    ["bedroom-1", "臥室1"],
    ["bedroom-2", "臥室2"],
    ["bedroom-3", "臥室3"],
    ["living-dining", "客餐廳"],
    ["corridor", "走廊"],
    ["kitchen", "廚房"],
    ["studio", "工作室"],
    ["balcony", "陽台"],
    ["ac-platform", "外推鐵窗（設備暫位）"],
    ["entry", "玄關"],
];

const BATHROOM_EQUIPMENT = [
    ["toilet", "馬桶", "座", ""],
    ["vanity", "面盆、浴櫃／檯面", "組", ""],
    ["basin-tap", "面盆龍頭", "組", ""],
    ["shower", "淋浴龍頭、花灑／蓮蓬頭", "組", ""],
    ["mirror", "鏡子／鏡櫃", "面", ""],
    ["accessories", "置物、毛巾架等配件", "組",
        "此筆只預留一般五金；電熱毛巾架另列，避免重複。確認原報價安裝含哪些配件。"],
    ["heater", "新風機本體（室外進氣）", "台",
        "真正室外進氣的新風機，機型、衛浴防潮適用性與本體價格待確認。"],
];

const HEATER_INSTALL_UNIT_PRICE_TWD = 2500;
const FRESH_AIR_MODEL = "新風機（室外進氣；浴室適用型號待選）";
const FRESH_AIR_NOTE =
    "此處要引入室外空氣，非暖風乾燥機或單純排風扇；先前 Panasonic FV-30BUY3R 暖風機型號及 NT$6,600 價格不適用，已取消。圖示只標討論位置，不代表實際機身大小或進氣管線；兩間衛浴是否有合適外牆進氣路徑、防潮等級、排濕配套、開孔與電路，須由廠商確認後選機報價。";

const BATHROOM_POSITIONS = {
    "bath-main": {
        toilet: { x: 0.28, y: 0.75 },
        vanity: { x: 0.49, y: 0.78 },
        "basin-tap": { x: 0.51, y: 0.52 },
        shower: { x: 0.79, y: 0.76 },
    },
    "bath-guest": {
        toilet: { x: 0.78, y: 0.26 },
        vanity: { x: 0.51, y: 0.24 },
        "basin-tap": { x: 0.50, y: 0.49 },
        shower: { x: 0.18, y: 0.78 },
    },
};

const BATHROOM_QUOTED_LINES = [
    ["wet-dry-glass", "乾濕分離(一字)", 22000,
        "無框強化玻璃／含h門檻",
        "原報價門片工程：2 間 × 22,000 元；此筆為本房 1 間的份額。圖上乾濕分離虛線與玻璃門位僅供配置參考，實際長度與門洞淨寬待現場確認。"],
    ["safety-film", "防爆膜(一字)", 3000,
        "防爆膜（原報價未列型號）",
        "原報價門片工程：2 間 × 3,000 元；此筆為本房 1 間的份額，與同房乾濕分離玻璃搭配。"],
];
const QUOTED_BATH_EQUIPMENT = new Map(["bath-main", "bath-guest"].flatMap((roomId) =>
    BATHROOM_QUOTED_LINES.map(([suffix, name, unitPrice, brandModel, note]) => [
        `${roomId}-${suffix}`, {
            roomId, name, unit: "間", unitPrice, brandModel, note,
            priceSource: "原報價｜門片工程",
        },
    ])));
for (const roomId of ["bath-main", "bath-guest"]) {
    QUOTED_BATH_EQUIPMENT.set(`${roomId}-heater-install`, {
        roomId,
        name: "新風機安裝（暫借原暖風機額度）",
        unit: "組",
        unitPrice: HEATER_INSTALL_UNIT_PRICE_TWD,
        brandModel: "新風機安裝暫估（原報價實為暖風機）",
        priceSource: "原報價｜水電工程「暖風機安裝」（暫借額度，改裝新風機待重報）",
        note: "原 PDF 報的是「暖風機安裝」2 組 × NT$2,500＝NT$5,000，不是新風機安裝。依屋主指示暫以每間 NT$2,500 作新風機安裝規劃額度，原報價基準保留、不重複追加；是否可抵用及外牆進氣開孔、風管、防潮和電路費用，須由廠商重新核價。",
    });
}
const QUOTED_TRACK_BY_ID = new Map(QUOTED_SLIDE_TRACKS.map((track) => [track.id, track]));
const QUOTED_SWITCH_BY_ID = new Map(QUOTED_SWITCHES.map((entry) => [entry.id, entry]));
const QUOTED_DOWNLIGHT_BY_ID = new Map(QUOTED_DOWNLIGHTS.map((entry) => [entry.id, entry]));
const FRESH_AIR_ROOM_BY_ID = new Map(
    Object.entries(BATHROOM_FRESH_AIR).map(([roomId, entry]) => [entry.id, roomId])
);
const RINSE_KIT_ROOM_BY_ID = new Map(
    Object.entries(BATHROOM_RINSE_KITS).map(([roomId, entry]) => [entry.id, roomId])
);
const TOWEL_RAIL_ROOM_BY_ID = new Map(
    Object.entries(BATHROOM_HEATED_TOWEL_RAILS).map(([roomId, entry]) => [entry.id, roomId])
);
const CEILING_LIGHT_BY_ID = new Map(
    CEILING_LIGHTS.map((entry) => [entry.id, entry])
);

const QUOTED_DOORS = [
    ["master", "master", "主臥門", "solid-wood"],
    ["main-bath-master", "bath-main", "主浴門（通主臥）", "solid-wood"],
    ["bedroom-1", "bedroom-1", "臥室1門", "wood-fiber"],
    ["studio", "studio", "工作室門（走道側）", "wood-fiber"],
    ["bedroom-3", "bedroom-3", "臥室3門", "wood-fiber"],
    ["main-bath-hall", "bath-main", "主浴門（通客廳）", "bathroom"],
    ["guest-bath", "bath-guest", "客浴門", "bathroom"],
    ["main-shower", "bath-main", "主浴乾濕分離玻璃門位", "shower-glass"],
    ["guest-shower", "bath-guest", "客浴乾濕分離玻璃門位", "shower-glass"],
    ["bedroom-2", "bedroom-2", "臥室2滑門", "wood-slide"],
    ["balcony", "studio", "工作室－陽台拉門", "wood-slide"],
];

const ID = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/;

export class StoreError extends Error {
    constructor(status, message, latest) {
        super(message);
        this.status = status;
        this.latest = latest;
    }
}

export function initialState() {
    const rooms = ROOM_DEFINITIONS.map(([id, name]) => {
        const drawing = Object.hasOwn(ROOM_DRAWING_DIMENSIONS, id)
            ? ROOM_DRAWING_DIMENSIONS[id] : null;
        return {
            id, name, widthCm: drawing?.widthCm ?? null, depthCm: drawing?.depthCm ?? null,
            dimensionStatus: drawing ? "estimated" : null, ceilingHeightCm: null,
        };
    });
    const items = rooms.slice(0, 2).flatMap((room) =>
        BATHROOM_EQUIPMENT.map(([suffix, name, unit, note]) => {
            const placement = suffix === "heater"
                ? BATHROOM_FRESH_AIR[room.id].placement :
                    BATHROOM_POSITIONS[room.id][suffix] ?? null;
            const isToilet = suffix === "toilet";
            return {
                id: `${room.id}-${suffix}`,
                roomId: room.id,
                name,
                quantity: (placement || suffix === "heater") ? 1 : null,
                unit,
                brandModel: suffix === "heater"
                    ? FRESH_AIR_MODEL
                    : isToilet ? "TOTO CW288SGUR" : "TOTO（品牌暫填，型號待選）",
                unitPrice: isToilet ? 19035 : null,
                priceCurrency: "TWD",
                priceSource: isToilet
                    ? "PChome 24h：https://24h.pchome.com.tw/prod/DEDW02-A900IZ2PV" : "",
                note: note + (placement ? suffix === "heater"
                    ? "依等比例格局圖暫定機身位置；室外進氣管線須現場核對。" :
                        "依原格局圖暫定位置；實際尺寸與排水需確認。" : "") +
                    (isToilet ? "PChome售價不含安裝，價格可能變動。" : "") +
                    (suffix === "heater" ? FRESH_AIR_NOTE : ""),
                placement: placement ? { ...placement } : null,
                orientation: null,
                kind: "equipment",
                furnitureType: null,
                widthCm: isToilet ? 45.2 : null,
                depthCm: isToilet ? 72.2 : null,
                equipmentType: suffix === "heater" ? "fresh-air" : null,
            };
        }),
    );
    items.push(...Object.entries(BATHROOM_RINSE_KITS).map(([roomId, entry]) => ({
        id: entry.id,
        roomId,
        name: "三叉管＋馬桶沖洗器",
        quantity: 1,
        unit: "組",
        brandModel: "特力屋三叉管與沖洗器組（商品型號待核）",
        unitPrice: RINSE_KIT_REFERENCE_PRICE_TWD,
        priceCurrency: "TWD",
        priceSource: "特力屋（屋主提供每組 NT$769；商品連結待核）",
        note: "每間衛浴馬桶旁暫放 1 組三叉管與手持沖洗器，兩間各 NT$769 為原報價外的設備追加，商品安裝費未確認。須核對馬桶進水接頭、既有免治便座分水需求、水壓、止回防漏及走管位置；原報衛浴安裝是否含此五金須請水電確認，勿預先重複算工。",
        placement: { ...entry.placement },
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
        equipmentType: "rinse-kit",
        quotedUnitPrice: null,
        quotedQuantity: null,
    })));
    items.push(...Object.entries(BATHROOM_HEATED_TOWEL_RAILS).map(([roomId, entry]) => ({
        id: entry.id,
        roomId,
        name: "電熱毛巾架",
        quantity: 1,
        unit: "支",
        brandModel: "電熱毛巾架（尺寸／型號／防潮等級待選）",
        unitPrice: null,
        priceCurrency: "TWD",
        priceSource: "",
        note: "暫標在衛浴非淋浴側的牆面；小圖示非實際寬度、壁掛高度或電源點。原報價未明列電熱毛巾架本體與專用配線，型號、本體價、安裝及必要迴路待報；須確認防潮防觸電、牆面承重與防水層固定，不當作原一般毛巾架五金重複計價。",
        placement: { ...entry.placement },
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
        equipmentType: "heated-towel-rail",
        quotedUnitPrice: null,
        quotedQuantity: null,
    })));
    items.push({
        id: GUEST_BATH_GRAB_BAR.id,
        roomId: GUEST_BATH_GRAB_BAR.roomId,
        name: "浴缸牆面防滑扶手",
        quantity: 1,
        unit: "支",
        brandModel: "浴缸防滑扶手（型號／長度待選）",
        unitPrice: null,
        priceCurrency: "TWD",
        priceSource: "",
        note: "客浴浴缸上方牆面先以小圖示標示扶手討論位置；沒有實測牆體、材料、安裝高度或扶手承重。原報價未明列此扶手本體與固定補強，價格與安裝待報；不能只固定在磁磚面，實際位置、結構錨固、防水收邊須由現場專業人員確認。",
        placement: { ...GUEST_BATH_GRAB_BAR.placement },
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
        equipmentType: "bath-grab-bar",
        quotedUnitPrice: null,
        quotedQuantity: null,
    });
    items.push(...Array.from(QUOTED_BATH_EQUIPMENT, ([id, line]) => ({
        id,
        roomId: line.roomId,
        name: line.name,
        quantity: 1,
        unit: line.unit,
        brandModel: line.brandModel,
        unitPrice: line.unitPrice,
        priceCurrency: "TWD",
        priceSource: line.priceSource,
        note: line.note,
        placement: null,
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
        quotedUnitPrice: line.unitPrice,
        quotedQuantity: 1,
    })));
    items.push(...QUOTED_SLIDE_TRACKS.map((track) => ({
        id: track.id,
        roomId: track.roomId,
        name: track.name,
        quantity: track.quotedLengthM,
        unit: "米",
        brandModel: "滑門軌道（型式待確認）",
        unitPrice: SLIDE_TRACK_RATE_TWD,
        priceCurrency: "TWD",
        priceSource: "原報價｜輕隔間工程",
        note: `原報價「滑門軌道－主浴.工作室」合計 1.6 米 × 1,800 元＝2,880 元；
            依屋主指示暫分這道拉門 0.8 米、1,440 元。軌道長度為暫估，
            未含於此筆的門片本體仍須另議；取消或轉用已含軌道門片的減項須廠商確認。`,
        placement: null,
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
        trackDoorId: track.doorId,
        quotedUnitPrice: SLIDE_TRACK_RATE_TWD,
        quotedQuantity: track.quotedLengthM,
    })));
    const partition = BEDROOM2_PARTITION_OPTIONS["double-double"];
    items.push({
        id: BEDROOM2_PARTITION_ID,
        roomId: "bedroom-2",
        name: "臥室2輕隔間（對客廳／走廊）",
        quantity: BEDROOM2_PARTITION_QUOTED_AREA,
        unit: "坪",
        brandModel: partition.specification,
        unitPrice: partition.unitPrice,
        priceCurrency: "TWD",
        priceSource: "原報價｜輕隔間工程",
        note: "原報價兩面牆合計 5 坪，雙面雙層每坪 7,000 元，共 35,000 元。雙面單層每坪 5,800 元與單面單層每坪 3,900 元在原表均未填數量、本次計 0 元；切換時僅沿用本房 5 坪暫估價差，並非原報價已有替代做法。單面做法另一側的表面、隔音與施工範圍須請廠商核對。圖線色與線重只作材料區別，非實際牆厚。",
        placement: null,
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
        partitionMaterial: "double-double",
        quotedUnitPrice: partition.unitPrice,
        quotedQuantity: BEDROOM2_PARTITION_QUOTED_AREA,
    });
    items.push(...QUOTED_SWITCHES.map((entry) => ({
        id: entry.id,
        roomId: entry.roomId,
        name: entry.name,
        quantity: 1,
        unit: "個",
        brandModel: SWITCH_TYPES.double.brandModel,
        unitPrice: SWITCH_QUOTED_UNIT_PRICE_TWD,
        priceCurrency: "TWD",
        priceSource: "原報價｜水電工程",
        note: `暫標${entry.purpose}；位置及控制迴路須現場確認。原水電報價
            「單/雙開關配置」15 個 × 2,250 元＝33,750 元，說明為太平洋電線
            （1.6/2.0mm²）、CD 硬管、國際牌 Risna 黑灰色開關；初始以雙開關規劃，
            日後切換單開關時不臆測價差。${entry.roomId.startsWith("bath-")
                ? "圖面只標乾區附近的控制點，實際應避開濕區並由電工確認。" : ""}`,
        placement: { ...entry.placement },
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
        switchType: "double",
        switchEnvironment: "indoor",
        switchPlanStatus: "active",
        quotedUnitPrice: SWITCH_QUOTED_UNIT_PRICE_TWD,
        quotedQuantity: 1,
    })));
    const outlets = createQuotedOutletItems();
    items.push(...outlets, ...createQuotedCircuitItems(outlets));
    items.push(...QUOTED_DOWNLIGHTS.map((entry) => ({
        id: entry.id,
        roomId: entry.roomId,
        name: entry.name,
        quantity: 1,
        unit: "個",
        brandModel: DOWNLIGHT_OPTIONS.quoted.model,
        unitPrice: DOWNLIGHT_QUOTED_UNIT_PRICE_TWD,
        fixtureUnitPrice: DOWNLIGHT_FIXTURE_ESTIMATE_TWD,
        installationUnitPrice: DOWNLIGHT_INSTALL_ESTIMATE_TWD,
        lightSelection: "quoted",
        priceCurrency: "TWD",
        priceSource: DOWNLIGHT_OPTIONS.quoted.source,
        note: `原水電報價「崁燈安裝－廁所.廚房」6 個 × 950 元＝5,700 元；
            此筆每個 950 元已含舞光 LED 索爾嵌燈、配線及安裝，勿再重複計費。
            暫拆燈具約 200 元與配線安裝約 750 元只供換款試算，非廠商拆價。
            暫標${entry.purpose}，天花開孔與迴路待確認。更換燈具時須請廠商
            重報含配線與安裝的單價。${entry.purpose.includes("濕區")
                ? "靠近濕區的燈具須確認適用的防護等級與安裝位置。" : ""}`,
        placement: { ...entry.placement },
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
        lightType: "recessed",
        quotedUnitPrice: DOWNLIGHT_QUOTED_UNIT_PRICE_TWD,
        quotedQuantity: 1,
    })));
    items.push(...CEILING_LIGHTS.map((entry) => ({
        id: entry.id,
        roomId: entry.roomId,
        name: entry.name,
        quantity: 1,
        unit: "盞",
        brandModel: CEILING_LIGHT_OPTIONS[
            entry.roomId === "balcony" ? "outdoor-pending" : "pending"].model,
        unitPrice: null,
        lightSelection: entry.roomId === "balcony" ? "outdoor-pending" : "pending",
        installationUnitPrice: CEILING_LIGHT_INSTALL_UNIT_PRICE_TWD,
        priceCurrency: "TWD",
        priceSource: "",
        note: `此房吸頂燈本體自備，型號、尺寸與採購價待選。原水電報價
            「吸頂燈安裝」未填數量、本次計 0 元；暫按每盞 NT$1,200
            估配線及安裝，屬原報價外追加。${entry.roomId === "balcony"
                ? "陽台有潮濕與室外暴露可能，須確認天花遮蔽、戶外防護等級與防水配線；原安裝單價是否適用待水電重報。"
                : "燈具固定方式、迴路與實際施工價待核。"}`,
        placement: { ...entry.placement },
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
        lightType: "ceiling",
        quotedUnitPrice: null,
        quotedQuantity: null,
    })));
    items.push({
        id: CORRIDOR_TRACK_ID,
        roomId: "corridor",
        name: "走廊軌道與軌道燈",
        quantity: 1,
        unit: "條",
        brandModel: TRACK_RAIL_OPTIONS["tr-plus-150"].model,
        unitPrice: CORRIDOR_TRACK_PRICE_TWD,
        trackSelection: "tr-plus-150",
        spotlightQuantity: 3,
        spotlightUnitPrice: CORRIDOR_SPOTLIGHT_PRICE_TWD,
        spotlightModel: TRACK_SPOTLIGHT_OPTIONS["tr-plus-12w"].model,
        spotlightSelection: "tr-plus-12w",
        lightWatts: TRACK_SPOTLIGHT_OPTIONS["tr-plus-12w"].wattageW,
        spotlightPriceSource: TRACK_SPOTLIGHT_OPTIONS["tr-plus-12w"].source,
        installationUnitPrice: CORRIDOR_TRACK_INSTALL_PRICE_TWD,
        trackLengthCm: CORRIDOR_TRACK_LENGTH_CM,
        priceCurrency: "TWD",
        priceSource: TRACK_RAIL_OPTIONS["tr-plus-150"].source,
        note: "走廊暫列 1.5 米軌道 1 條與軌道燈 3 盞。原選黑色軌道與 12W 黑色自然光圓盤燈的價格由屋主提供；替代選項是商品參考價，型號、色溫及軌道接頭相容性待核。原報價「軌道燈安裝」只有每條 1,200 元單價，數量未填、本次計 0 元；配線及安裝屬追加，不含於原工程款。圖示長度按 150cm 暫畫，天花固定、迴路、承重與施工方式待核。",
        placement: { ...CORRIDOR_TRACK_PLACEMENT },
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
        lightType: "track",
        quotedUnitPrice: null,
        quotedQuantity: null,
    });
    items.push({
        id: "bath-main-urinal-u0211-a624",
        roomId: "bath-main",
        name: "小便斗（感應壁掛）",
        quantity: 1,
        unit: "座",
        brandModel: "凱薩 U0211-A624",
        unitPrice: null,
        priceCurrency: "TWD",
        priceSource: "",
        note: "暫標在主浴馬桶左側，依最新圖面示意；尺寸、感應供電、給排水、固定方式與安裝費待確認。原報價未列此設備本體。",
        placement: { x: 0.081, y: 0.822 },
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
    });
    for (const room of rooms.slice(0, 2)) {
        items.push({
            id: `${room.id}-bidet-tcf8cm76`,
            roomId: room.id,
            name: "免治便座",
            quantity: 1,
            unit: "組",
            brandModel: "TOTO TCF8CM76",
            unitPrice: 79200,
            priceCurrency: "JPY",
            priceSource: "Bic Camera（日本參考價，庫存須核）：https://www.biccamera.com/bc/item/3808721/",
            note: "日本販售的TCF8CM76#NW1白色款參考價；Amazon售價未查證。日本TOTO官方組合TCF8CM76AK含TCA320，但與台灣CW288SGUR未有官方相容確認；日規100V與台灣110V不同，購買前請TOTO及合格電工確認。海外運費、稅費與安裝另計。",
            placement: null,
            orientation: null,
            kind: "equipment",
            furnitureType: null,
            widthCm: null,
            depthCm: null,
        });
        items.push({
            id: `${room.id}-flush-tca320`,
            roomId: room.id,
            name: "自動沖水裝置",
            quantity: 1,
            unit: "組",
            brandModel: "TOTO TCA320",
            unitPrice: 8600,
            priceCurrency: "JPY",
            priceSource: "Yodobashi（日本參考價，少量庫存須核）：https://www.yodobashi.com/product/100000001003686914/",
            note: "日本TOTO官方TCF8CM76AK組合含TCA320，但與台灣CW288SGUR未有官方相容確認；原型號已停售，庫存可能變動。海外運費、稅費與安裝另計。",
            placement: null,
            orientation: null,
            kind: "equipment",
            furnitureType: null,
            widthCm: null,
            depthCm: null,
        });
    }
    items.push({
        id: "bath-guest-tub",
        roomId: "bath-guest",
        name: "浴缸",
        quantity: 1,
        unit: "座",
        brandModel: "OVO BK106A",
        unitPrice: 30000,
        priceCurrency: "TWD",
        priceSource: "使用者預算暫估（非商家報價）",
        note: "W110×D70×H56±2cm，145L。原圖坐式浴缸標示80，改選110cm是否放得下、排水與安裝費均待確認。",
        placement: { x: 0.16, y: 0.23 },
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: 110,
        depthCm: 70,
    });
    items.push(...AC_ROOM_IDS.map((roomId) => ({
        id: `ac-${roomId}`,
        roomId,
        name: roomId === "bedroom-2" ? "冷氣（臥室2暫不裝分離式）" : "冷氣",
        quantity: 1,
        unit: "台",
        brandModel: roomId === "bedroom-2"
            ? "分離式暫不規劃（無現況對外窗）"
            : "GREE 格力（品牌暫填，型號待選）",
        unitPrice: null,
        priceCurrency: "TWD",
        priceSource: "",
        note: roomId === "bedroom-2"
            ? "臥室2無現況對外窗，鐵窗僅沿臥室3及陽台；室外機管線與合法固定路徑未確認，依屋主選擇暫不規劃分離式，保留舊標位供日後恢復。替代冷房方案待討論。"
            : `室內機位置及${OUTDOOR_AC_ZONES[roomId]?.label ??
                "室外機位置"}均為討論示意，兩者作同一套分離式冷氣計價，
                不另加一筆室外機價格。窗外固定與進出施工、冷媒管、
                排熱、排水、鐵窗承重與許可待勘。原報價不含冷氣本體，
                專屬迴路說明僅註冷氣3台，配電與安裝另議。`,
        placement: null,
        acPlanStatus: roomId === "bedroom-2" ? "excluded" : "active",
        outdoorPlacement: OUTDOOR_AC_ZONES[roomId]
            ? { ...OUTDOOR_AC_ZONES[roomId].placement } : null,
        outdoorZoneId: OUTDOOR_AC_ZONES[roomId]?.windowId ?? null,
        outdoorWidthCm: OUTDOOR_AC_ESTIMATED_SIZE_CM.width,
        outdoorDepthCm: OUTDOOR_AC_ESTIMATED_SIZE_CM.depth,
        outdoorOrientation: 0,
        orientation: null,
        kind: "equipment",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
    })));
    items.push(...QUOTED_DOORS.map(([doorId, roomId, name, doorMaterial]) => ({
        id: `door-${doorId}`,
        roomId,
        name,
        quantity: 1,
        unit: "組",
        brandModel: DOOR_OPTIONS[doorMaterial].label,
        unitPrice: DOOR_OPTIONS[doorMaterial].unitPrice,
        priceCurrency: "TWD",
        priceSource: "原報價｜門片工程",
        note: doorMaterial === "shower-glass"
            ? "乾濕分離22,000元及防爆膜3,000元已各列在本房設備（均含原報價）；此筆只記玻璃門位、門洞尺寸與開向，不再重複計價。變更門型的額外價差需另報。"
            : doorId === "main-bath-hall"
                ? "新配置確認通客餐廳為拉門；門片單價沿用原塑鋼廁所門報價基準。軌道另依原輕隔間報價暫分 0.8 米 × 1,800 元＝1,440 元，門型與施工價差仍須廠商核算。"
                : "已含在原報價；切換材質後的價差僅供規劃，實際價格須廠商確認。",
        placement: null,
        orientation: null,
        kind: "door",
        furnitureType: null,
        widthCm: null,
        depthCm: null,
        heightCm: null,
        doorId,
        doorMaterial,
        doorOpeningKind: doorId === "main-bath-hall" ? "slide" : DOOR_OPTIONS[doorMaterial].opening,
        trackLengthM: null,
        quotedUnitPrice: DOOR_OPTIONS[doorMaterial].unitPrice,
        quotedQuantity: 1,
    })));
    return {
        version: PLANNER_STATE_VERSION, revision: 0, updatedAt: new Date().toISOString(),
        rooms, items, products: [], undo: null,
    };
}

function requiredText(value, label, maximum) {
    if (typeof value !== "string" || !value.trim() || value.length > maximum) {
        throw new StoreError(400, `${label}必須是 1 至 ${maximum} 字元的文字。`);
    }
    return value.trim();
}

function optionalText(value, label, maximum) {
    if (typeof value !== "string" || value.length > maximum) {
        throw new StoreError(400, `${label}必須是最多 ${maximum} 字元的文字。`);
    }
    return value;
}

function optionalNumber(value, label) {
    if (value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1e9) {
        throw new StoreError(400, `${label}必須是非負數，或留白表示未報價。`);
    }
    return value;
}

function optionalDimension(value, label) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 3000) {
        throw new StoreError(400, `${label}須為大於 0、小於 3000 的公分數，或留白表示尺寸待確認。`);
    }
    return value;
}

function optionalTrackLength(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0 || value > 100) {
        throw new StoreError(400, "滑門軌道長度須大於 0、至多 100 米，或留白表示待量。");
    }
    return value;
}

function priceCurrency(value) {
    if (value === undefined || value === null) return "TWD";
    if (!["TWD", "JPY", "USD"].includes(value)) {
        throw new StoreError(400, "價格幣別必須是新台幣、日圓或美元。");
    }
    return value;
}

function optionalLightNumber(value, label, minimum, maximum) {
    if (value == null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) ||
        value < minimum || value > maximum) {
        throw new StoreError(400, `${label}須為 ${minimum} 至 ${maximum} 的數值，或留白待查。`);
    }
    return value;
}

function validateProducts(data, legacyLighting = false) {
    if (!Array.isArray(data) || data.length > 200) {
        throw new StoreError(400, "物件資料庫須為清單，且不可超過 200 款。");
    }
    const ids = new Set();
    return data.map((entry) => {
        const id = requiredText(entry?.id, "商品識別碼", 80);
        const type = requiredText(entry?.type, "商品類型", 32);
        const environment = requiredText(entry?.environment, "商品使用環境", 16);
        if (!ID.test(id) || ids.has(id) || !Object.hasOwn(PRODUCT_TYPES, type) ||
            !Object.hasOwn(PRODUCT_ENVIRONMENTS, environment) ||
            environment === "any" && type !== "equipment" ||
            environment === "balcony" && ["recessed", "track"].includes(type)) {
            throw new StoreError(400, "物件資料庫的商品識別碼、類型或使用環境無效。");
        }
        ids.add(id);
        const name = requiredText(entry.name, "商品名稱", 120);
        const brandModel = type === "equipment"
            ? optionalText(entry.brandModel ?? "", "品牌／型號／規格", 200)
            : requiredText(entry.brandModel, "品牌／型號／規格", 200);
        if (type.startsWith("switch-") && environment === "balcony" &&
            Object.values(SWITCH_TYPES).some((option) =>
                option.brandModel === brandModel)) {
            throw new StoreError(400, "陽台開關不可把室內 Risna 面板登記為戶外防潮款。");
        }
        const unit = requiredText(entry.unit, "商品單位", 16);
        if (type !== "equipment" && unit !== productUnit(type)) {
            throw new StoreError(400, "開關、插座及燈具的商品單位須符合其種類。");
        }
        const itemCurrency = priceCurrency(entry.priceCurrency);
        if (!["equipment", "ceiling"].includes(type) && itemCurrency !== "TWD") {
            throw new StoreError(400, "開關、插座、崁燈與軌道燈須先以新台幣列試算。");
        }
        const installation = ["ceiling", "recessed", "track"].includes(type);
        if (!installation && entry.installationUnitPrice != null) {
            throw new StoreError(400, "這種商品不能另列燈具安裝單價。");
        }
        if (type !== "equipment" && (entry.widthCm != null ||
            entry.depthCm != null)) {
            throw new StoreError(400, "開關、插座與燈具的位置圖示不可冒充機身寬深。");
        }
        if (type !== "track" && (entry.spotlightModel != null ||
            entry.spotlightQuantity != null || entry.spotlightUnitPrice != null)) {
            throw new StoreError(400, "只有軌道燈組可設定軌道燈具明細。");
        }
        const spotlightQuantity = type === "track" ? entry.spotlightQuantity : null;
        if (type === "track" && (!Number.isSafeInteger(spotlightQuantity) ||
            spotlightQuantity < 0 || spotlightQuantity > 12)) {
            throw new StoreError(400, "每條軌道的燈具數量須為 0 至 12 盞。");
        }
        const spotlightModel = type === "track"
            ? spotlightQuantity > 0
                ? requiredText(entry.spotlightModel, "軌道燈型號", 200)
                : optionalText(entry.spotlightModel ?? "", "軌道燈型號", 200)
            : null;
        if (!installation && (entry.lightWatts != null || entry.lightLumens != null ||
            entry.beamAngleDeg != null || entry.lightSpecSource)) {
            throw new StoreError(400, "只有燈具商品可填瓦數與光學規格。");
        }
        const lightWatts = installation ? optionalLightNumber(
            entry.lightWatts === undefined && legacyLighting
                ? legacyLightWatts(entry) : entry.lightWatts,
            "每盞燈具瓦數", .1, 1000) : null;
        const lightLumens = installation ? optionalLightNumber(
            entry.lightLumens, "每盞光通量（流明）", 1, 200000) : null;
        const beamAngleDeg = installation ? optionalLightNumber(
            entry.beamAngleDeg, "光束角度", 1, 180) : null;
        return {
            id, type, environment, name, brandModel, unit,
            unitPrice: optionalNumber(entry.unitPrice ?? null, "商品參考單價"),
            installationUnitPrice: installation
                ? optionalNumber(entry.installationUnitPrice ?? null, "安裝單價") : null,
            priceCurrency: itemCurrency,
            priceSource: optionalText(entry.priceSource ?? "", "商品價格來源", 450),
            note: optionalText(entry.note ?? "", "商品備註", 800),
            widthCm: type === "equipment"
                ? optionalDimension(entry.widthCm, "商品寬度") : null,
            depthCm: type === "equipment"
                ? optionalDimension(entry.depthCm, "商品深度") : null,
            spotlightModel,
            spotlightQuantity,
            spotlightUnitPrice: type === "track"
                ? optionalNumber(entry.spotlightUnitPrice ?? null, "軌道燈單價") : null,
            lightWatts, lightLumens, beamAngleDeg,
            lightSpecSource: installation
                ? optionalText(entry.lightSpecSource ?? "", "光學資料來源", 450) : "",
        };
    });
}

function optionalPlacement(value) {
    if (value === undefined || value === null) return null;
    if (typeof value !== "object" || Array.isArray(value) ||
        !Number.isFinite(value.x) || !Number.isFinite(value.y) ||
        value.x < 0 || value.x > 1 || value.y < 0 || value.y > 1) {
        throw new StoreError(400, "設備位置必須是房內 0 至 1 的橫向、縱向比例。");
    }
    return { x: value.x, y: value.y };
}

function optionalOrientation(value) {
    if (value === undefined || value === null) return null;
    if (![0, 90, 180, 270].includes(value)) {
        throw new StoreError(400, "冷氣方向僅可選向右、向下、向左或向上。");
    }
    return value;
}

export function validateState(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
        throw new StoreError(400, "設備資料版本無效，未寫入任何變更。");
    }
    if (data.version === 1) data = upgradeLegacySocketPlan(data);
    if (data.version === SOCKET_PLAN_VERSION) {
        if (data.undo != null) {
            throw new StoreError(400, "舊版設備資料不能攜帶新版復原紀錄。");
        }
        data = { ...data, version: 3, undo: null };
    }
    if (data.version === 3) data = { ...data, version: 4 };
    const legacyLighting = data.version === 4;
    if (legacyLighting) data = { ...data, version: PLANNER_STATE_VERSION };
    if (data.version !== PLANNER_STATE_VERSION) {
        throw new StoreError(400, "設備資料版本無效，未寫入任何變更。");
    }
    if (!Number.isSafeInteger(data.revision) || data.revision < 0) {
        throw new StoreError(400, "設備資料修訂版次無效。");
    }
    if (!Array.isArray(data.rooms) || !Array.isArray(data.items) ||
        data.rooms.length > 60 || data.items.length > 600) {
        throw new StoreError(400, "房間或設備清單格式無效，或超過項目上限。");
    }
    const products = validateProducts(data.products === undefined ? [] : data.products,
        legacyLighting);
    const productById = new Map(products.map((product) => [product.id, product]));
    const roomIds = new Set();
    const roomNames = new Set();
    const rooms = data.rooms.map((room) => {
        const id = requiredText(room?.id, "房間識別碼", 80);
        const name = requiredText(room?.name, "房間名稱", 60);
        if (!ID.test(id) || roomIds.has(id) || roomNames.has(name)) {
            throw new StoreError(400, "房間識別碼或名稱重複／格式不正確。");
        }
        roomIds.add(id);
        roomNames.add(name);
        const drawing = Object.hasOwn(ROOM_DRAWING_DIMENSIONS, id)
            ? ROOM_DRAWING_DIMENSIONS[id] : null;
        const widthCm = optionalDimension(
            room.widthCm === undefined ? drawing?.widthCm ?? null : room.widthCm, "房間內寬"
        );
        const depthCm = optionalDimension(
            room.depthCm === undefined ? drawing?.depthCm ?? null : room.depthCm, "房間內深"
        );
        const ceilingHeightCm = optionalLightNumber(room.ceilingHeightCm,
            "天花至地板高度（cm）", 180, 600);
        if (id === "ac-platform" && ceilingHeightCm !== null) {
            throw new StoreError(400, "外推鐵窗沒有可確認的室內天花高度。");
        }
        const dimensionStatus = room.dimensionStatus ??
            (drawing && widthCm !== null && depthCm !== null ? "estimated" : null);
        if (dimensionStatus !== null && !["estimated", "user", "measured"].includes(dimensionStatus)) {
            throw new StoreError(400, "房間尺寸狀態無效。");
        }
        return { id, name, widthCm, depthCm, dimensionStatus, ceilingHeightCm };
    });
    const itemIds = new Set();
    const diagramPointIds = new Set();
    const items = data.items.map((item) => {
        const id = requiredText(item?.id, "設備識別碼", 80);
        if (!ID.test(id) || itemIds.has(id)) {
            throw new StoreError(400, "設備識別碼重複／格式不正確。");
        }
        itemIds.add(id);
        const roomId = requiredText(item?.roomId, "設備所屬房間", 80);
        if (!roomIds.has(roomId)) {
            throw new StoreError(400, `設備「${item.name || id}」所屬房間不存在。`);
        }
        const kind = item.kind ?? "equipment";
        if (!["equipment", "furniture", "door"].includes(kind)) {
            throw new StoreError(400, "項目類型必須是設備、家具或門片。");
        }
        const furnitureType = item.furnitureType ?? null;
        if ((kind === "furniture" && !Object.hasOwn(FURNITURE_TEMPLATES, furnitureType)) ||
            (kind !== "furniture" && furnitureType !== null)) {
            throw new StoreError(400, "家具類型無效，未儲存變更。");
        }
        const itemCurrency = priceCurrency(item.priceCurrency);
        const splitAC = isSplitAirConditioner({ id, kind });
        const acPlanStatus = splitAC ? item.acPlanStatus ?? "active" : null;
        const outdoorZoneId = splitAC
            ? item.outdoorZoneId ?? OUTDOOR_AC_ZONES[roomId]?.windowId ?? null : null;
        if (splitAC && (outdoorZoneId !== null &&
            !outdoorACZoneChoices(roomId).some((zone) => zone.windowId === outdoorZoneId) ||
            item.outdoorPlacement != null && outdoorZoneId === null)) {
            throw new StoreError(400, "室外機所選窗位不屬於該房間，未儲存變更。");
        }
        const outdoorOrientation = splitAC ? optionalOrientation(
            item.outdoorOrientation === undefined ? 0 : item.outdoorOrientation
        ) : null;
        if (splitAC && outdoorOrientation === null) {
            throw new StoreError(400, "分離式冷氣的室外機必須有有效的轉向角度。");
        }
        const outdoorWidthCm = splitAC ? optionalDimension(
            item.outdoorWidthCm === undefined ? OUTDOOR_AC_ESTIMATED_SIZE_CM.width :
                item.outdoorWidthCm, "室外機沿牆長度"
        ) : null;
        const outdoorDepthCm = splitAC ? optionalDimension(
            item.outdoorDepthCm === undefined ? OUTDOOR_AC_ESTIMATED_SIZE_CM.depth :
                item.outdoorDepthCm, "室外機外推深度"
        ) : null;
        if (splitAC && (outdoorWidthCm === null || outdoorDepthCm === null ||
            outdoorWidthCm < OUTDOOR_AC_SIZE_BOUNDS_CM.minWidth ||
            outdoorWidthCm > OUTDOOR_AC_SIZE_BOUNDS_CM.maxWidth ||
            outdoorDepthCm < OUTDOOR_AC_SIZE_BOUNDS_CM.minDepth ||
            outdoorDepthCm > OUTDOOR_AC_SIZE_BOUNDS_CM.maxDepth)) {
            throw new StoreError(400, "室外機暫估長邊須為 30–250cm、外推深度須為 15–150cm。");
        }
        if (splitAC && (kind !== "equipment" || roomId !== id.slice(3) ||
            item.quantity !== 1 || item.unit !== "台" ||
            !["active", "excluded"].includes(acPlanStatus) ||
            acPlanStatus === "excluded" &&
                (id !== "ac-bedroom-2" || item.unitPrice != null ||
                    item.outdoorPlacement != null) ||
            item.outdoorPlacement != null && !OUTDOOR_AC_ZONES[roomId])) {
            throw new StoreError(400, "分離式冷氣的所屬房間、室外機暫位或停裝狀態無效。");
        }
        if (!splitAC && (item.acPlanStatus != null ||
            item.outdoorPlacement != null || item.outdoorWidthCm != null ||
            item.outdoorDepthCm != null || item.outdoorOrientation != null ||
            item.outdoorZoneId != null)) {
            throw new StoreError(400, "只有分離式冷氣可設定窗外室外機、占地與停裝狀態。");
        }
        if (kind === "door" && itemCurrency !== "TWD") {
            throw new StoreError(400, "原報價門片以新台幣計價，不可直接改用外幣。");
        }
        const doorId = kind === "door" ? requiredText(item.doorId, "門位識別碼", 80) : null;
        const doorMaterial = kind === "door" ? requiredText(item.doorMaterial, "門片材質", 40) : null;
        const doorOpeningKind = kind === "door"
            ? requiredText(item.doorOpeningKind, "開門方式", 10) : null;
        if (kind === "door" && (!QUOTED_DOORS.some(([id]) => id === doorId) ||
            !Object.hasOwn(DOOR_OPTIONS, doorMaterial) ||
            ((doorId === "main-shower" || doorId === "guest-shower")
                ? !["shower-glass", "custom"].includes(doorMaterial)
                : doorMaterial === "shower-glass") ||
            !["swing", "slide"].includes(doorOpeningKind) ||
            item.placement !== null && item.placement !== undefined ||
            item.orientation != null)) {
            throw new StoreError(400, "門片材質、門位或開門方式無效。");
        }
        const bathroomQuote = QUOTED_BATH_EQUIPMENT.get(id);
        const freshAirRoom = FRESH_AIR_ROOM_BY_ID.get(id);
        const rinseKitRoom = RINSE_KIT_ROOM_BY_ID.get(id);
        const towelRailRoom = TOWEL_RAIL_ROOM_BY_ID.get(id);
        const grabBar = id === GUEST_BATH_GRAB_BAR.id;
        const quotedCircuit = QUOTED_CIRCUIT_BY_ID.get(id);
        const circuit = Boolean(quotedCircuit) ||
            item.equipmentType === "dedicated-circuit";
        const weak = isWeakCurrent(item);
        const equipmentType = freshAirRoom || rinseKitRoom ||
            towelRailRoom || grabBar || circuit || weak ? item.equipmentType ?? null : null;
        const legacyFanInstall = id.endsWith("-heater-install") &&
            item.name === "暖風機安裝" &&
            item.brandModel === "暖風機安裝（機器自備）";
        const quotedTrack = QUOTED_TRACK_BY_ID.get(id);
        const quotedPartition = id === BEDROOM2_PARTITION_ID;
        const quotedSwitch = QUOTED_SWITCH_BY_ID.get(id);
        const quotedOutlet = QUOTED_OUTLET_BY_ID.get(id);
        const quotedDownlight = QUOTED_DOWNLIGHT_BY_ID.get(id);
        const ceilingLight = CEILING_LIGHT_BY_ID.get(id);
        const markerStyle = item.markerStyle ?? null;
        const equipmentCategory = item.equipmentCategory ?? null;
        const productId = item.productId == null
            ? null : requiredText(item.productId, "資料庫商品識別碼", 80);
        if (productId !== null && !ID.test(productId)) {
            throw new StoreError(400, "物件所選資料庫商品識別碼無效。");
        }
        if ((markerStyle !== null || equipmentCategory !== null) &&
            (kind !== "equipment" || markerStyle !== "square-label" ||
                !["furniture", "switches", "outlets", "lights"]
                    .includes(equipmentCategory) ||
                splitAC || bathroomQuote || quotedTrack || quotedPartition ||
                quotedSwitch || quotedOutlet || quotedCircuit ||
                quotedDownlight || ceilingLight ||
                id === CORRIDOR_TRACK_ID || freshAirRoom || rinseKitRoom ||
                towelRailRoom || grabBar)) {
            throw new StoreError(400, "自行新增商品的方形文字圖例不得套用原報價或固定設備識別碼。");
        }
        const additionalOutlet = !quotedOutlet &&
            item.outletCircuit === "additional-general";
        const outletPlanPointId = item.outletPlanPointId ?? null;
        if (outletPlanPointId !== null && (typeof outletPlanPointId !== "string" ||
            !/^(R(?:0[1-9]|[1-4][0-9]|5[01])|B0[1-9]|C0[1-7])$/.test(outletPlanPointId) ||
            diagramPointIds.has(outletPlanPointId) ||
            (weak ? outletPlanPointId !== id.replace("weak-outlet-", "") :
                !isSocket(item) || outletPlanPointId.startsWith("C")))) {
            throw new StoreError(400, "來源標位識別碼須唯一且與電源／弱電類型相符。");
        }
        if (outletPlanPointId !== null) diagramPointIds.add(outletPlanPointId);
        if (weak && (!QUOTED_WEAK_CURRENT_IDS.includes(id) || outletPlanPointId === null ||
            item.quantity !== 1 || item.unit !== "個" || itemCurrency !== "TWD" ||
            item.outletCircuit != null || item.circuitOutletId != null ||
            item.productId != null || item.lightType != null || item.switchType != null ||
            item.widthCm != null || item.depthCm != null || item.heightCm != null ||
            equipmentCategory !== "outlets" || markerStyle !== "square-label" ||
            item.quotedUnitPrice !== WEAK_CURRENT_UNIT_PRICE_TWD || item.quotedQuantity !== 1)) {
            throw new StoreError(400, "弱電 C 埠不是電源插座；須保留原報 7 條每條 NT$3,000 基準。");
        }
        const outletCircuit = quotedOutlet || additionalOutlet
            ? item.outletCircuit ?? null : null;
        if (quotedOutlet && (kind !== "equipment" || itemCurrency !== "TWD" ||
            roomId === "ac-platform" || outletCircuit !== quotedOutlet.outletCircuit ||
            item.quantity !== 1 || item.unit !== "個" || item.placement == null ||
            item.widthCm != null || item.depthCm != null || item.heightCm != null ||
            item.switchType != null || item.lightType != null || item.equipmentType != null)) {
            throw new StoreError(400, "原報插座須各有房間與點位、不可放在外推鐵窗；每個基準為 NT$1,800，專用迴路另列。");
        }
        if (!quotedOutlet && item.outletCircuit != null && !additionalOutlet) {
            throw new StoreError(400, "插座只能是一般插座；專用迴路須獨立列項並對應一個插座。");
        }
        if (additionalOutlet && (markerStyle !== "square-label" ||
            equipmentCategory !== "outlets" || kind !== "equipment" ||
            itemCurrency !== "TWD" || roomId === "ac-platform" ||
            item.quantity !== 1 || item.unit !== "個" ||
            item.widthCm != null || item.depthCm != null || item.heightCm != null ||
            item.switchType != null || item.lightType != null ||
            item.equipmentType != null || item.quotedUnitPrice != null ||
            item.quotedQuantity != null)) {
            throw new StoreError(400, "新增插座須獨立計價，不可占用原報 50 個插座額度。");
        }
        const circuitOutletId = circuit
            ? requiredText(item.circuitOutletId, "專用迴路對應插座", 80) : null;
        if (!circuit && item.circuitOutletId != null ||
            circuit && (equipmentType !== "dedicated-circuit" ||
                kind !== "equipment" || itemCurrency !== "TWD" ||
                roomId === "ac-platform" ||
                item.quantity !== 1 || item.unit !== "條" ||
                item.outletCircuit != null || item.switchType != null ||
                item.lightType != null || item.widthCm != null ||
                item.depthCm != null || item.heightCm != null ||
                quotedCircuit && productId != null)) {
            throw new StoreError(400, "專用迴路須獨立成筆、以新台幣計價並對應房間內一個已標位插座。");
        }
        if (bathroomQuote && (kind !== "equipment" || roomId !== bathroomQuote.roomId ||
            itemCurrency !== "TWD" || item.placement != null || item.orientation != null ||
            item.widthCm != null || item.depthCm != null || item.heightCm != null ||
            !legacyFanInstall &&
                (item.name !== bathroomQuote.name ||
                    item.brandModel !== bathroomQuote.brandModel) ||
            item.unit !== bathroomQuote.unit)) {
            throw new StoreError(400, "衛浴已報價施工項目須列於各自衛浴，不可作一般可放置設備。");
        }
        if (freshAirRoom && equipmentType !== null &&
            (equipmentType !== "fresh-air" || roomId !== freshAirRoom ||
                kind !== "equipment" || item.quantity !== 1 || item.unit !== "台" ||
                item.widthCm != null || item.depthCm != null || item.heightCm != null)) {
            throw new StoreError(400, "新風機必須在所屬衛浴各列一台，位置可調整。");
        }
        if (rinseKitRoom && (equipmentType !== "rinse-kit" ||
            roomId !== rinseKitRoom || kind !== "equipment" ||
            item.quantity !== 1 || item.unit !== "組" ||
            item.widthCm != null || item.depthCm != null || item.heightCm != null)) {
            throw new StoreError(400, "三叉管與沖洗器須在兩間衛浴馬桶旁各列一組。");
        }
        if (towelRailRoom && (equipmentType !== "heated-towel-rail" ||
            roomId !== towelRailRoom || kind !== "equipment" ||
            item.quantity !== 1 || item.unit !== "支" ||
            item.widthCm != null || item.depthCm != null || item.heightCm != null)) {
            throw new StoreError(400, "電熱毛巾架須在兩間衛浴各列一支，牆面方向可旋轉。");
        }
        if (grabBar && (equipmentType !== "bath-grab-bar" ||
            roomId !== "bath-guest" || kind !== "equipment" ||
            item.quantity !== 1 || item.unit !== "支" ||
            item.widthCm != null || item.depthCm != null || item.heightCm != null)) {
            throw new StoreError(400, "浴缸防滑扶手須列在客浴牆面，位置與方向可調整。");
        }
        if (!freshAirRoom && !rinseKitRoom && !towelRailRoom &&
            !grabBar && !circuit && !weak && item.equipmentType != null) {
            throw new StoreError(400, "此設備不能使用固定衛浴設備的圖示類型。");
        }
        if (quotedTrack && (kind !== "equipment" || roomId !== quotedTrack.roomId ||
            itemCurrency !== "TWD" || item.trackDoorId !== quotedTrack.doorId ||
            item.placement != null || item.orientation != null || item.widthCm != null ||
            item.depthCm != null || item.heightCm != null || item.name !== quotedTrack.name ||
            item.unit !== "米" || item.brandModel !== "滑門軌道（型式待確認）")) {
            throw new StoreError(400, "原報價滑門軌道須對應主浴或臥室3－工作室拉門，不可作一般設備。");
        }
        if (!quotedTrack && item.trackDoorId != null) {
            throw new StoreError(400, "未列原報價的物件不可指定已報價軌道門位。");
        }
        const partitionMaterial = quotedPartition
            ? requiredText(item.partitionMaterial, "輕隔間做法", 40) : null;
        if (quotedPartition && (kind !== "equipment" || roomId !== "bedroom-2" ||
            itemCurrency !== "TWD" ||
            !Object.hasOwn(BEDROOM2_PARTITION_OPTIONS, partitionMaterial) ||
            item.name !== "臥室2輕隔間（對客廳／走廊）" || item.unit !== "坪" ||
            item.brandModel !== BEDROOM2_PARTITION_OPTIONS[partitionMaterial]?.specification ||
            item.placement != null || item.orientation != null || item.widthCm != null ||
            item.depthCm != null || item.heightCm != null)) {
            throw new StoreError(400, "臥室2兩面輕隔間須共用一筆坪數與材質，不可作一般可放置設備。");
        }
        if (!quotedPartition && item.partitionMaterial != null) {
            throw new StoreError(400, "只有臥室2輕隔間可切換隔間做法。");
        }
        const switchType = item.switchType == null
            ? null : requiredText(item.switchType, "開關型式", 10);
        const switchEnvironment = switchType === null ? null :
            item.switchEnvironment ?? "indoor";
        const switchPlanStatus = switchType === null ? null :
            item.switchPlanStatus ?? "active";
        const trackLighting = id === CORRIDOR_TRACK_ID;
        const genericLight = markerStyle === "square-label" &&
            equipmentCategory === "lights" &&
            ["recessed", "ceiling", "track"].includes(item.lightType);
        const recessedAssembly = Boolean(quotedDownlight) ||
            genericLight && item.lightType === "recessed";
        const ceilingAssembly = Boolean(ceilingLight) ||
            genericLight && item.lightType === "ceiling";
        const trackAssembly = trackLighting ||
            genericLight && item.lightType === "track";
        const switchOption = switchType === null ? null :
            switchOptionFor({ switchType, switchEnvironment });
        const outdoorSwitch = switchEnvironment === "outdoor";
        const invalidSwitchModel = !switchOption ||
            (outdoorSwitch
                ? typeof item.brandModel !== "string" ||
                    !item.brandModel.trim() ||
                    Object.values(SWITCH_TYPES).some((option) =>
                        option.brandModel === item.brandModel)
                : markerStyle === "square-label" && !quotedSwitch
                    ? typeof item.brandModel !== "string" ||
                        !item.brandModel.trim()
                    : item.brandModel !== switchOption.brandModel);
        const incompatibleSwitch = switchType !== null &&
            (kind !== "equipment" || itemCurrency !== "TWD" ||
            !["indoor", "outdoor"].includes(switchEnvironment) ||
            invalidSwitchModel || item.unit !== "個" ||
            (outdoorSwitch ? roomId !== "balcony" || Boolean(quotedSwitch) :
                roomId === "balcony" || roomId === "ac-platform") ||
            item.widthCm != null || item.depthCm != null || item.heightCm != null ||
            item.lightType != null || item.outletCircuit != null ||
            quotedDownlight || ceilingLight || trackLighting ||
            quotedPartition || bathroomQuote || quotedTrack);
        const invalidSwitchStatus = switchType !== null && (quotedSwitch
            ? !["active", "removed"].includes(switchPlanStatus) ||
                item.quantity !== (switchPlanStatus === "removed" ? 0 : 1)
            : switchPlanStatus !== "active" || item.quantity !== 1);
        if (quotedSwitch && switchType === null ||
            incompatibleSwitch || invalidSwitchStatus) {
            throw new StoreError(400, "室內開關不可設於陽台；陽台只能新增待核的戶外防潮款，原報價配置可移除或恢復。");
        }
        if (switchType === null && (item.switchPlanStatus != null ||
            item.switchEnvironment != null)) {
            throw new StoreError(400, "只有開關項目能設定配置與環境型式。");
        }
        const lightOptions = recessedAssembly ? DOWNLIGHT_OPTIONS :
            ceilingAssembly ? CEILING_LIGHT_OPTIONS : null;
        const lightSelection = lightOptions && item.lightSelection != null
            ? requiredText(item.lightSelection, "燈具選項", 40) : null;
        if (lightSelection !== null && !Object.hasOwn(lightOptions, lightSelection)) {
            throw new StoreError(400, "崁燈或吸頂燈選項無效。");
        }
        if (!lightOptions && item.lightSelection != null) {
            throw new StoreError(400, "只有崁燈與吸頂燈可切換燈具選項。");
        }
        const trackSelection = trackAssembly && item.trackSelection != null
            ? requiredText(item.trackSelection, "軌道選項", 40) : null;
        const spotlightSelection = trackAssembly && item.spotlightSelection != null
            ? requiredText(item.spotlightSelection, "軌道燈選項", 40) : null;
        if (trackSelection !== null && !Object.hasOwn(TRACK_RAIL_OPTIONS, trackSelection) ||
            spotlightSelection !== null &&
                !Object.hasOwn(TRACK_SPOTLIGHT_OPTIONS, spotlightSelection)) {
            throw new StoreError(400, "走廊軌道或軌道燈的選項無效。");
        }
        if (!trackAssembly && (item.trackSelection != null ||
            item.spotlightSelection != null || item.spotlightPriceSource != null)) {
            throw new StoreError(400, "只有軌道燈組可設定軌道及燈具選項。");
        }
        const lightType = recessedAssembly || ceilingAssembly || trackAssembly
            ? requiredText(item.lightType, "燈具類型", 20) : null;
        if (lightType === null && (item.lightWatts != null || item.lightLumens != null ||
            item.beamAngleDeg != null || item.lightSpecSource)) {
            throw new StoreError(400, "只有燈具物件可以設定瓦數與光學資料。");
        }
        const lightWatts = lightType ? optionalLightNumber(
            item.lightWatts === undefined && legacyLighting
                ? legacyLightWatts(item) : item.lightWatts,
            "每盞燈具瓦數", .1, 1000) : null;
        const lightLumens = lightType ? optionalLightNumber(
            item.lightLumens, "每盞光通量（流明）", 1, 200000) : null;
        const beamAngleDeg = lightType ? optionalLightNumber(
            item.beamAngleDeg, "光束角度", 1, 180) : null;
        const lightSpecSource = lightType
            ? optionalText(item.lightSpecSource ?? "", "光學資料來源", 500) : "";
        if (equipmentCategory !== null &&
            (equipmentCategory === "lights" ? !genericLight :
                equipmentCategory === "switches" ? switchType === null :
                    equipmentCategory === "outlets" ? !additionalOutlet && !weak :
                        item.lightType != null || switchType !== null ||
                            item.outletCircuit != null)) {
            throw new StoreError(400, "自行新增商品的類別與開關、插座或燈具規格不一致。");
        }
        if (genericLight && (kind !== "equipment" || item.quantity !== 1 ||
            roomId === "ac-platform" ||
            roomId === "balcony" && lightType !== "ceiling" ||
            item.widthCm != null || item.depthCm != null || item.heightCm != null ||
            item.switchType != null || item.outletCircuit != null ||
            item.equipmentType != null ||
            (lightType === "recessed" && (item.unit !== "個" ||
                itemCurrency !== "TWD") ||
                lightType === "ceiling" && item.unit !== "盞" ||
                lightType === "track" && (item.unit !== "條" ||
                    itemCurrency !== "TWD")))) {
            throw new StoreError(400, "新增燈具須分別列材料與安裝費，且不得占用原報價燈具額度。");
        }
        if (quotedDownlight && (kind !== "equipment" || itemCurrency !== "TWD" ||
            roomId !== quotedDownlight.roomId ||
            lightType !== "recessed" || item.unit !== "個" || item.quantity !== 1 ||
            item.widthCm != null || item.depthCm != null || item.heightCm != null)) {
            throw new StoreError(400, "原報價崁燈僅可列在廚房與兩間衛浴，每筆各一個。");
        }
        if (ceilingLight && (kind !== "equipment" || roomId !== ceilingLight.roomId ||
            lightType !== "ceiling" || item.quantity !== 1 || item.unit !== "盞" ||
            item.widthCm != null || item.depthCm != null || item.heightCm != null)) {
            throw new StoreError(400, "各房吸頂燈須在所屬空間各列一盞，天花示意位置可調整。");
        }
        if (ceilingAssembly && lightSelection !== null &&
            (roomId === "balcony" ? !["outdoor-pending", "outdoor-custom"]
                .includes(lightSelection) : ["outdoor-pending", "outdoor-custom"]
                .includes(lightSelection))) {
            throw new StoreError(400, "陽台只能選防潮戶外款；室內房間不能誤選陽台燈具。");
        }
        if (trackAssembly && (kind !== "equipment" ||
            trackLighting && roomId !== "corridor" ||
            !trackLighting && (roomId === "balcony" || roomId === "ac-platform") ||
            lightType !== "track" || itemCurrency !== "TWD" ||
            item.quantity !== 1 || item.unit !== "條" ||
            item.trackLengthCm !== CORRIDOR_TRACK_LENGTH_CM ||
            !Number.isSafeInteger(item.spotlightQuantity) ||
            item.spotlightQuantity < 0 || item.spotlightQuantity > 12 ||
            item.widthCm != null || item.depthCm != null || item.heightCm != null)) {
            throw new StoreError(400, "走廊軌道燈組須為 1 條 150cm 軌道，軌道燈數量須為 0 至 12 盞。");
        }
        if (!quotedDownlight && !ceilingLight && !trackLighting && !genericLight &&
            item.lightType != null) {
            throw new StoreError(400, "此項目不可指定廚衛崁燈、客廳吸頂燈或走廊軌道燈類型。");
        }
        if (!trackAssembly && (item.spotlightQuantity != null ||
            item.spotlightUnitPrice != null || item.spotlightModel != null ||
            item.trackLengthCm != null)) {
            throw new StoreError(400, "只有軌道燈組可設定軌道長度與燈具明細。");
        }
        if (!recessedAssembly && item.fixtureUnitPrice != null) {
            throw new StoreError(400, "只有崁燈可設定燈具拆估單價。");
        }
        if (!recessedAssembly && !ceilingAssembly && !trackAssembly &&
            item.installationUnitPrice != null) {
            throw new StoreError(400, "只有崁燈、吸頂燈與軌道燈可設定安裝單價。");
        }
        if (kind !== "door" && item.trackLengthM != null) {
            throw new StoreError(400, "只有門位可以設定額外滑門軌道長度。");
        }
        const quoted = kind === "door" ||
            Boolean(weak || bathroomQuote || quotedTrack || quotedPartition || quotedSwitch ||
                quotedOutlet || quotedCircuit || quotedDownlight);
        if (!quoted && (item.quotedUnitPrice != null || item.quotedQuantity != null)) {
            throw new StoreError(400, "未列原報價的物件不可設定報價基準。");
        }
        const quotedUnitPrice = quoted
            ? optionalNumber(item.quotedUnitPrice, "原報價單價") : null;
        const quotedQuantity = quoted ? item.quotedQuantity : null;
        if (quoted && (quotedUnitPrice === null ||
            !(quotedTrack ? typeof quotedQuantity === "number" && Number.isFinite(quotedQuantity) :
                Number.isSafeInteger(quotedQuantity)) ||
            quotedQuantity < (quotedTrack ? 0.01 : 1) || quotedQuantity > 100)) {
            throw new StoreError(400, "原報價基準數量或單價無效。");
        }
        if (bathroomQuote && (quotedUnitPrice !== bathroomQuote.unitPrice || quotedQuantity !== 1)) {
            throw new StoreError(400, "衛浴已報價項目的原報價基準不得改寫；請修改規劃單價或數量。");
        }
        if (quotedTrack && (quotedUnitPrice !== SLIDE_TRACK_RATE_TWD ||
            quotedQuantity !== quotedTrack.quotedLengthM ||
            item.quantity !== null && item.quantity !== undefined &&
                (item.quantity <= 0 || item.quantity > 100))) {
            throw new StoreError(400, "原報價軌道基準為各 0.8 米 × 1,800 元；規劃長度須大於 0 米。");
        }
        if (quotedPartition && (quotedUnitPrice !==
            BEDROOM2_PARTITION_OPTIONS["double-double"].unitPrice ||
            quotedQuantity !== BEDROOM2_PARTITION_QUOTED_AREA)) {
            throw new StoreError(400, "臥室2輕隔間原報價基準須保留 5 坪 × 7,000 元；請修改規劃坪數或單價。");
        }
        if (quotedSwitch && (quotedUnitPrice !== SWITCH_QUOTED_UNIT_PRICE_TWD ||
            quotedQuantity !== 1)) {
            throw new StoreError(400, "單／雙開關原報價基準必須保留每個 NT$2,250。");
        }
        if (quotedOutlet && (quotedUnitPrice !== SOCKET_UNIT_PRICE_TWD ||
            quotedQuantity !== 1)) {
            throw new StoreError(400, "插座原報價基準每個 NT$1,800；專用迴路須另列，不可重複更改。");
        }
        if (quotedCircuit && (quotedUnitPrice !== DEDICATED_CIRCUIT_UNIT_PRICE_TWD ||
            quotedQuantity !== 1)) {
            throw new StoreError(400, "原報 7 條專用迴路各 NT$4,500 的基準不可改寫。");
        }
        if (quotedDownlight && (quotedUnitPrice !== DOWNLIGHT_QUOTED_UNIT_PRICE_TWD ||
            quotedQuantity !== 1)) {
            throw new StoreError(400, "廚衛崁燈原報價基準必須保留每個 NT$950，已含燈具與安裝。");
        }
        const selectedUnitPrice = optionalNumber(item.unitPrice, "單價");
        const fixtureUnitPrice = recessedAssembly
            ? optionalNumber(item.fixtureUnitPrice ?? null, "崁燈燈具拆估單價") : null;
        const installationUnitPrice = recessedAssembly || ceilingAssembly || trackAssembly
            ? optionalNumber(item.installationUnitPrice ?? null, "燈具安裝單價") : null;
        const spotlightUnitPrice = trackAssembly
            ? optionalNumber(item.spotlightUnitPrice ?? null, "軌道燈單價") : null;
        if (recessedAssembly && lightSelection !== null) {
            const combined = installedDownlightUnitPrice(
                fixtureUnitPrice, installationUnitPrice
            );
            if (selectedUnitPrice !== combined) {
                throw new StoreError(400, "崁燈目前總單價必須等於燈具拆估價加配線安裝拆估價。");
            }
        }
        if (lightSelection !== null &&
            !["custom", "outdoor-custom"].includes(lightSelection)) {
            const option = lightOptions[lightSelection];
            if (item.brandModel !== option.model ||
                (recessedAssembly ? fixtureUnitPrice : selectedUnitPrice) !== option.unitPrice ||
                ceilingAssembly && itemCurrency !== "TWD" && option.unitPrice !== null) {
                throw new StoreError(400, "所選燈具的型號或商品單價與選項不符；請改選自訂款。");
            }
            if (option.wattageW != null && lightWatts !== option.wattageW) {
                throw new StoreError(400, "預設燈具瓦數須與所選型號一致；請另選自訂款。");
            }
        }
        if (trackSelection !== null && trackSelection !== "custom" &&
            (item.brandModel !== TRACK_RAIL_OPTIONS[trackSelection].model ||
                selectedUnitPrice !== TRACK_RAIL_OPTIONS[trackSelection].unitPrice)) {
            throw new StoreError(400, "所選走廊軌道型號與單價不符；請改選自訂款。");
        }
        if (spotlightSelection !== null && spotlightSelection !== "custom" &&
            (item.spotlightModel !== TRACK_SPOTLIGHT_OPTIONS[spotlightSelection].model ||
                spotlightUnitPrice !== TRACK_SPOTLIGHT_OPTIONS[spotlightSelection].unitPrice)) {
            throw new StoreError(400, "所選軌道燈型號與單價不符；請改選自訂款。");
        }
        if (spotlightSelection !== null && spotlightSelection !== "custom" &&
            lightWatts !== TRACK_SPOTLIGHT_OPTIONS[spotlightSelection].wattageW) {
            throw new StoreError(400, "預設軌道燈瓦數須與所選型號一致；請改選自訂款。");
        }
        const template = kind === "furniture" ? FURNITURE_TEMPLATES[furnitureType] : null;
        const productWidth = item.id.endsWith("-toilet") && item.brandModel === "TOTO CW288SGUR"
            ? 45.2 : item.id === "bath-guest-tub" && item.brandModel === "OVO BK106A" ? 110 : null;
        const productDepth = item.id.endsWith("-toilet") && item.brandModel === "TOTO CW288SGUR"
            ? 72.2 : item.id === "bath-guest-tub" && item.brandModel === "OVO BK106A" ? 70 : null;
        return {
            id,
            roomId,
            name: requiredText(item.name, "設備名稱", 120),
            quantity: optionalNumber(item.quantity, "數量"),
            unit: requiredText(item.unit, "單位", 16),
            brandModel: optionalText(item.brandModel, "品牌／型號", 200),
            unitPrice: selectedUnitPrice,
            priceCurrency: itemCurrency,
            priceSource: optionalText(item.priceSource ?? "", "價格來源", 500),
            note: optionalText(item.note, "備註", 1000),
            placement: optionalPlacement(item.placement),
            acPlanStatus,
            outdoorPlacement: splitAC ? optionalPlacement(item.outdoorPlacement) : null,
            outdoorZoneId,
            outdoorWidthCm,
            outdoorDepthCm,
            outdoorOrientation,
            orientation: optionalOrientation(item.orientation),
            kind,
            furnitureType,
            equipmentType,
            widthCm: optionalDimension(
                item.widthCm === undefined ? template?.widthCm ?? productWidth : item.widthCm, "設備寬度"
            ),
            depthCm: optionalDimension(
                item.depthCm === undefined ? template?.depthCm ?? productDepth : item.depthCm, "設備深度"
            ),
            heightCm: optionalDimension(item.heightCm, "門洞淨高"),
            doorId,
            doorMaterial,
            doorOpeningKind,
            trackDoorId: quotedTrack?.doorId ?? null,
            trackLengthM: kind === "door" ? optionalTrackLength(item.trackLengthM) : null,
            partitionMaterial,
            switchType,
            switchEnvironment,
            switchPlanStatus,
            outletCircuit,
            ...(outletPlanPointId === null ? {} : { outletPlanPointId }),
            circuitOutletId,
            productId,
            equipmentCategory,
            markerStyle,
            lightType,
            lightSelection,
            lightWatts,
            lightLumens,
            beamAngleDeg,
            lightSpecSource,
            fixtureUnitPrice,
            installationUnitPrice,
            trackLengthCm: trackAssembly ? item.trackLengthCm : null,
            trackSelection,
            spotlightQuantity: trackAssembly ? item.spotlightQuantity : null,
            spotlightUnitPrice,
            spotlightModel: trackAssembly
                ? optionalText(item.spotlightModel, "軌道燈型號", 200) : null,
            spotlightSelection,
            spotlightPriceSource: trackAssembly
                ? optionalText(item.spotlightPriceSource ?? "", "軌道燈價格來源", 500) : null,
            quotedUnitPrice,
            quotedQuantity,
        };
    });
    const quotedBathroomIds = [...QUOTED_BATH_EQUIPMENT.keys()]
        .filter((id) => !id.endsWith("-heater-install"));
    if (quotedBathroomIds.some((id) => itemIds.has(id))) {
        const showerDoors = items.filter((item) => item.kind === "door" &&
            (item.doorId === "main-shower" || item.doorId === "guest-shower"));
        if (!quotedBathroomIds.every((id) => itemIds.has(id)) ||
            showerDoors.length !== 2 ||
            showerDoors.some((item) => item.quotedUnitPrice !== 0 ||
                item.quotedQuantity !== 1)) {
            throw new StoreError(400, "乾濕分離與防爆膜須兩間各列一筆，且玻璃門位不可重複計入報價。");
        }
    }
    const heaterInstallIds = ["bath-main-heater-install", "bath-guest-heater-install"];
    if (heaterInstallIds.some((id) => itemIds.has(id)) &&
        !heaterInstallIds.every((id) => itemIds.has(id))) {
        throw new StoreError(400, "原報價暖風機安裝必須在兩間衛浴各列一組。");
    }
    const quotedTrackIds = QUOTED_SLIDE_TRACKS.map((track) => track.id);
    if (quotedTrackIds.some((id) => itemIds.has(id)) &&
        (!quotedTrackIds.every((id) => itemIds.has(id)) ||
            !items.some((item) => item.kind === "door" && item.doorId === "main-bath-hall"))) {
        throw new StoreError(400, "原報價 1.6 米滑門軌道須由主浴與臥室3－工作室兩道拉門各列 0.8 米。");
    }
    const switchIds = QUOTED_SWITCHES.map((item) => item.id);
    if (switchIds.some((id) => itemIds.has(id)) && !switchIds.every((id) => itemIds.has(id))) {
        throw new StoreError(400, "原報價單／雙開關須完整列出 15 個，不可遺漏或重複。");
    }
    const socketById = new Map(items.filter(isSocket).map((item) => [item.id, item]));
    const assignedSockets = new Set();
    for (const circuitItem of items.filter(isDedicatedCircuit)) {
        const socket = socketById.get(circuitItem.circuitOutletId);
        if (!socket || socket.roomId !== circuitItem.roomId ||
            circuitItem.placement && !socket.placement ||
            assignedSockets.has(socket.id)) {
            throw new StoreError(400, "每條專用迴路須獨占同一房間的一個一般插座；標位後才可標迴路，刪除插座前請先改綁或刪除迴路。");
        }
        assignedSockets.add(socket.id);
    }
    const downlightIds = QUOTED_DOWNLIGHTS.map((item) => item.id);
    if (downlightIds.some((id) => itemIds.has(id)) &&
        !downlightIds.every((id) => itemIds.has(id))) {
        throw new StoreError(400, "原報價崁燈須在廚房及兩間衛浴各列兩個，共六個。");
    }
    for (const item of items) {
        if (item.productId === null) continue;
        const product = productById.get(item.productId);
        if (!product) {
            throw new StoreError(400, `「${item.name}」引用的資料庫商品不存在；請換款或解除連動。`);
        }
        const mismatch = linkedProductMismatch(product, item);
        if (mismatch) {
            throw new StoreError(400, `「${item.name}」的${mismatch}與資料庫商品不同；請同步更新已連動物件。`);
        }
    }
    let undo = null;
    if (data.undo != null) {
        if (typeof data.undo !== "object" || Array.isArray(data.undo) ||
            Object.keys(data.undo).some((key) =>
                !["rooms", "items", "products"].includes(key)) ||
            !Array.isArray(data.undo.rooms) || !Array.isArray(data.undo.items) ||
            !Array.isArray(data.undo.products)) {
            throw new StoreError(400, "上一筆復原紀錄不完整，未寫入變更。");
        }
        const previous = validateState({
            version: legacyLighting ? 4 : PLANNER_STATE_VERSION,
            revision: data.revision,
            updatedAt: data.updatedAt, rooms: data.undo.rooms,
            items: data.undo.items, products: data.undo.products, undo: null,
        });
        undo = { rooms: previous.rooms, items: previous.items, products: previous.products };
    }
    return {
        version: PLANNER_STATE_VERSION,
        revision: data.revision,
        updatedAt: requiredText(data.updatedAt, "更新時間", 64),
        rooms,
        items,
        products,
        undo,
    };
}

export function summarize(state) {
    const budget = calculateBudget(state.items, { wholePlan: true });
    return {
        itemCount: state.items.length, productCount: state.products.length, ...budget,
        originalQuoteTWD: ORIGINAL_QUOTE_TWD,
        overallTotals: calculatePlanTotal(budget),
    };
}

export function createStore(filePath) {
    let tail = Promise.resolve();

    async function read() {
        let contents;
        try {
            contents = await readFile(filePath, "utf8");
        } catch (error) {
            if (error.code !== "ENOENT") throw error;
            await mkdir(dirname(filePath), { recursive: true });
            try {
                await writeFile(filePath, `${JSON.stringify(initialState(), null, 2)}\n`, {
                    encoding: "utf8",
                    flag: "wx",
                });
            } catch (creationError) {
                if (creationError.code !== "EEXIST") throw creationError;
            }
            contents = await readFile(filePath, "utf8");
        }
        try {
            return validateState(JSON.parse(contents));
        } catch (error) {
            if (error instanceof SyntaxError) {
                throw new StoreError(500, "設備資料檔案格式錯誤；原檔已保留，請檢查 JSON。");
            }
            throw error;
        }
    }

    async function update(expectedRevision, candidate) {
        const pending = tail.then(async () => {
            const current = await read();
            if (expectedRevision !== current.revision) {
                throw new StoreError(409, "設備已在另一個視圖更新；請重新載入後再編輯。", current);
            }
            if (candidate?.version !== PLANNER_STATE_VERSION) {
                throw new StoreError(400, "畫布資料結構已更新，請重新載入新版畫布後再編輯。");
            }
            if (candidate?.products === undefined && current.products.length > 0) {
                throw new StoreError(400, "修改設備前請重新載入含物件資料庫的最新版畫布。");
            }
            const next = validateState({
                version: PLANNER_STATE_VERSION,
                revision: current.revision + 1,
                updatedAt: new Date().toISOString(),
                rooms: candidate?.rooms,
                items: candidate?.items,
                products: candidate?.products,
                undo: candidate?.undo ?? null,
            });
            for (const product of current.products) {
                const replacement = next.products.find((entry) => entry.id === product.id);
                if (replacement && (replacement.type !== product.type ||
                    replacement.environment !== product.environment)) {
                    throw new StoreError(400, "既有資料庫商品不可改種類或使用環境；請另建商品款式。");
                }
            }
            for (const item of current.items) {
                if ((QUOTED_BATH_EQUIPMENT.has(item.id) || QUOTED_TRACK_BY_ID.has(item.id) ||
                    item.id === BEDROOM2_PARTITION_ID || QUOTED_SWITCH_BY_ID.has(item.id) ||
                    QUOTED_DOWNLIGHT_BY_ID.has(item.id)) &&
                    !next.items.some((entry) => entry.id === item.id)) {
                    throw new StoreError(400, "原報價的衛浴施工、軌道、隔間、開關或崁燈明細不可直接刪除。");
                }
            }
            const temporary = `${filePath}.${randomUUID()}.tmp`;
            try {
                await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
                    encoding: "utf8",
                    flag: "wx",
                });
                await rename(temporary, filePath);
            } finally {
                await rm(temporary, { force: true });
            }
            return next;
        });
        tail = pending.then(
            () => undefined,
            () => undefined,
        );
        return pending;
    }

    return { read, update };
}
