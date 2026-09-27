import { isSplitAirConditioner } from "./ac-outdoors.js";
import { FURNITURE_TEMPLATES } from "./furniture.js";
import { installedDownlightUnitPrice } from "./lighting-options.js";
import { planDisplayCategory } from "./plan-visibility.js";
import {
    DEDICATED_CIRCUIT_UNIT_PRICE_TWD, isDedicatedCircuit, SOCKET_UNIT_PRICE_TWD,
} from "./socket-plan.js";
import { switchOptionFor } from "./switch-options.js";

export const CUSTOM_PRODUCT_TYPES = Object.freeze({
    equipment: "一般設備／家具",
    "switch-single": "單開關",
    "switch-double": "雙開關",
    "outlet-general": "一般插座",
    "dedicated-circuit": "專用迴路（配對一般插座）",
    ceiling: "吸頂燈",
    recessed: "崁燈（含安裝）",
    track: "軌道＋軌道燈組",
});

const GROUP_LABELS = Object.freeze({
    switches: "開關", outlets: "插座", circuits: "專用迴路",
    lights: "燈具", furniture: "其他設備",
});

function category(source) {
    if (isDedicatedCircuit(source)) return "circuits";
    return planDisplayCategory(source);
}

export function catalogType(source) {
    if (isDedicatedCircuit(source)) return "dedicated-circuit";
    if (source.lightType === "ceiling" || source.lightType === "recessed" ||
        source.lightType === "track") return source.lightType;
    if (source.switchType) return `switch-${source.switchType}`;
    if (source.outletCircuit) return "outlet-general";
    return "equipment";
}

function productName(source, group) {
    if (group === "switches") {
        const option = switchOptionFor(source);
        if (!option) throw new RangeError(`開關範本型式無效：${source.id}`);
        return `新增${option.label}`;
    }
    if (group === "outlets") {
        return "新增一般插座";
    }
    if (group === "circuits") return "新增專用迴路";
    if (group === "lights") {
        return source.lightType === "track" ? "新增軌道燈組" :
            source.lightType === "recessed" ? "新增崁燈" : "新增吸頂燈";
    }
    return source.name;
}

function catalogKey(source, group) {
    if (group === "furniture") {
        return JSON.stringify([group, source.name, source.brandModel,
            source.unitPrice, source.priceCurrency, source.widthCm, source.depthCm]);
    }
    return JSON.stringify([group, source.switchType, source.switchEnvironment,
        source.outletCircuit ? "general" : null, source.equipmentType,
        source.lightType, source.lightSelection, source.trackSelection,
        source.spotlightSelection, source.spotlightQuantity, source.brandModel,
        source.unitPrice, source.fixtureUnitPrice, source.installationUnitPrice,
        source.spotlightUnitPrice, source.priceCurrency, source.lightWatts,
        source.lightLumens, source.beamAngleDeg, source.lightSpecSource]);
}

function availableInRoom(source, roomId, group) {
    if (roomId === "ac-platform" && group !== "furniture") return false;
    if (group === "switches") {
        return source.switchPlanStatus !== "removed" &&
            (roomId === "balcony") === (source.switchEnvironment === "outdoor");
    }
    if (group === "outlets") {
        return roomId !== "balcony" || source.roomId === "balcony";
    }
    if (group === "circuits") return true;
    if (group === "lights") {
        return source.lightType === "ceiling"
            ? (roomId === "balcony") === (source.roomId === "balcony")
            : roomId !== "balcony";
    }
    return true;
}

export function equipmentCatalog(items, roomId) {
    if (!Array.isArray(items) || typeof roomId !== "string") {
        throw new TypeError("商品清單需要設備資料與選定房間。");
    }
    const groups = { switches: [], outlets: [], circuits: [], lights: [], furniture: [] };
    const seen = new Set();
    for (const source of items) {
        if (source.kind === "door" || isSplitAirConditioner(source) ||
            source.name === "新設備" ||
            source.kind !== "equipment" && source.kind !== "furniture") continue;
        const group = category(source);
        if (group === "lights" && !["ceiling", "recessed", "track"]
            .includes(source.lightType)) continue;
        if (group === "switches" && !source.switchType ||
            group === "outlets" && !source.outletCircuit ||
            group === "circuits" && !isDedicatedCircuit(source)) continue;
        if (group === "furniture" && source.quotedUnitPrice != null) continue;
        if (!availableInRoom(source, roomId, group)) continue;
        const key = catalogKey(source, group);
        if (seen.has(key)) continue;
        seen.add(key);
        const name = productName(source, group);
        const model = source.brandModel?.trim();
        const price = source.unitPrice == null ? "價格待補" :
            `${source.priceCurrency === "TWD" ? "NT$" : source.priceCurrency} ${source.unitPrice}`;
        groups[group].push({
            id: source.id, group, groupLabel: GROUP_LABELS[group], source,
            label: `${name}${model ? `｜${model}` : ""}（${price}）`,
        });
    }
    return Object.keys(groups).flatMap((group) => groups[group]
        .sort((a, b) => a.label.localeCompare(b.label, "zh-Hant")));
}

