import { isSplitAirConditioner } from "./ac-outdoors.js";
import { isQuotedEquipment } from "./budget.js";
import { customEquipment, CUSTOM_PRODUCT_TYPES } from "./equipment-catalog.js";
import { installedDownlightUnitPrice } from "./lighting-options.js";
import { isDedicatedCircuit } from "./socket-plan.js";
import { SWITCH_TYPES } from "./switch-options.js";

export const PRODUCT_TYPES = CUSTOM_PRODUCT_TYPES;

export const PRODUCT_ENVIRONMENTS = Object.freeze({
    indoor: "室內",
    balcony: "陽台防潮（規格待核）",
    any: "位置不限（施工適用性另核）",
});

export function productUnit(type) {
    if (type === "ceiling") return "盞";
    if (type === "track" || type === "dedicated-circuit") return "條";
    if (type === "equipment") return "組";
    return "個";
}

function draftNumber(value, label, { positive = false } = {}) {
    if (value == null || String(value).trim() === "") return null;
    const number = Number(value);
    if (!Number.isFinite(number) || number < (positive ? Number.EPSILON : 0) ||
        number > (positive ? 3000 : 1e9)) {
        throw new RangeError(`${label}必須是${positive ? "大於零的公分數" :
            "非負數"}，或留白待確認。`);
    }
    return number;
}

function opticalNumber(value, label, minimum, maximum) {
    const number = draftNumber(value, label);
    if (number !== null && (number < minimum || number > maximum)) {
        throw new RangeError(`${label}須為 ${minimum} 至 ${maximum}，或留白待查。`);
    }
    return number;
}

export function productFromDraft(draft, id) {
    const { type, environment } = draft;
    if (!Object.hasOwn(PRODUCT_TYPES, type) ||
        !Object.hasOwn(PRODUCT_ENVIRONMENTS, environment) ||
        environment === "any" && type !== "equipment" ||
        environment === "balcony" && ["recessed", "track"].includes(type)) {
        throw new RangeError("請選擇適用的商品類型和室內／陽台環境。");
    }
    const name = draft.name?.trim() ?? "";
    const brandModel = draft.brandModel?.trim() ?? "";
    const unit = type === "equipment" ? draft.unit?.trim() ?? "" : productUnit(type);
    const priceSource = draft.priceSource?.trim() ?? "";
    const note = draft.note?.trim() ?? "";
    if (!name || name.length > 120 || (type !== "equipment" && !brandModel) ||
        brandModel.length > 200 || !unit || unit.length > 16 ||
        priceSource.length > 450 || note.length > 800) {
        throw new RangeError("商品名稱、規格與單位必填；名稱最多 120 字，規格最多 200 字。");
    }
    if (type.startsWith("switch-") && environment === "balcony" &&
        Object.values(SWITCH_TYPES).some((option) =>
            option.brandModel === brandModel)) {
        throw new RangeError("陽台開關不能沿用室內面板型號，須另選戶外防潮款。");
    }
    const priceCurrency = draft.priceCurrency ?? "TWD";
    if (!["TWD", "JPY", "USD"].includes(priceCurrency) ||
        !["equipment", "ceiling"].includes(type) && priceCurrency !== "TWD") {
        throw new RangeError("這種商品須用新台幣計價；家具及自訂吸頂燈可另選外幣。");
    }
    const installation = ["ceiling", "recessed", "track"].includes(type);
    if (!installation && [draft.lightWatts, draft.lightLumens, draft.beamAngleDeg,
        draft.lightSpecSource].some((value) => value != null && String(value).trim())) {
        throw new RangeError("非燈具商品不能設定瓦數與光學規格。");
    }
    const lightSpecSource = installation ? draft.lightSpecSource?.trim() ?? "" : "";
    if (lightSpecSource.length > 450) {
        throw new RangeError("燈具光學資料來源至多 450 字元。");
    }
    const spotlights = type === "track";
    const spotlightQuantity = spotlights ? Number(draft.spotlightQuantity) : null;
    const spotlightModel = spotlights ? draft.spotlightModel?.trim() ?? "" : null;
    if (spotlights && (!Number.isSafeInteger(spotlightQuantity) ||
        spotlightQuantity < 0 || spotlightQuantity > 12 ||
        spotlightQuantity > 0 && (!spotlightModel || spotlightModel.length > 200) ||
        spotlightModel.length > 200)) {
        throw new RangeError("軌道燈數量須為 0–12 盞；有燈具時須填燈具型號。");
    }
    return {
        id, type, environment, name, brandModel, unit, priceCurrency, priceSource, note,
        unitPrice: draftNumber(draft.unitPrice, "商品單價"),
        installationUnitPrice: installation
            ? draftNumber(draft.installationUnitPrice, "安裝單價") : null,
        widthCm: type === "equipment"
            ? draftNumber(draft.widthCm, "商品寬度", { positive: true }) : null,
        depthCm: type === "equipment"
            ? draftNumber(draft.depthCm, "商品深度", { positive: true }) : null,
        spotlightModel,
        spotlightQuantity,
        spotlightUnitPrice: spotlights
            ? draftNumber(draft.spotlightUnitPrice, "軌道燈單價") : null,
        lightWatts: installation
            ? opticalNumber(draft.lightWatts, "每盞瓦數（W）", .1, 1000) : null,
        lightLumens: installation
            ? opticalNumber(draft.lightLumens, "每盞光通量（lm）", 1, 200000) : null,
        beamAngleDeg: installation
            ? opticalNumber(draft.beamAngleDeg, "光束角（度）", 1, 180) : null,
        lightSpecSource,
    };
}

