import { customEquipment } from "./equipment-catalog.js";
import { FURNITURE_TEMPLATES } from "./furniture.js";
import { equipmentFromProduct, productFromDraft } from "./product-database.js";

export const KITCHEN_QUOTE_SOURCE =
    "獨立廚具報價文字轉錄（原件不收錄）；原工程報價 NT$1,959,530 未含，另計追加";
export const KITCHEN_HOT_WATER_SOURCE =
    "情境提供 NT$35,900：https://shop.3m.com.tw/SalePage/Index/10090121；網頁售價未獨立驗證";
export const KITCHEN_SAFETY =
    "非施工圖。廚房為約 289×165cm 不規則外接輪廓，右牆有窗；梁柱、走道、開門、排水及櫃體淨距須現勘。" +
    "原報廚房原先暫列 7 插座、電器櫃與 IH 共 2 專用迴路及 2 崁燈；新增廚具本身不自動取得迴路，最新電源點位與數量依去識別化標位校對後的存檔為準。" +
    "不可假設飲水機或洗碗機可共用 IH 迴路。" +
    "電工須核對容量、電壓、專用供電與濕區漏電保護；瓦斯、熱源間距、排煙路徑及窗位安全另核。";

const productSpecs = [
    ["sink", "廚房下嵌水槽", "JT-690", 4700, "內槽寬 60.5cm，不是外框／開孔寬；外尺寸、櫃內淨空待核。"],
    ["faucet", "廚房龍頭", "deluxso DF-7100+", 3000, "孔徑、接管及是否含安裝待核。"],
    ["hood", "隱藏式排油煙機", "Sakura R3500DL", 6400, "報價寬 80cm；實機深高、風管與上櫃尺寸待核，不視為已確認排煙路徑。"],
    ["hot-water", "櫃下即熱飲水機", "3M IH1000", 35900,
        "依原規劃資訊附贈軟水濾心，非另列付費品；T 型 220V 插座。機身、濾心更換淨空、管路、安裝、電壓及專用供電待確認。"],
];

const layout = [
    ["prep", "kitchen-prep", 32, 32],
    ["sink-base", "kitchen-sink-base", 100, 32],
    ["cooktop-base", "kitchen-cooktop-base", 178, 32],
    ["tower", "kitchen-tower", 238, 32],
    ["return", "kitchen-return", 238, 99.5],
    ["dishwasher", "kitchen-dishwasher", 32, 35],
    ["sink", "kitchen-sink", 100, 32],
    ["faucet", "kitchen-faucet", 100, 9],
    ["hood", "kitchen-hood", 178, 8],
    ["ih", "kitchen-ih", 158, 40],
    ["gas", "kitchen-gas", 198, 40],
    ["hot-water", "kitchen-hot-water", 100, 54],
];
export const KITCHEN_ITEM_IDS = Object.freeze([
    ...layout.map(([key]) => `kitchen-plan-${key}`), "kitchen-plan-undermount-labor",
]);
export const KITCHEN_PRODUCT_IDS = Object.freeze(
    productSpecs.map(([key]) => `product-kitchen-plan-${key}`));

export function kitchenAdditions() {
    const products = productSpecs.map(([key, name, brandModel, unitPrice, note]) =>
        productFromDraft({
            type: "equipment", environment: "indoor", unit: "組",
            name, brandModel, unitPrice, note,
            priceSource: key === "hot-water" ? KITCHEN_HOT_WATER_SOURCE : KITCHEN_QUOTE_SOURCE,
        }, `product-kitchen-plan-${key}`));
    const items = layout.map(([key, type, x, y]) => {
        const template = FURNITURE_TEMPLATES[type];
        const product = products.find((entry) => entry.id === `product-kitchen-plan-${key}`);
        const id = `kitchen-plan-${key}`;
        const item = product ? equipmentFromProduct(product, "kitchen", id) :
            customEquipment({ roomId: "kitchen", customType: "equipment",
                name: template.name, model: "", quantity: 1, unit: "組",
                priceSource: "去識別化廚房概念；型號、櫃體／設備與施工價格待報",
            }, id);
        return {
            ...item, name: template.name, kind: "furniture", furnitureType: type,
            markerStyle: null, equipmentCategory: null,
            widthCm: template.widthCm, depthCm: template.depthCm,
            placement: { x: x / 289, y: y / 165 }, orientation: 0,
            note: [
                "概念配置：主排 60／76／80cm；其餘尺寸均為暫估圖例，不是實機／開孔尺寸。",
                product?.note ?? "",
                key === "cooktop-base" || key === "ih" || key === "gas"
                    ? "同一個 80cm 共用檯面內放兩個獨立爐：1 IH＋1 瓦斯；兩者型號、價格留白待相容單口／混合方案報價。G2522 雙瓦斯不適用，不計 NT$8,360。" : "",
                key === "prep" ? "此筆為檯面／櫃體，Bosch 洗碗機另列；不可重複計含機報價。" : "",
                key === "dishwasher" ? "在備餐檯下方；60×54cm 僅暫估，非已選 Bosch 型號。供排水、開門淨距、電壓／供電待核。" : "",
                key === "return" ? "右端向下轉折的短邊訂製櫃；寬 40、長 75cm 僅暫位，價格留白待報。" : "",
                key === "hot-water" ? "標記為水槽櫃內下層示意，非在檯面或走道上；圖上 20×14cm 不是機身尺寸。" : "",
                KITCHEN_SAFETY,
            ].filter(Boolean).join(" "),
        };
    });
    items.push(customEquipment({
        roomId: "kitchen", customType: "equipment", name: "水槽下嵌工資",
        model: "", quantity: 1, unit: "式", unitPrice: 1500,
        priceSource: KITCHEN_QUOTE_SOURCE,
        note: "獨立廚具報價的下嵌加工／工資，非可複製設備、不放置圖示；不宣稱涵蓋其他接管安裝。",
    }, "kitchen-plan-undermount-labor"));
    return { items, products };
}