function baseItem(id, roomId, name, group) {
    return {
        id, roomId, name, quantity: 1, unit: "組", brandModel: "",
        unitPrice: null, priceCurrency: "TWD", priceSource: "", note: "",
        placement: null, orientation: null, kind: "equipment",
        furnitureType: null, widthCm: null, depthCm: null,
        equipmentCategory: group === "circuits" ? null : group,
        markerStyle: group === "circuits" ? null : "square-label", productId: null,
        quotedUnitPrice: null, quotedQuantity: null,
    };
}

export function equipmentFromTemplate(source, roomId, id) {
    if (!source || typeof roomId !== "string" || typeof id !== "string") {
        throw new TypeError("套用商品需要有效的範本、房間和新設備識別碼。");
    }
    const entry = equipmentCatalog([source], roomId)[0];
    if (!entry) throw new RangeError("這項商品不能在所選房間套用；請改用自行新增。");
    const group = entry.group;
    const item = baseItem(id, roomId, productName(source, group), group);
    item.unit = source.unit;
    item.brandModel = source.brandModel ?? "";
    item.unitPrice = source.unitPrice;
    item.priceCurrency = source.priceCurrency;
    const reference = `此筆是新增商品（原報額度不增加），參考「${source.name}」` +
        `（${source.id}）的型號與單價；位置、配線、施工及實價待重新確認。`;
    item.priceSource = !source.priceSource
        ? `追加試算，非原報額度；參考範本 ${source.id}，商品價待核`
        : `追加試算，非原報額度；${source.priceSource}`.length <= 500
            ? `追加試算，非原報額度；${source.priceSource}`
            : `追加試算，非原報額度；參考原項 ${source.id} 的價格來源`;
    item.note = group === "circuits"
        ? `${reference} 須再選一個已標位的一般插座配對；` +
            "迴路變動可能使高負載共線跳電，至少保留原報 7 條並請電工核對。"
        : group === "outlets" && roomId === "balcony"
            ? `${reference} 陽台防水插座、防護等級及漏電保護須電工現勘。`
        : group === "lights"
            ? `${reference} 安裝與商品價格僅供試算；實際天花及配線須重核。`
            : group === "switches" && roomId === "balcony"
                ? `${reference} 戶外防潮等級、防水盒及施工補差另待電工報價。`
                    : source.furnitureType === "dryer"
                        ? `${reference} 烘衣機如放鐵窗，承重、防雨、散熱、排氣和新增專用供電均須另核。`
                        : source.equipmentType === "fresh-air"
                            ? `${reference} 室外進氣管路及安裝另核，原暖風機額度不隨商品範本複製。`
                            : reference;
    if (group === "switches") {
        item.quantity = 1;
        item.unit = "個";
        item.switchType = source.switchType;
        item.switchEnvironment = source.switchEnvironment ?? "indoor";
        item.switchPlanStatus = "active";
    } else if (group === "outlets") {
        item.quantity = 1;
        item.unit = "個";
        item.outletCircuit = "additional-general";
        item.unitPrice ??= SOCKET_UNIT_PRICE_TWD;
    } else if (group === "circuits") {
        item.quantity = 1;
        item.unit = "條";
        item.equipmentType = "dedicated-circuit";
        item.circuitOutletId = null;
        item.unitPrice ??= DEDICATED_CIRCUIT_UNIT_PRICE_TWD;
    } else if (group === "lights") {
        item.quantity = 1;
        item.lightType = source.lightType;
        item.lightWatts = source.lightWatts ?? null;
        item.lightLumens = source.lightLumens ?? null;
        item.beamAngleDeg = source.beamAngleDeg ?? null;
        item.lightSpecSource = source.lightSpecSource ?? "";
        item.installationUnitPrice = source.installationUnitPrice ?? null;
        if (source.lightType === "recessed") {
            item.unit = "個";
            item.lightSelection = source.lightSelection ?? null;
            item.fixtureUnitPrice = source.fixtureUnitPrice ?? null;
        } else if (source.lightType === "ceiling") {
            item.unit = "盞";
            item.lightSelection = source.lightSelection ?? null;
        } else {
            item.unit = "條";
            item.trackLengthCm = source.trackLengthCm;
            item.trackSelection = source.trackSelection ?? null;
            item.spotlightQuantity = source.spotlightQuantity;
            item.spotlightUnitPrice = source.spotlightUnitPrice ?? null;
            item.spotlightModel = source.spotlightModel ?? "";
            item.spotlightSelection = source.spotlightSelection ?? null;
            item.spotlightPriceSource = source.spotlightPriceSource ?? "";
        }
    } else {
        item.widthCm = source.widthCm ?? null;
        item.depthCm = source.depthCm ?? null;
        if (source.kind === "furniture") {
            if (!Object.hasOwn(FURNITURE_TEMPLATES, source.furnitureType)) {
                throw new RangeError("來源家具的圖例類型已失效；請重新選擇。");
            }
            item.kind = "furniture";
            item.furnitureType = source.furnitureType;
            item.markerStyle = null;
            item.equipmentCategory = null;
        }
    }
    return item;
}

