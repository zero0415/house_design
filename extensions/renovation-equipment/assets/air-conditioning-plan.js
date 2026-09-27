import { AC_ROOM_IDS, airConditioningWarnings, isSplitAirConditioner } from "./ac-outdoors.js";
import { applyProductToItem, productFromDraft } from "./product-database.js";

export const SPLIT_AC_PRODUCT_ID = "sample-product-21";
export const WINDOW_AC_PRODUCT_ID = "sample-product-22";
export const SMALL_ROOM_AC_PRODUCT_ID = "sample-product-28";
export const SMALL_ROOM_IDS = Object.freeze([
    "bedroom-1", "bedroom-2", "bedroom-3", "studio",
]);
export const SPLIT_AC_URL = "https://24h.pchome.com.tw/prod/DPAF3W-1900IW482";
export const WINDOW_AC_URL = "https://24h.pchome.com.tw/prod/DPAF1N-1900JP7T4";
export const SMALL_ROOM_AC_URL = "https://24h.pchome.com.tw/prod/DPAF1P-A900G6O38?fq=/S/DPAF0V";
export const SMALL_ROOM_AC_DIMENSION_URL = "https://www.momoshop.com.tw/product/10967257";
export const SPLIT_AC_NOTE =
    "CHIMEI 奇美 RB-S51HG1室內／RC-S51HG1室外，冷暖各5.1kW、220V、室外機供電。" +
    "一套本體只計一次NT$27,980，不另列室外機價格。" +
    "商品尺寸寬×高×深：室外95.5×67.5×34.5cm（寬含配管蓋）；室內96.5×32×21.5cm。" +
    "室內圖示僅定位；室外占地按商品寬深，維修、散熱與配管淨距未畫入，原位置不自動調整。" +
    "標題坪數8–10、內文8–11不一致，不作工程選型依據。" +
    "標題運送／拆箱安裝／舊機回收文字不等於完整施工報價；人工、支架、冷媒管、排水、許可及電氣範圍與費用未核，不列入已知本體暫計。" +
    "既有電源標位與9條迴路完全不改，不假設六台已有足夠迴路；須電工核對容量與服務機組。";
export const SMALL_ROOM_AC_NOTE =
    "GREE 格力 GPR-23HI室內／GPR-23HO室外，每套冷2.4kW、暖2.5kW，單相220V 60Hz室外供電。" +
    "PChome售價NT$21,032、標示4坪內，非專業熱負載／迴路設計。" +
    "momo同型號明列室外寬73.2×高55.5×深33cm、室內寬82.5×高29.3×深19.6cm；" +
    "PChome的室內外尺寸標籤互換，且室內高度標29.6而非29.3cm，原廠／實機待確認。" +
    "機身占地未含支架、散熱／維修淨距；保留原暫位，臥室2無室外位或穿牆管路。" +
    "商品本體只計一次；安裝、支架、冷媒管、排水、供電、許可與施工補差未報，" +
    "原三條冷氣專線未分配六套；不得據圖施工。";

