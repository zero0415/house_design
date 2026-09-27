import { customEquipment } from "./equipment-catalog.js";
import { FURNITURE_TEMPLATES } from "./furniture.js";
import { equipmentFromProduct, productFromDraft } from "./product-database.js";
import {
    KITCHEN_V_LAYOUT_TAG, KITCHEN_V_FILL_NOTE, kitchenFillPattern,
} from "./kitchen-icons.js";

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

const V_PLACEMENTS = Object.freeze({
    tower: Object.freeze({ x: .826, y: .675 }),
    return: Object.freeze({ x: .824, y: .262 }),
});
const V_CUSTOM_NOTE = `${KITCHEN_V_LAYOUT_TAG} V配置：主排備餐60 → 水槽76 → IH＋瓦斯共用80 → 轉角；` +
    "短翼從內角接連續訂製備餐平台，電器高櫃在短翼最末端，不在主排右端。" +
    "訂製平台、高櫃與收邊依現場淨空設計，實際寬深與接縫須丈量；" +
    "保留舊矩形圖例占地（高櫃40×60、平台40×75cm）只為可編輯示意，非訂製尺寸。" +
    "平台兼示內轉角，未新增角櫃；圖例留白／重疊不是施工淨距。" +
    "開放轉角上方連續檯面、下方不預設實心角櫃；接縫與支撐待木工核。" +
    KITCHEN_V_FILL_NOTE +
    "依兩櫃目前中心與暫估輪廓畫斜線延展，不將補白換算商品尺寸。" +
    "不套用參考頁固定短牆長度或由289×165cm外接估值推算可用淨空。" +
    "兩櫃未報價，電器散熱、窗門、管線、封板與檯面連接須現勘。";