function optionalPrice(value, label) {
    if (value === null || value === undefined ||
        typeof value === "string" && !value.trim()) return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0) {
        throw new RangeError(`${label}必須是非負數，或留白待報。`);
    }
    return number;
}

function optionalLightSpec(value, label, minimum, maximum) {
    const number = optionalPrice(value, label);
    if (number !== null && (number < minimum || number > maximum)) {
        throw new RangeError(`${label}須為 ${minimum} 至 ${maximum}，或留白待查。`);
    }
    return number;
}

export function customEquipment(draft, id) {
    const { roomId, customType: type } = draft;
    if (!Object.hasOwn(CUSTOM_PRODUCT_TYPES, type)) {
        throw new RangeError("請選擇自訂設備的圖面類別。");
    }
    const name = draft.name?.trim();
    const model = draft.model?.trim() ?? "";
    const spotlightModel = draft.spotlightModel?.trim() ?? "";
    const source = draft.priceSource?.trim() ?? "";
    if (!name || name.length > 120 || model.length > 200 ||
        spotlightModel.length > 200 || source.length > 450 ||
        (draft.note?.length ?? 0) > 1000 || (draft.unit?.length ?? 0) > 16 ||
        (draft.lightSpecSource?.length ?? 0) > 500) {
        throw new RangeError("請填寫 1–120 字的名稱；型號至多 200 字、備註至多 1000 字。");
    }
    const group = type.startsWith("switch") ? "switches" :
        type === "outlet-general" ? "outlets" :
        type === "dedicated-circuit" ? "circuits" :
            ["ceiling", "recessed", "track"].includes(type) ? "lights" : "furniture";
    if (roomId === "ac-platform" && group !== "furniture" ||
        roomId === "balcony" && ["recessed", "track"].includes(type)) {
        throw new RangeError("外推鐵窗不可預設一般電器點位；陽台照明須選防潮吸頂燈。");
    }
    const item = baseItem(id, roomId, name, group);
    item.brandModel = model;
    item.note = draft.note?.trim() ?? "";
    item.unitPrice = optionalPrice(draft.unitPrice, "商品單價");
    item.priceSource = source ? `自行新增商品，非原報額度；${source}` :
        "自行新增商品；價格與施工規格待廠商確認";
    if (group === "lights") {
        item.lightWatts = optionalLightSpec(draft.lightWatts,
            "每盞瓦數（W）", .1, 1000);
        item.lightLumens = optionalLightSpec(draft.lightLumens,
            "每盞光通量（lm）", 1, 200000);
        item.beamAngleDeg = optionalLightSpec(draft.beamAngleDeg,
            "光束角（度）", 1, 180);
        item.lightSpecSource = draft.lightSpecSource?.trim() ?? "";
    }
    if (group === "switches") {
        item.quantity = 1;
        item.unit = "個";
        item.switchType = type.endsWith("single") ? "single" : "double";
        item.switchEnvironment = roomId === "balcony" ? "outdoor" : "indoor";
        item.switchPlanStatus = "active";
        item.brandModel ||= switchOptionFor(item).brandModel;
        item.note = `${item.note} 此為原報價 15 個以外的開關；` +
            (roomId === "balcony" ? "戶外防水盒、防護等級及施工補差須電工核對。" :
                "配線、安裝及實際單價須電工核對。");
    } else if (group === "outlets") {
        item.quantity = 1;
        item.unit = "個";
        item.outletCircuit = "additional-general";
        item.unitPrice ??= SOCKET_UNIT_PRICE_TWD;
        item.note = `${item.note} 此為原報價 50 個實體插座之外的新增點位；` +
            (roomId === "balcony" ? "陽台須選戶外防水款、漏電保護與防水進線；" : "") +
            "電壓、負載、防護及施工待電工核對。";
    } else if (group === "circuits") {
        item.quantity = 1;
        item.unit = "條";
        item.equipmentType = "dedicated-circuit";
        item.circuitOutletId = null;
        item.unitPrice ??= DEDICATED_CIRCUIT_UNIT_PRICE_TWD;
        item.brandModel ||= "專屬配線（5.5mm²；負載與保護待核）";
        item.note = `${item.note} 每條專用迴路須對應一個已標位的一般插座；` +
            "增減時須核對配電容量與跳電風險，建議維持原報 7 條以上。";
    } else if (type === "ceiling") {
        item.unit = "盞";
        item.lightType = "ceiling";
        item.lightSelection = roomId === "balcony" ? "outdoor-custom" : "custom";
        item.brandModel ||= roomId === "balcony"
            ? "陽台防潮吸頂燈（戶外型號待填）" : "吸頂燈（型號待填）";
        item.installationUnitPrice = optionalPrice(draft.installationPrice, "燈具安裝單價");
        item.note = `${item.note} 燈具本體與配線安裝分開計價；` +
            (roomId === "balcony" ? "戶外防潮防水與屋頂固定須現勘。" :
                "天花及接線須現勘。");
    } else if (type === "recessed") {
        item.unit = "個";
        item.lightType = "recessed";
        item.lightSelection = "custom";
        item.brandModel ||= "崁燈（型號待填）";
        item.fixtureUnitPrice = item.unitPrice;
        item.installationUnitPrice = optionalPrice(draft.installationPrice, "崁燈安裝單價");
        item.unitPrice = installedDownlightUnitPrice(
            item.fixtureUnitPrice, item.installationUnitPrice
        );
        item.note = `${item.note} 崁燈本體與安裝皆須估價才有完整單價；` +
            "原報 6 顆額度不增加，濕區防護與開孔待核。";
    } else if (type === "track") {
        item.unit = "條";
        item.lightType = "track";
        item.trackLengthCm = 150;
        item.trackSelection = "custom";
        item.brandModel ||= "軌道 1.5 米（型號待填）";
        item.spotlightSelection = "custom";
        item.spotlightQuantity = 3;
        item.spotlightModel = spotlightModel || "軌道燈（型號待填）";
        item.spotlightUnitPrice = optionalPrice(draft.spotlightPrice, "每盞軌道燈單價");
        item.spotlightPriceSource = "自行新增軌道燈；型號、價格與相容性待核";
        item.installationUnitPrice = optionalPrice(draft.installationPrice, "軌道安裝單價");
        item.note = `${item.note} 新增 150cm 軌道及 3 盞燈，另計安裝；` +
            "軌道接頭、天花固定、實際長度及配線待核。";
    } else {
        const quantity = Number(draft.quantity || 1);
        if (!Number.isFinite(quantity) || quantity <= 0 || !draft.unit?.trim()) {
            throw new RangeError("請填寫正數的設備數量及單位。");
        }
        item.quantity = quantity;
        item.unit = draft.unit.trim();
        item.priceCurrency = draft.priceCurrency ?? "TWD";
    }
    if (item.note.length > 1000) {
        throw new RangeError("備註加上安全與報價提示後超過 1000 字，請縮短內容。");
    }
    return item;
}