export function migrateKitchenPlan(state) {
    if (state?.version !== 5 || !Array.isArray(state.items) ||
        !Array.isArray(state.products) || !state.rooms?.some((room) => room.id === "kitchen")) {
        throw new TypeError("廚房追加需要含廚房的最新 v5 存檔，請先驗證並備份。");
    }
    const itemIds = new Set(state.items.map((item) => item.id));
    const productIds = new Set(state.products.map((product) => product.id));
    const foundItems = KITCHEN_ITEM_IDS.filter((id) => itemIds.has(id));
    const foundProducts = KITCHEN_PRODUCT_IDS.filter((id) => productIds.has(id));
    if (foundItems.length || foundProducts.length) {
        if (foundItems.length !== KITCHEN_ITEM_IDS.length ||
            foundProducts.length !== KITCHEN_PRODUCT_IDS.length) {
            throw new Error("廚房追加 ID 已部分存在（或曾刪除）；停止套用，請人工核對，不自動補回或覆寫。");
        }
        return { state: structuredClone(state), addedItems: 0, addedProducts: 0 };
    }
    const models = new Set(productSpecs.map(([, , model]) =>
        model.toLowerCase().replace(/[\s-]/g, "")));
    if ([...state.products, ...state.items.filter((item) => item.roomId === "kitchen")]
        .some((entry) => models.has((entry.brandModel ?? "").toLowerCase().replace(/[\s-]/g, "")))) {
        throw new Error("最新資料已有相同廚具型號但不同 ID；請人工核對避免重複計價，不自動覆寫。");
    }
    const additions = kitchenAdditions();
    return {
        state: { ...structuredClone(state),
            items: [...structuredClone(state.items), ...additions.items],
            products: [...structuredClone(state.products), ...additions.products] },
        addedItems: additions.items.length, addedProducts: additions.products.length,
    };
}

export function renderKitchenReference() {
    return `<details class="kitchen-reference">
        <summary>廚房概念參考｜60／76／80cm＋右端高櫃與短邊</summary>
        <p>${KITCHEN_SAFETY}</p>
        <svg viewBox="0 0 390 220" role="img"
            aria-label="自繪概念參考，非施工圖：備餐60、水槽76、同一80爐檯內IH與瓦斯，右端高櫃及L型短邊">
            <g transform="translate(22 70) skewY(-10)">
                <path class="kitchen-reference-front" d="M0 35 H216 V95 H0 Z M216 35 H256 V155 H216 Z"/>
                <path class="kitchen-reference-top" d="M0 35 L25 10 H241 L216 35 Z M216 95 H256 L281 70 V130 L256 155 H216 Z"/>
                <path class="kitchen-reference-front" d="M216 35 V-10 H256 V95 H216 Z"/>
                <path class="kitchen-ring" d="M60 35 V95 M136 35 V95 M5 50 H55 V90 H5 Z"/>
                <ellipse class="kitchen-water" cx="103" cy="24" rx="26" ry="9"/>
                <circle class="kitchen-ring" cx="159" cy="24" r="8"/>
                <circle class="kitchen-ring" cx="195" cy="24" r="8"/>
                <path class="kitchen-ring" d="M187 24 H203 M195 16 V32"/>
                <path class="kitchen-overhead" d="M142 0 H222 V-7 H142 Z"/>
                <path class="kitchen-unconfirmed-flue" d="M183 -7 V-25"/>
                <text x="30" y="46">60</text><text x="98" y="46">76</text>
                <text x="176" y="46">共用 80</text>
                <text x="27" y="75">Bosch</text><text x="99" y="78">3M 櫃下</text>
                <text x="157" y="12">IH</text><text x="198" y="12">瓦斯</text>
                <text x="237" y="40">高櫃</text><text x="236" y="122">短邊</text>
            </g>
        </svg>
        <p>自繪固定參考，不隨移位同步；可編輯物件在上方房間圖。主排名義寬 60／76／80cm；
            檯深 60、高櫃寬 40、短邊 40×75cm 及其他設備尺寸只是暫估。
            檯下洗碗機、櫃下 3M 與上方排油煙機使用分層投影，不代表互相占用同一高度。
            虛線煙管只是假設，沒有指定穿窗或穿牆施工。兩爐必須同在一個 80cm 平台，
            不是兩個爐櫃；型號／價格均待報，G2522 雙瓦斯不納入。
            原報價外已知追加為 15,600＋35,900＝51,500 元，其餘留白，非全廚總價。</p>
    </details>`;
}