const layout = [
    ["prep", "kitchen-prep", 32, 32],
    ["sink-base", "kitchen-sink-base", 100, 32],
    ["cooktop-base", "kitchen-cooktop-base", 178, 32],
    ["tower", "kitchen-tower", V_PLACEMENTS.tower.x * 289, V_PLACEMENTS.tower.y * 165],
    ["return", "kitchen-return", V_PLACEMENTS.return.x * 289, V_PLACEMENTS.return.y * 165],
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
            placement: V_PLACEMENTS[key]
                ? { ...V_PLACEMENTS[key] } : { x: x / 289, y: y / 165 }, orientation: 0,
            note: [
                "概念配置：主排 60／76／80cm；其餘尺寸均為暫估圖例，不是實機／開孔尺寸。",
                product?.note ?? "",
                key === "cooktop-base" || key === "ih" || key === "gas"
                    ? "同一個 80cm 共用檯面內放兩個獨立爐：1 IH＋1 瓦斯；兩者型號、價格留白待相容單口／混合方案報價。G2522 雙瓦斯不適用，不計 NT$8,360。" : "",
                key === "prep" ? "此筆為檯面／櫃體，Bosch 洗碗機另列；不可重複計含機報價。" : "",
                key === "dishwasher" ? "在備餐檯下方；60×54cm 僅暫估，非已選 Bosch 型號。供排水、開門淨距、電壓／供電待核。" : "",
                V_PLACEMENTS[key] ? V_CUSTOM_NOTE : "",
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

// Existing anonymous IDs stay put; only the historical two-cabinet pair is migrated.
export function migrateKitchenVLayout(state) {
    if (state?.version !== 5 || !Array.isArray(state.items) ||
        !Array.isArray(state.products) || !Array.isArray(state.rooms) ||
        state.rooms.filter((room) => room.id === "kitchen").length !== 1) {
        throw new TypeError("V廚房配置需要完整已驗證的 v5 存檔。");
    }
    const keys = ["tower", "return"];
    const pair = keys.map((key) => {
        const found = state.items.filter((item) => item.id === `kitchen-plan-${key}`);
        if (found.length !== 1 || found[0].roomId !== "kitchen" ||
            found[0].kind !== "furniture" || found[0].furnitureType !== `kitchen-${key}`) {
            throw new Error("V廚房 ID 缺漏、重複或類型衝突；不新增或覆蓋既有物件。");
        }
        return found[0];
    });
    const tagged = pair.filter((item) =>
        item.note?.includes(KITCHEN_V_LAYOUT_TAG)).length;
    if (tagged === 2) {
        return { state: structuredClone(state), changed: false, changedItemIds: [],
            addedItems: 0, addedProducts: 0 };
    }
    if (tagged) throw new Error("V廚房只套用一部分，停止覆寫，請人工核對。");
    if (pair.some((item) => item.note?.includes("[kitchen-v-layout:1]"))) {
        throw new Error("舊V審閱版不可覆蓋；請重新讀取原存檔。");
    }
    const samePosition = (a, b) => a && a.x === b.x && a.y === b.y;
    const legacy = pair.every((item, index) => samePosition(item.placement, {
        x: 238 / 289, y: (index === 0 ? 32 : 99.5) / 165,
    }));
    if (pair.some((item, index) =>
        !item.placement || ![item.placement.x, item.placement.y].every((value) =>
            Number.isFinite(value) && value >= 0 && value <= 1) ||
        item.orientation !== 0 || item.widthCm !== 40 ||
        item.depthCm !== (index === 0 ? 60 : 75) ||
        item.unitPrice !== null || item.productId !== null || item.quantity !== 1)) {
        throw new Error("V廚房位置、尺寸、方向或報價有衝突；保留現有修改供人工審閱。");
    }
    const next = structuredClone(state);
    for (const [index, key] of keys.entries()) {
        const item = next.items.find((entry) => entry.id === pair[index].id);
        item.name = FURNITURE_TEMPLATES[`kitchen-${key}`].name;
        if (legacy) item.placement = { ...V_PLACEMENTS[key] };
        item.note = `${item.note.replace(
            "右端向下轉折的短邊訂製櫃；寬 40、長 75cm 僅暫位，價格留白待報。", "").trim()} ${V_CUSTOM_NOTE}`;
    }
    next.undo = structuredClone({
        rooms: state.rooms, items: state.items, products: state.products,
    });
    return { state: next, changed: true, changedItemIds: pair.map((item) => item.id),
        placementMode: legacy ? "legacy-to-short-wing" : "preserved-owner-placements",
        addedItems: 0, addedProducts: 0 };
}

// Projection heights only separate visual layers; they are not cabinet specifications.
function kitchenIsoPoint(x, y, z) {
    return `${(80 + x * 1.6 + y * .8).toFixed(1)},${(330 - x * .55 + y * .55 - z).toFixed(1)}`;
}

function kitchenIsoFace(points, className) {
    return `<polygon class="${className}"
        points="${points.map((point) => kitchenIsoPoint(...point)).join(" ")}"/>`;
}

function kitchenIsoCabinet(x, y, width, depth, height, bay, top = true) {
    return `<g data-kitchen-bay="${bay}">
        ${kitchenIsoFace([[x, y + depth, 0], [x + width, y + depth, 0],
            [x + width, y + depth, height], [x, y + depth, height]], "kitchen-reference-front")}
        ${kitchenIsoFace([[x, y, 0], [x, y + depth, 0],
            [x, y + depth, height], [x, y, height]], "kitchen-reference-side")}
        ${top ? kitchenIsoFace([[x, y, height], [x + width, y, height],
            [x + width, y + depth, height], [x, y + depth, height]], "kitchen-reference-top") : ""}
    </g>`;
}

function kitchenIsometric() {
    return `<svg viewBox="0 0 800 510" role="img" data-kitchen-view="isometric"
        aria-labelledby="kitchen-iso-title">
        <title id="kitchen-iso-title">V立體概念：主排備餐60、水槽76、共用爐80接開放轉角，短翼連續備餐平台後為末端高櫃</title>
        <defs>${kitchenFillPattern("kitchen-iso-fill", false)}</defs>
        <text class="view-heading" x="400" y="28">V立體圖｜約45°斜視，訂製短翼不標定施工尺寸</text>
        ${kitchenIsoCabinet(136, 0, 80, 60, 86, "hob", false)}
        ${kitchenIsoCabinet(60, 0, 76, 60, 86, "sink", false)}
        ${kitchenIsoCabinet(0, 0, 60, 60, 86, "prep", false)}
        ${kitchenIsoCabinet(216, 60, 40, 42, 86, "short-return", false)}
        <g data-kitchen-countertop="continuous-open-corner">
            <title>單片 L 形檯面跨越開放內轉角；下方無新增角櫃，接縫與支撐待木工核</title>
            ${kitchenIsoFace([[0, 60, 86], [216, 60, 86],
                [216, 60, 90], [0, 60, 90]], "kitchen-reference-side")}
            ${kitchenIsoFace([[216, 60, 86], [216, 102, 86],
                [216, 102, 90], [216, 60, 90]], "kitchen-reference-side")}
            <polygon class="kitchen-reference-top" data-countertop-outline="single-L"
                points="${[[0, 0, 90], [256, 0, 90], [256, 102, 90],
                    [216, 102, 90], [216, 60, 90], [0, 60, 90]]
                    .map((point) => kitchenIsoPoint(...point)).join(" ")}"/>
        </g>
        <g data-kitchen-fill="adjustable" fill="url(#kitchen-iso-fill)">
            <title>${KITCHEN_V_FILL_NOTE}</title>
            ${kitchenIsoFace([[216, 0, 90], [256, 0, 90],
                [256, 102, 90], [216, 102, 90]], "kitchen-adjustable-fill")}
        </g>
        <path class="kitchen-dimension kitchen-concept-seam"
            data-corner-join="provisional"
            d="M${kitchenIsoPoint(216, 0, 90)} L${kitchenIsoPoint(216, 60, 90)}"/>
        ${kitchenIsoCabinet(216, 102, 40, 60, 180, "tower-short-end")}
        <g data-kitchen-object="dishwasher" data-bay="prep" data-layer="under">
            ${kitchenIsoFace([[3, 61, 5], [57, 61, 5], [57, 61, 80], [3, 61, 80]], "kitchen-appliance")}
            <text x="177" y="307">Bosch</text>
        </g>
        <g data-kitchen-object="sink" data-bay="sink">
            ${kitchenIsoFace([[70, 15, 91], [126, 15, 91], [126, 47, 91], [70, 47, 91]], "kitchen-water")}
        </g>
        <g data-kitchen-object="faucet" data-bay="sink">
            <path class="kitchen-ring" d="M${kitchenIsoPoint(98, 8, 91)} L${kitchenIsoPoint(98, 8, 116)}
                L${kitchenIsoPoint(98, 25, 116)} L${kitchenIsoPoint(98, 25, 108)}"/>
        </g>
        <g data-kitchen-object="hot-water" data-bay="sink" data-layer="under">
            ${kitchenIsoFace([[78, 61, 12], [113, 61, 12], [113, 61, 56], [78, 61, 56]], "kitchen-water")}
            <text x="282" y="277">3M</text>
        </g>
        <g data-kitchen-object="ih" data-bay="hob">
            ${kitchenIsoFace([[143, 18, 92], [171, 18, 92], [171, 46, 92], [143, 46, 92]], "kitchen-ih-surface")}
            <text x="355" y="164">IH</text>
        </g>
        <g data-kitchen-object="gas" data-bay="hob">
            ${kitchenIsoFace([[181, 18, 92], [209, 18, 92], [209, 46, 92], [181, 46, 92]], "kitchen-gas-surface")}
            <text x="418" y="143">瓦斯</text>
        </g>
        <g data-kitchen-object="hood" data-bay="hob" data-layer="above">
            ${kitchenIsoFace([[136, 0, 153], [216, 0, 153], [216, 32, 153], [136, 32, 153]], "kitchen-overhead")}
            <text x="358" y="75">Sakura 80｜僅在爐上</text>
            <path class="kitchen-unconfirmed-flue" d="M${kitchenIsoPoint(177, 8, 154)} v-45"/>
            <text x="278" y="53">排煙路徑未核</text>
        </g>
        <path class="kitchen-dimension" d="M620 214 H646"/>
        <text x="705" y="207">訂製電器高櫃</text><text x="705" y="230">短翼最末端</text>
        <path class="kitchen-dimension" d="M492 282 L525 356"/>
        <text x="553" y="378">內角 → 連續備餐平台 → 高櫃</text>
        <text x="553" y="402">斜線伸縮填滿；寬深／收邊待丈量</text>
        <text x="553" y="430">轉角下方留空；接縫與支撐待木工核</text>
        <text x="144" y="378">備餐60／機在檯下</text>
        <text x="285" y="353">水槽76／3M在櫃下</text>
        <text x="378" y="301">共用80：IH＋瓦斯</text>
        <text x="400" y="465">斜線接檯為填滿意向，非新增櫃體；櫃高、檯高、門窗及接縫須現勘</text>
        <text x="400" y="491">主排末端不是高櫃；兩個訂製櫃的矩形占地只是圖例，不是製作尺寸</text>
    </svg>`;
}

function kitchenElevations() {
    return `<svg viewBox="0 0 860 415" role="img" data-kitchen-view="elevations"
        aria-labelledby="kitchen-elevations-title">
        <title id="kitchen-elevations-title">V正立面：長牆備餐60、水槽76、共用爐80接開放轉角；短牆內角接連續訂製平台再到最右端高櫃，尺寸待丈量</title>
        <defs>${kitchenFillPattern("kitchen-elevation-fill")}</defs>
        <text class="view-heading" x="308" y="28">長牆正立面｜60＋76＋80＋轉角待定</text>
        <text class="view-heading" x="719" y="28">短牆正立面</text>
        <g data-kitchen-fill="adjustable" fill="url(#kitchen-elevation-fill)">
            <title>${KITCHEN_V_FILL_NOTE}</title>
            <rect class="kitchen-adjustable-fill" x="492" y="166" width="80" height="8"/>
            <rect class="kitchen-adjustable-fill" x="614" y="166" width="210" height="164"/>
        </g>
        <g data-kitchen-bay="prep"><rect class="kitchen-reference-front" x="60" y="170" width="120" height="160"/></g>
        <g data-kitchen-bay="sink"><rect class="kitchen-reference-front" x="180" y="170" width="152" height="160"/></g>
        <g data-kitchen-bay="hob"><rect class="kitchen-reference-front" x="332" y="170" width="160" height="160"/></g>
        <g data-kitchen-bay="tower-short-end">
            <rect class="kitchen-reference-front" x="744" y="60" width="80" height="270"/>
            <path class="kitchen-ring" d="M744 150 H824 M744 240 H824"/>
            <text x="784" y="120">訂製高櫃</text><text x="784" y="142">短翼末端</text>
        </g>
        <path class="kitchen-reference-top" d="M60 166 H492 V174 H60 Z"/>
        <g data-kitchen-object="dishwasher" data-bay="prep" data-layer="under">
            <rect class="kitchen-appliance" x="66" y="184" width="108" height="140" rx="3"/>
            <path class="kitchen-ring" d="M66 205 H174"/>
            <text x="120" y="249">Bosch</text><text x="120" y="272">備餐檯下</text>
        </g>
        <g data-kitchen-object="sink" data-bay="sink">
            <path class="kitchen-water" d="M195 172 H316 L301 205 H210 Z"/>
        </g>
        <g data-kitchen-object="faucet" data-bay="sink">
            <path class="kitchen-ring" d="M255 165 V137 Q255 120 274 129 V139"/>
        </g>
        <g data-kitchen-object="hot-water" data-bay="sink" data-layer="under">
            <rect class="kitchen-water" x="219" y="230" width="74" height="82" rx="5"/>
            <text x="256" y="258">3M</text><text x="256" y="281">IH1000</text><text x="256" y="303">櫃下示意</text>
        </g>
        <g data-kitchen-object="ih" data-bay="hob"><rect class="kitchen-ih-surface" x="345" y="158" width="56" height="10"/><text x="373" y="150">IH</text></g>
        <g data-kitchen-object="gas" data-bay="hob"><path class="kitchen-gas-surface" d="M420 167 V158 H475 V167 Z"/><text x="447" y="150">瓦斯</text></g>
        <g data-kitchen-object="hood" data-bay="hob" data-layer="above">
            <rect class="kitchen-overhead" x="332" y="80" width="160" height="28"/>
            <text x="412" y="99">Sakura 80</text>
            <path class="kitchen-unconfirmed-flue" d="M412 80 V48"/>
        </g>
        <text x="412" y="250">同一個80cm爐櫃</text><text x="412" y="277">洗碗機不在此下方</text>
        <g data-kitchen-bay="short-return">
            <text x="532" y="225">轉角伸縮</text><text x="532" y="250">斜線接檯</text>
            <rect class="kitchen-reference-front" x="614" y="170" width="130" height="160"/>
            <rect class="kitchen-reference-top" x="614" y="166" width="130" height="8"/>
            <text x="679" y="230">連續訂製</text><text x="679" y="255">備餐平台</text>
            <text x="671" y="115">內角 → 平台 →</text>
        </g>
        <path class="kitchen-dimension" d="M60 347 H572 M60 339 V355 M180 339 V355 M332 339 V355 M492 339 V355 M572 339 V355 M614 347 H824 M614 339 V355 M824 339 V355"/>
        <text x="120" y="375">60</text><text x="256" y="375">76</text>
        <text x="412" y="375">80</text><text x="532" y="375">待丈量</text>
        <text x="719" y="375">平台／高櫃／封板皆待丈量</text>
        <text x="430" y="403">單位cm，皆名義尺寸；未指定檯高、櫃高、爐罩距離或管線施工高度</text>
    </svg>`;
}

function kitchenTopView() {
    return `<svg viewBox="0 0 760 500" role="img" data-kitchen-view="top"
        aria-labelledby="kitchen-top-title">
        <title id="kitchen-top-title">V俯視概念：主排60、76、共用80接開放轉角，短翼內角平台之後是末端高櫃；洗碗機與3M在櫃下</title>
        <defs>${kitchenFillPattern("kitchen-top-fill")}</defs>
        <text class="view-heading" x="380" y="27">V俯視圖｜主排轉角 → 短翼平台 → 末端高櫃</text>
        <g data-kitchen-fill="adjustable" fill="url(#kitchen-top-fill)">
            <title>${KITCHEN_V_FILL_NOTE}</title>
            <rect class="kitchen-adjustable-fill" x="512" y="85" width="80" height="324"/>
        </g>
        <g data-kitchen-bay="prep"><rect class="kitchen-reference-top" x="80" y="85" width="120" height="120"/></g>
        <g data-kitchen-bay="sink"><rect class="kitchen-reference-top" x="200" y="85" width="152" height="120"/></g>
        <g data-kitchen-bay="hob"><rect class="kitchen-reference-top" x="352" y="85" width="160" height="120"/></g>
        <g data-kitchen-bay="tower-short-end">
            <rect class="kitchen-reference-front" x="512" y="289" width="80" height="120"/>
            <text x="552" y="340">訂製高櫃</text><text x="552" y="367">短翼末端</text>
        </g>
        <g data-kitchen-bay="short-return">
            <rect class="kitchen-reference-top" x="512" y="135" width="80" height="150"/>
            <text x="552" y="181">轉角接檯</text><text x="552" y="230">連續平台</text>
            <text x="552" y="260">訂製待量</text>
        </g>
        <text x="552" y="110">轉角伸縮</text>
        <g data-kitchen-object="dishwasher" data-bay="prep" data-layer="under">
            <rect class="kitchen-appliance kitchen-layer-under" x="86" y="95" width="108" height="103"/>
            <text x="140" y="132">備餐檯</text><text x="140" y="157">Bosch在下</text>
        </g>
        <g data-kitchen-object="sink" data-bay="sink"><rect class="kitchen-water" x="216" y="114" width="121" height="60" rx="10"/><text x="276" y="148">JT-690</text></g>
        <g data-kitchen-object="faucet" data-bay="sink"><path class="kitchen-ring" d="M276 111 V98 H292 V111"/></g>
        <g data-kitchen-object="hot-water" data-bay="sink" data-layer="under">
            <rect class="kitchen-water kitchen-layer-under" x="231" y="178" width="90" height="23"/>
            <text x="276" y="195">3M在櫃下</text>
        </g>
        <g data-kitchen-object="ih" data-bay="hob"><rect class="kitchen-ih-surface" x="365" y="124" width="57" height="60" rx="5"/><circle class="kitchen-ring" cx="394" cy="153" r="20"/><text x="394" y="158">IH</text></g>
        <g data-kitchen-object="gas" data-bay="hob"><rect class="kitchen-gas-surface" x="441" y="124" width="57" height="60" rx="5"/><circle class="kitchen-ring" cx="470" cy="153" r="20"/><text x="470" y="158">瓦斯</text></g>
        <g data-kitchen-object="hood" data-bay="hob" data-layer="above"><rect class="kitchen-overhead kitchen-layer-above" x="352" y="85" width="160" height="28"/><text x="432" y="105">排油煙機在爐上方</text></g>
        <path class="kitchen-dimension" d="M80 61 H592 M80 54 V68 M200 54 V68 M352 54 V68 M512 54 V68 M592 54 V68 M619 85 V409 M612 85 H626 M612 409 H626"/>
        <text x="140" y="53">60</text><text x="276" y="53">76</text>
        <text x="432" y="53">共用80</text><text x="552" y="53">轉角待定</text>
        <text x="683" y="221">短翼淨長</text><text x="683" y="247">與收邊待量</text>
        <text x="240" y="246">水槽內槽60.5，不是開孔／櫃內淨寬</text>
        <text x="240" y="279">虛線＝櫃下；點線＝上方層</text>
        <text x="240" y="311">矩形僅圖例；平台兼示內轉角</text>
        <text x="240" y="343">斜線填滿意向，非實測／零淨距</text>
        <text x="380" y="449">289×165cm僅不規則外接估值；右牆窗位另依房間圖，不推算走道或可用短牆</text>
        <text x="380" y="481">訂製尺寸、櫃門、洗碗機開門、水電瓦斯及排煙，皆待現場確認</text>
    </svg>`;
}

export function renderKitchenReference() {
    return `<details class="kitchen-reference">
        <summary>廚房概念參考｜立體圖・長短牆正立面・俯視圖</summary>
        <p><strong>三圖是固定自繪概念，不隨拖曳、轉向或選款自動更新，非施工圖。</strong>
            正式房間圖與目前存檔才是位置／方向依據；本參考不改動設備、商品、價格或Undo。
            V動線為60／76／80cm主排接轉角，短翼由內角延伸連續訂製備餐平台，
            高櫃在<strong>短翼最末端</strong>，不在主排右端；平台、高櫃及封板須依現場淨空訂製，
            不套用其他參考頁的固定短牆長度。三圖是否與目前配置一致，以房間圖與存檔為準。</p>
        <p><strong>${KITCHEN_V_FILL_NOTE}</strong>房間圖的斜線隨兩櫃中心、
            舊可編輯矩形圖例與輪廓重畫；不改商品尺寸或價格，與固定三視圖不同。
            移到不相接方向會提示重新核對，而不跨房間強行填補。</p>
        <p class="kitchen-reference-legend">圖例：米色＝櫃體，斜線＝訂製伸縮預留，
            藍色＝水槽／櫃下飲水機，灰色＝家電／爐上煙罩，藍綠＝IH，
            淡橙＝瓦斯；虛線／點線區分櫃下與上方，同物件跨視圖不增加數量或價格。</p>
        <div class="kitchen-reference-views">
            <figure><figcaption>① 立體圖（約45°）</figcaption><div class="kitchen-projection-scroll" tabindex="0" role="region" aria-label="可水平捲動的立體圖">${kitchenIsometric()}</div></figure>
            <figure><figcaption>② 正立面／直立圖（長牆＋短牆）</figcaption><div class="kitchen-projection-scroll" tabindex="0" role="region" aria-label="可水平捲動的長短牆正立面">${kitchenElevations()}</div></figure>
            <figure><figcaption>③ 俯視圖</figcaption><div class="kitchen-projection-scroll" tabindex="0" role="region" aria-label="可水平捲動的俯視圖">${kitchenTopView()}</div></figure>
        </div>
        <p><strong>Bosch SMV4HAX00X：</strong>本體寬59.8×深55×高81.5cm；
            淨開口要求寬60–60.8、深55、高81.5–87.5cm，名義外寬60cm備餐櫃<strong>尚未證明有足夠內部淨寬</strong>，
            側板、踢腳、管線及開門範圍須核。洗碗機只在備餐檯下，不在IH＋瓦斯爐下。
            JT-690的60.5cm僅內槽寬，不是盆外框或開孔；3M IH1000與濾心位於水槽櫃下，機身及維修空間未核。</p>
        <p>IH與瓦斯是同一80cm爐櫃上的兩個獨立單元，型號／價格待報；
            排油煙機只在爐上方，虛線排煙路徑是假設，未指定穿窗或穿牆。
            開放內角上方僅示意連續檯面，下方不畫新增實心角櫃；
            虛線接縫與懸空支撐待木工核對，不指定45度施工接法。
            櫃高、檯高、爐罩間距及門片干涉待核。各視圖是同組設備，不另加本體或安裝費；價格以存檔為準，
            未報價不等於零元，不能以舊追加小計當作全廚總價。</p>
        <p>${KITCHEN_SAFETY}</p>
    </details>`;
}
