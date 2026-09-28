import { isQuotedEquipment } from "./budget.js";
import { DOOR_OPTIONS } from "./door-options.js";
import {
    DOOR_TRACK_CAUTION, isAllocatedDoorItem, isUnquotedBalconyDoor,
} from "./door-allocation.js";
import { QUOTED_SLIDE_TRACKS, SLIDE_TRACK_RATE_TWD } from "./slide-tracks.js";
import {
    BEDROOM2_PARTITION_ID, BEDROOM2_PARTITION_OPTIONS, BEDROOM2_PARTITION_QUOTED_AREA,
} from "./partition-options.js";
import { QUOTED_SWITCHES, SWITCH_QUOTED_UNIT_PRICE_TWD } from "./switch-options.js";
import { QUOTED_DOWNLIGHTS, DOWNLIGHT_QUOTED_UNIT_PRICE_TWD } from "./downlights.js";
import {
    isQuotedCircuit, isQuotedOutlet, QUOTED_DEDICATED_COUNT, QUOTED_SOCKET_COUNT,
    SOCKET_UNIT_PRICE_TWD, DEDICATED_CIRCUIT_UNIT_PRICE_TWD,
    QUOTED_WEAK_CURRENT_IDS, WEAK_CURRENT_UNIT_PRICE_TWD,
} from "./socket-plan.js";
import {
    BATHROOM_INSTALLATION_QUOTE, isBathroomInstallationIncluded,
} from "./bathroom-installation.js";
import { isFreshAirUnit } from "./bathroom-fixtures.js";

const money = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });
function line(category, name, quantity, unit, price, note) {
    return `${category}－${name}：${quantity} ${unit} × NT$${money.format(price)}` +
        `＝NT$${money.format(quantity * price)}；${note}`;
}

// These are deidentified line items already transcribed in the public quotation.
export const ORIGINAL_QUOTE_SOURCES = Object.freeze({
    solidWood: line("門片工程", `${DOOR_OPTIONS["solid-wood"].label}－主臥.主浴`, 2, "組",
        DOOR_OPTIONS["solid-wood"].unitPrice, "門框、門片側邊需刷油漆／水平鎖；品牌省略"),
    woodFiber: line("門片工程", "木纖門－臥室１.工作室.臥室3", 3, "組",
        DOOR_OPTIONS["wood-fiber"].unitPrice, "門框、門片側邊需刷油漆／水平鎖"),
    bathroomDoor: line("門片工程", "廁所門", 2, "組",
        DOOR_OPTIONS.bathroom.unitPrice, "塑鋼門／水平鎖／待選"),
    woodSlide: line("門片工程", "木纖滑門-臥室２.工作室", 2, "組",
        DOOR_OPTIONS["wood-slide"].unitPrice, "含國產五金、緩衝軌道、軌道盒"),
    glass: line("門片工程", "乾濕分離(一字)", 2, "間", 22000,
        "無框強化玻璃／含h門檻；乾濕地降板需提前告知"),
    film: line("門片工程", "防爆膜(一字)", 2, "間", 3000, "原表未列型號，與玻璃分項計價"),
    slideTrack: line("輕隔間工程(台灣板材)", "滑門軌道－主浴.工作室", 1.6, "米",
        SLIDE_TRACK_RATE_TWD, "此門暫分原額度0.8米，長度與門片／軌道抵用待核"),
    partition: line("輕隔間工程(台灣板材)", "輕隔間(雙面雙層)－臥室２",
        BEDROOM2_PARTITION_QUOTED_AREA, "坪", BEDROOM2_PARTITION_OPTIONS["double-double"].unitPrice,
        "矽酸鈣板三分板0.9＋石膏1.2／岩綿；替代做法原數量未填"),
    switches: line("水電工程", "單/雙開關配置", QUOTED_SWITCHES.length, "個",
        SWITCH_QUOTED_UNIT_PRICE_TWD,
        "太平洋電線(1.6/2.0mm2)／CD硬管；國際Risna黑灰色開關"),
    sockets: line("水電工程", "插座迴路配置", QUOTED_SOCKET_COUNT, "個", SOCKET_UNIT_PRICE_TWD,
        "太平洋電線(2.0mm2)／CD硬管；國際星光開關插座；專用迴路另列"),
    circuits: line("水電工程", "專屬迴路(5.5mm2)", QUOTED_DEDICATED_COUNT, "個",
        DEDICATED_CIRCUIT_UNIT_PRICE_TWD,
        "原註冷氣×3／電器櫃×1／暖風機×2／IH爐×1；其餘器材未填數量，現用途及抵用待核"),
    weak: line("水電工程", "弱電配置", QUOTED_WEAK_CURRENT_IDS.length, "條",
        WEAK_CURRENT_UNIT_PRICE_TWD,
        "電視1、網路線6、電話線、對講機；C埠暫對應原額度，非電源、不重複加價"),
    downlights: line("水電工程", "崁燈安裝－廁所.廚房", QUOTED_DOWNLIGHTS.length, "個",
        DOWNLIGHT_QUOTED_UNIT_PRICE_TWD, "配線及安裝（含燈具－舞光 LED 索爾嵌燈）"),
    bathroomInstallation: line("水電工程", "衛浴設備安裝", BATHROOM_INSTALLATION_QUOTE.suites,
        "套", BATHROOM_INSTALLATION_QUOTE.unitPriceTWD, "衛浴安裝含五金（衛浴自備）"),
    heaterInstallation: line("水電工程", "暖風機安裝", 2, "組", 2500,
        "暖風機自備；目前僅暫借額度給新風機，非已報新風機安裝，開孔／管路／電氣須重報"),
});