export function productAllowedInRoom(product, roomId) {
    if (!product || !Object.hasOwn(CUSTOM_PRODUCT_TYPES, product.type)) return false;
    if (product.environment === "any") return product.type === "equipment";
    if (product.environment === "balcony") return roomId === "balcony";
    return product.environment === "indoor" &&
        roomId !== "balcony" && roomId !== "ac-platform";
}

export function productTypeForItem(item) {
    if (!item || item.kind === "door" || isSplitAirConditioner(item)) return null;
    if (isDedicatedCircuit(item)) {
        return isQuotedEquipment(item) ? null : "dedicated-circuit";
    }
    if (["fresh-air", "rinse-kit", "heated-towel-rail", "bath-grab-bar"]
        .includes(item.equipmentType)) {
        return isQuotedEquipment(item) ? null : "equipment";
    }
    if (item.lightType === "ceiling") return "ceiling";
    if (item.lightType === "recessed") return "recessed";
    if (item.lightType === "track") return "track";
    if (item.switchType) {
        return isQuotedEquipment(item) ? null : `switch-${item.switchType}`;
    }
    if (item.outletCircuit) {
        if (isQuotedEquipment(item)) return null;
        return "outlet-general";
    }
    if (item.kind === "furniture") return "equipment";
    if (item.kind === "equipment" && !isQuotedEquipment(item) &&
        item.equipmentType == null && item.trackDoorId == null &&
        item.partitionMaterial == null &&
        (item.markerStyle === "square-label" || item.placement != null ||
            item.unitPrice != null && Boolean(item.brandModel?.trim()))) {
        return "equipment";
    }
    return null;
}

export function productCompatibleWithItem(product, item) {
    return productTypeForItem(item) === product?.type &&
        productAllowedInRoom(product, item.roomId);
}

function productSource(product) {
    return `物件資料庫（規劃價連動）；${product.priceSource ||
        `${product.name}｜${product.brandModel || "規格待補"}`}`;
}