export function airConditioningProducts() {
    return [
        productFromDraft({
            type: "split-ac", environment: "indoor", name: "CHIMEI 奇美 5.1kW 分離式冷暖一套",
            brandModel: "CHIMEI 奇美 RB-S51HG1／RC-S51HG1",
            unitPrice: 27980, priceCurrency: "TWD",
            widthCm: 96.5, heightCm: 32, depthCm: 21.5,
            outdoorWidthCm: 95.5, outdoorHeightCm: 67.5, outdoorDepthCm: 34.5,
            priceSource: `PChome商品參考價 NT$27,980（2026-09-28核對）；${SPLIT_AC_URL}；施工範圍與費用待報`,
            note: SPLIT_AC_NOTE,
        }, SPLIT_AC_PRODUCT_ID),
        productFromDraft({
            type: "window-ac", environment: "indoor", name: "HAWRIN 華菱窗型冷暖（未選用候選）",
            brandModel: "HAWRIN 華菱 RNR-22IHU（4坪以下、右吹窗型）",
            unitPrice: 16999, priceCurrency: "TWD",
            priceSource: `PChome商品參考價 NT$16,999（2026-09-28核對）；${WINDOW_AC_URL}`,
            note: "未選用、不計入任何房間；臥室2已改回條件式分離式。" +
                "此為右吹窗型冷暖，需合法對外開口、承重及排熱條件，不是移動式或免排熱機。" +
                "室內隔間留孔不等於對外開口；安裝、排水、供電及許可待專業確認。不可當分離式或一般家具放置。",
        }, WINDOW_AC_PRODUCT_ID),
        productFromDraft({
            type: "split-ac", environment: "indoor",
            name: "GREE 格力 4坪內分離式冷暖一套",
            brandModel: "GREE 格力 GPR-23HI／GPR-23HO",
            unitPrice: 21032, priceCurrency: "TWD",
            widthCm: 82.5, heightCm: null, depthCm: 19.6,
            outdoorWidthCm: 73.2, outdoorHeightCm: 55.5, outdoorDepthCm: 33,
            priceSource: `PChome商品參考價 NT$21,032（2026-09-28核對）：${SMALL_ROOM_AC_URL}；` +
                `同型尺寸交叉核對：${SMALL_ROOM_AC_DIMENSION_URL}；室內高度29.3／29.6cm不一致，安裝未報`,
            note: SMALL_ROOM_AC_NOTE,
        }, SMALL_ROOM_AC_PRODUCT_ID),
    ];
}

export function migrateAirConditioningPlan(latest) {
    if (latest?.version !== 5 || !Array.isArray(latest.items) || !Array.isArray(latest.products)) {
        throw new TypeError("冷氣更新只接受最新完整v5副本。");
    }
    const systems = AC_ROOM_IDS.map((roomId) => latest.items.find((item) =>
        item.id === `ac-${roomId}` && item.roomId === roomId && isSplitAirConditioner(item)));
    if (systems.some((item) => !item)) {
        throw new RangeError("六個既有成套冷氣項目不完整；不新增或捏造室內外機位，請先核對。");
    }
    const ids = [SPLIT_AC_PRODUCT_ID, WINDOW_AC_PRODUCT_ID, SMALL_ROOM_AC_PRODUCT_ID];
    const present = latest.products.filter((product) => ids.includes(product.id));
    if (present.length === 3 &&
        present.find((product) => product.id === SPLIT_AC_PRODUCT_ID)?.type === "split-ac" &&
        present.find((product) => product.id === WINDOW_AC_PRODUCT_ID)?.type === "window-ac" &&
        present.find((product) => product.id === SMALL_ROOM_AC_PRODUCT_ID)?.type === "split-ac" &&
        systems.every((item) => item.productId ===
            (SMALL_ROOM_IDS.includes(item.roomId) ? SMALL_ROOM_AC_PRODUCT_ID :
                SPLIT_AC_PRODUCT_ID))) {
        return { state: structuredClone(latest), changed: false, addedProducts: 0 };
    }
    if (present.length || systems.some((item) => ids.includes(item.productId)) ||
        latest.products.some((product) => /RB-S51HG1|RNR-22IHU|GPR-23HI/i.test(product.brandModel ?? ""))) {
        throw new RangeError("冷氣商品部分存在或已有同型號商品／選款衝突，請先人工核對，不覆蓋後續編輯。");
    }
    const products = airConditioningProducts();
    const state = structuredClone(latest);
    state.products.push(...products);
    state.items = state.items.map((item) => {
        if (!systems.some((system) => system.id === item.id)) return item;
        const selected = SMALL_ROOM_IDS.includes(item.roomId) ? products[2] : products[0];
        const next = applyProductToItem(selected, { ...item, acPlanStatus: "active" });
        if (item.id === "ac-bedroom-2") {
            next.name = "冷氣（臥室2條件規劃）";
            next.outdoorPlacement = null;
            next.outdoorZoneId = null;
        }
        next.note = `${selected.note} ${airConditioningWarnings(next).join(" ")}`;
        return next;
    });
    state.undo = structuredClone({ rooms: latest.rooms, items: latest.items, products: latest.products });
    return { state, changed: true, addedProducts: 3 };
}