const doorSourceKeys = new Map([
    ["master", "solidWood"], ["main-bath-master", "solidWood"],
    ["bedroom-1", "woodFiber"], ["studio", "woodFiber"], ["bedroom-3", "woodFiber"],
    ["main-bath-hall", "bathroomDoor"], ["guest-bath", "bathroomDoor"],
    ["bedroom-2", "woodSlide"], ["balcony", "woodSlide"],
]);
const equipmentSourceKeys = new Map([
    ...["bath-main", "bath-guest"].flatMap((room) => [
        [`${room}-wet-dry-glass`, "glass"], [`${room}-safety-film`, "film"],
        [`${room}-heater-install`, "heaterInstallation"],
    ]),
    ...QUOTED_SLIDE_TRACKS.map((item) => [item.id, "slideTrack"]),
    [BEDROOM2_PARTITION_ID, "partition"],
    ...QUOTED_SWITCHES.map((item) => [item.id, "switches"]),
    ...QUOTED_DOWNLIGHTS.map((item) => [item.id, "downlights"]),
    ...QUOTED_WEAK_CURRENT_IDS.map((id) => [id, "weak"]),
]);

export function quoteProvenance(item) {
    if (item?.kind === "door") {
        if (isUnquotedBalconyDoor(item)) {
            return "陽台門未計算，非免費；原誤配的工作室木纖滑門19,000元額度已轉至臥室3↔工作室，未另增門片費。\n" +
                ORIGINAL_QUOTE_SOURCES.woodSlide;
        }
        if (isAllocatedDoorItem(item) && item.doorId === "bedroom-3-studio") {
            return ORIGINAL_QUOTE_SOURCES.woodSlide +
                "\n屋主指定原工作室額度由陽台轉至此門位，並非第三組追加門片。\n" +
                DOOR_TRACK_CAUTION;
        }
        if (["main-shower", "guest-shower"].includes(item.doorId)) {
            return `${ORIGINAL_QUOTE_SOURCES.glass}\n${ORIGINAL_QUOTE_SOURCES.film}` +
                "\n此筆僅玻璃門位，費用已分列同房設備，不另計門片。";
        }
        const key = doorSourceKeys.get(item.doorId);
        if (key) return ORIGINAL_QUOTE_SOURCES[key];
    } else if (isQuotedEquipment(item)) {
        if (isAllocatedDoorItem(item)) {
            return ORIGINAL_QUOTE_SOURCES.slideTrack + "\n" + DOOR_TRACK_CAUTION;
        }
        const key = isQuotedOutlet(item) ? "sockets" : isQuotedCircuit(item) ? "circuits" :
            equipmentSourceKeys.get(item.id);
        if (key) return ORIGINAL_QUOTE_SOURCES[key];
    } else return null;
    throw new RangeError(`原報價來源未對應：${item.id}；不可推測已含項目。`);
}

export function installationQuoteProvenance(item) {
    return isBathroomInstallationIncluded(item) ? ORIGINAL_QUOTE_SOURCES.bathroomInstallation : null;
}

export function markerQuoteProvenance(item, items = []) {
    if (!item) return "";
    const sources = [quoteProvenance(item), installationQuoteProvenance(item)];
    if (item.kind === "door") {
        sources.push(...items.filter((entry) => entry.trackDoorId === item.doorId)
            .map(quoteProvenance));
    }
    if (isFreshAirUnit(item)) {
        const installation = items.find((entry) => entry.id === `${item.roomId}-heater-install`);
        if (installation) sources.push(quoteProvenance(installation));
    }
    return [...new Set(sources.filter(Boolean))].join("\n");
}
