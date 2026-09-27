import { applyProductToItem, productFromDraft } from "./product-database.js";
import { CORRIDOR_TRACK_ID } from "./track-lighting.js";

export const CORRIDOR_PRODUCT_IDS = Object.freeze([
    "sample-product-19", "sample-product-20",
]);
export const CORRIDOR_RAIL_URL = "https://www.qiliang2017.com/products_detail/1788";
export const CORRIDOR_HEAD_URL = "https://www.qiliang2017.com/products_detail/1880";
export const CORRIDOR_PLAN_NOTE =
    "本次改案初始示意（後續換款／移位後請重核本段）：單條 300cm 軌道置中，4 盞等距示意中心相隔 75cm、距軌道端各 37.5cm。" +
    "走廊約 107×502cm，兩端至最近燈約 138.5cm；不保證全走廊照度均勻。" +
    "瓦數僅作相對光圈示意，lm、光束角、IES 與安裝高度未核，不提供 lux 保證。" +
    "向外瞄準、眩光及天花障礙須現勘。軌道與 OSRAM 燈頭的接頭、電壓及機電相容性未確認，須由安裝者核對 SKU。" +
    "黑／白、色溫待選；商家註明整支 3 米只供自取，運送費未列。" +
    "每條安裝 NT$1,200 僅沿用舊規劃暫估，3m 固定、供電接件及最終工資須重報；不新增迴路。";

export function corridorProducts() {
    return [30, 40].map((watts, index) => productFromDraft({
        type: "track", environment: "indoor",
        name: `走廊 3m 軌道＋4 盞 OSRAM ${watts}W`,
        brandModel: "奇亮科技 E極亮 軌道條 3米 3M（黑／白待選）",
        unit: "條", unitPrice: 340, priceCurrency: "TWD", trackLengthCm: 300,
        spotlightQuantity: 4, spotlightModel: `OSRAM 晶享系列 ${watts}W（色溫／接頭 SKU 待核）`,
        spotlightUnitPrice: watts === 30 ? 786 : 979, installationUnitPrice: 1200,
        lightWatts: watts, lightLumens: null, beamAngleDeg: null, lightSpecSource: "",
        priceSource: `提供售價未獨立驗證：3m 軌道 NT$340 含稅 ${CORRIDOR_RAIL_URL}；` +
            `${watts}W 每盞 NT$${watts === 30 ? 786 : 979} ${CORRIDOR_HEAD_URL}；安裝 NT$1,200 暫估待重報`,
        note: CORRIDOR_PLAN_NOTE,
    }, CORRIDOR_PRODUCT_IDS[index]));
}

export function migrateCorridorPlan(latest) {
    if (latest?.version !== 5 || !Array.isArray(latest.items) || !Array.isArray(latest.products)) {
        throw new TypeError("走廊更新只接受最新完整 v5 副本。");
    }
    const item = latest.items.find((entry) => entry.id === CORRIDOR_TRACK_ID);
    if (!item || item.roomId !== "corridor" || item.lightType !== "track") {
        throw new RangeError("原走廊燈軌不存在或已改用途，請先核對，不另建設備。");
    }
    const existing = latest.products.filter((product) => CORRIDOR_PRODUCT_IDS.includes(product.id));
    if (existing.length === 2 && existing.every((product) => product.type === "track") &&
        CORRIDOR_PRODUCT_IDS.includes(item.productId)) {
        return { state: structuredClone(latest), changed: false, addedProducts: 0 };
    }
    if (existing.length || CORRIDOR_PRODUCT_IDS.includes(item.productId)) {
        throw new RangeError("走廊商品遷移部分存在或選款已變更，請人工核對，不覆蓋後續編輯。");
    }
    const products = corridorProducts();
    if (latest.products.some((product) => product.type === "track" &&
        product.trackLengthCm === 300 && /OSRAM/i.test(product.spotlightModel ?? ""))) {
        throw new RangeError("已有不同 ID 的 3m OSRAM 商品，請先核對避免重複。");
    }
    const state = structuredClone(latest);
    state.products.push(...products);
    state.items = state.items.map((entry) => entry.id !== CORRIDOR_TRACK_ID ? entry : {
        ...applyProductToItem(products[0], entry),
        placement: { x: entry.placement?.x ?? .52, y: .5 },
        orientation: 0,
        note: CORRIDOR_PLAN_NOTE,
    });
    state.undo = structuredClone({ rooms: latest.rooms, items: latest.items, products: latest.products });
    return { state, changed: true, addedProducts: 2 };
}