export function applyProductToItem(product, item) {
    if (!productCompatibleWithItem(product, item)) {
        throw new RangeError("此款商品與物件種類或室內／陽台使用位置不相容。");
    }
    const next = {
        ...item,
        productId: product.id,
        brandModel: product.brandModel,
        unitPrice: product.unitPrice,
        priceCurrency: product.priceCurrency,
        priceSource: productSource(product),
        unit: product.unit,
    };
    if (["ceiling", "recessed", "track"].includes(product.type)) {
        next.lightWatts = product.lightWatts;
        next.lightLumens = product.lightLumens;
        next.beamAngleDeg = product.beamAngleDeg;
        next.lightSpecSource = product.lightSpecSource;
    }
    if (product.type === "equipment") {
        if (product.widthCm != null) next.widthCm = product.widthCm;
        if (product.depthCm != null) next.depthCm = product.depthCm;
    } else if (product.type.startsWith("switch-")) {
        next.switchEnvironment = product.environment === "balcony" ? "outdoor" : "indoor";
        next.switchType = product.type.slice("switch-".length);
        next.markerStyle = "square-label";
        next.equipmentCategory = "switches";
    } else if (product.type.startsWith("outlet-")) {
        next.outletCircuit = "additional-general";
        next.markerStyle = "square-label";
        next.equipmentCategory = "outlets";
    } else if (product.type === "ceiling") {
        next.lightSelection = product.environment === "balcony"
            ? "outdoor-custom" : "custom";
        next.installationUnitPrice = product.installationUnitPrice;
    } else if (product.type === "recessed") {
        next.lightSelection = "custom";
        next.fixtureUnitPrice = product.unitPrice;
        next.installationUnitPrice = product.installationUnitPrice;
        next.unitPrice = installedDownlightUnitPrice(
            product.unitPrice, product.installationUnitPrice
        );
    } else if (product.type === "track") {
        next.trackSelection = "custom";
        next.spotlightSelection = "custom";
        next.trackLengthCm = 150;
        next.spotlightQuantity = product.spotlightQuantity;
        next.spotlightModel = product.spotlightModel;
        next.spotlightUnitPrice = product.spotlightUnitPrice;
        next.spotlightPriceSource = productSource(product);
        next.installationUnitPrice = product.installationUnitPrice;
    }
    return next;
}

export function equipmentFromProduct(product, roomId, id) {
    if (!productAllowedInRoom(product, roomId)) {
        throw new RangeError("這款商品不適用於選定房間；請確認防潮或鐵窗施工條件。");
    }
    const item = customEquipment({
        roomId,
        customType: product.type,
        name: product.name,
        model: product.brandModel,
        unit: product.unit,
        quantity: "1",
        unitPrice: product.unitPrice ?? "",
        priceCurrency: product.priceCurrency,
        installationPrice: product.installationUnitPrice ?? "",
        spotlightModel: product.spotlightModel ?? "",
        spotlightPrice: product.spotlightUnitPrice ?? "",
        lightWatts: product.lightWatts ?? "",
        lightLumens: product.lightLumens ?? "",
        beamAngleDeg: product.beamAngleDeg ?? "",
        lightSpecSource: product.lightSpecSource ?? "",
        note: "",
    }, id);
    return applyProductToItem(product, item);
}

export function linkedProductMismatch(product, item) {
    if (!productCompatibleWithItem(product, item)) return "種類或安裝環境";
    const expected = applyProductToItem(product, item);
    const fields = [
        "brandModel", "unit", "unitPrice", "priceCurrency", "priceSource",
    ];
    if (product.type === "equipment") {
        if (product.widthCm != null) fields.push("widthCm");
        if (product.depthCm != null) fields.push("depthCm");
    } else if (product.type.startsWith("switch-")) {
        fields.push("switchType", "switchEnvironment", "markerStyle", "equipmentCategory");
    } else if (product.type.startsWith("outlet-")) {
        fields.push("outletCircuit", "markerStyle", "equipmentCategory");
    } else if (product.type === "ceiling" || product.type === "recessed") {
        fields.push("lightSelection", "installationUnitPrice");
        if (product.type === "recessed") fields.push("fixtureUnitPrice");
    } else if (product.type === "track") {
        fields.push("trackSelection", "spotlightSelection", "trackLengthCm",
            "spotlightQuantity", "spotlightModel", "spotlightUnitPrice",
            "spotlightPriceSource", "installationUnitPrice");
    }
    if (["ceiling", "recessed", "track"].includes(product.type)) {
        fields.push("lightWatts", "lightLumens", "beamAngleDeg", "lightSpecSource");
    }
    return fields.find((field) => (item[field] ?? null) !== (expected[field] ?? null)) ?? null;
}

export function productLabel(product) {
    const model = product.brandModel ? `｜${product.brandModel}` : "";
    const price = product.unitPrice == null ? "本體／商品價待補" :
        `${product.priceCurrency === "TWD" ? "NT$" : product.priceCurrency} ${product.unitPrice}`;
    return `${product.name}${model}（${price}）`;
}
