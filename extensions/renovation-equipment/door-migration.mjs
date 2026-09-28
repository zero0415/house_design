import { isDeepStrictEqual } from "node:util";
import { validateState, summarize } from "./state.mjs";
import { DOOR_OPTIONS } from "./assets/door-options.js";
import {
    DOOR_TRACK_CAUTION, isAllocatedDoorItem,
} from "./assets/door-allocation.js";

const OLD_TRACK_NOTE =
    "原報價「滑門軌道－主浴.工作室」合計 1.6 米 × 1,800 元＝2,880 元；" +
    " 依屋主指示暫分這道拉門 0.8 米、1,440 元。軌道長度為暫估，" +
    " 未含於此筆的門片本體仍須另議；取消或轉用已含軌道門片的減項須廠商確認。";
const OLD_DOOR_NOTE =
    "已含在原報價；切換材質後的價差僅供規劃，實際價格須廠商確認。";
const OLD_HALL_NOTE = OLD_DOOR_NOTE +
    " 新配置確認通客餐廳為拉門；目前單價仍沿用原塑鋼廁所門報價基準，" +
    "拉門滑軌與施工價差須請廠商重報，未自動計入追加。";

export function assertReviewedPublicState(state) {
    const normalized = validateState(state);
    const expected = structuredClone(state);
    for (const [actual, reviewed] of [
        [normalized.products, expected.products],
        [normalized.undo?.products, expected.undo?.products],
    ]) {
        const product = reviewed?.find((entry) => entry.id === "sample-product-08");
        const normalizedProduct = actual?.find((entry) =>
            entry.id === "sample-product-08");
        if (product && !Object.hasOwn(product, "trackLengthCm") &&
            normalizedProduct?.trackLengthCm === 150) {
            product.trackLengthCm = 150;
        }
    }
    if (!isDeepStrictEqual(normalized, expected)) {
        throw new TypeError(
            "遷移須使用完整且已核對的公開 v5 資料，不能重設其他屋主欄位。"
        );
    }
}

export function migrateDoorAllocation(latest) {
    if (latest?.version !== 5) {
        throw new TypeError("門片歸屬須使用最新的公開 v5 資料。");
    }
    assertReviewedPublicState(latest);
    if (latest.items.some(isAllocatedDoorItem)) {
        return {
            state: structuredClone(latest), changed: false,
            changedItemIds: [], addedItems: 0, deltaTWD: 0,
        };
    }
    const next = structuredClone(latest);
    const one = (id, fields) => {
        const matches = next.items.filter((item) => item.id === id);
        const target = matches[0];
        if (matches.length !== 1 || Object.entries(fields).some(([key, value]) =>
            !isDeepStrictEqual(target[key], value))) {
            throw new Error(
                `門片歸屬衝突：${id}與已審閱匿名配置不同；保留修改，請重新核對。`
            );
        }
        return target;
    };
    const door = (id, roomId, material, opening, price, quoted = price) =>
        one(`door-${id}`, {
            kind: "door", doorId: id, roomId, doorMaterial: material,
            doorOpeningKind: opening, unitPrice: price,
            quotedUnitPrice: quoted, quotedQuantity: 1,
            quantity: 1, priceCurrency: "TWD",
            productId: null, trackLengthM: null,
            brandModel: DOOR_OPTIONS[material].label,
        });
    if (next.items.some((item) =>
        item.id === "door-bedroom-3-studio" ||
        item.doorId === "bedroom-3-studio")) {
        throw new Error("工作室滑門 ID 已占用；不新增重複門片。");
    }

    const balcony = door("balcony", "studio", "wood-slide", "slide", 19000);
    const bedroom2 = door("bedroom-2", "bedroom-2", "wood-slide", "slide", 19000);
    const mainMaster = door(
        "main-bath-master", "bath-main", "wood-fiber", "swing", 10500, 14000
    );
    const mainHall = door(
        "main-bath-hall", "bath-main", "bathroom", "slide", 8500
    );
    const tracks = [
        one("track-main-bath-hall", {
            kind: "equipment", roomId: "bath-main",
            trackDoorId: "main-bath-hall", name: "滑門軌道－主浴門",
            productId: null, quantity: .8, unitPrice: 1800,
            quotedQuantity: .8, quotedUnitPrice: 1800,
        }),
        one("track-bedroom-3-studio", {
            kind: "equipment", roomId: "studio",
            trackDoorId: "bedroom-3-studio",
            name: "滑門軌道－臥室3／工作室拉門",
            productId: null, quantity: .8, unitPrice: 1800,
            quotedQuantity: .8, quotedUnitPrice: 1800,
        }),
    ];
    if (balcony.note !== OLD_DOOR_NOTE || mainHall.note !== OLD_HALL_NOTE ||
        balcony.priceSource !== "原報價｜門片工程" ||
        mainMaster.priceSource !== "原報價門片單價（跨材質試算，待廠商確認）" ||
        tracks.some((item) => item.priceSource !== "原報價｜輕隔間工程") ||
        tracks.some((item) =>
            item.note.replace(/\s+/g, " ").trim() !== OLD_TRACK_NOTE)) {
        throw new Error("門片／軌道備註已另行修改；拒絕覆蓋，請重新審閱。");
    }
    const studioDoor = {
        ...structuredClone(balcony), id: "door-bedroom-3-studio",
        doorId: "bedroom-3-studio", name: "臥室3－工作室木纖滑門",
        doorQuoteAllocation: 1,
        widthCm: null, depthCm: null, heightCm: null,
        priceSource: "原報價｜工作室木纖滑門19,000元額度由陽台改歸此門位，非新增",
        note: "屋主指定木纖滑門；門洞淨寬／淨高、開向與實際交付材料待現勘。" +
            DOOR_TRACK_CAUTION,
    };
    Object.assign(balcony, {
        doorQuoteAllocation: 1, doorMaterial: "custom",
        brandModel: "滑門（材質待核，未計算）",
        unitPrice: null, quotedUnitPrice: 0,
        priceSource: "屋主釐清｜陽台門未計算；原工作室木纖滑門額度已移轉",
        note: "未計算，非免費；仍是概念拉門，原誤配19,000元額度已歸" +
            "臥室3↔工作室。門體、軌道與施工待報；門洞與逃生淨空待現勘，" +
            "不表示陽台設備可通行或安裝。",
    });
    Object.assign(mainMaster, {
        doorMaterial: "solid-wood", brandModel: DOOR_OPTIONS["solid-wood"].label,
        unitPrice: 14000,
        priceSource: "原報價｜主浴實木門恢復原14,000元額度（品牌省略）",
        note: mainMaster.note +
            " 屋主改回原報實木門，撤回木纖門的暫估減項；實際交付仍待廠商確認。",
    });
    Object.assign(mainHall, {
        doorOpeningKind: "swing",
        note: "屋主改為塑鋼廁所平開門，暫沿原報8,500元；" +
            "開向、門洞及通行淨空待現勘。原圖拉門為歷史方案，" +
            "不代表目前施工門型；此門不選用原軌道。",
    });
    bedroom2.note += " " + DOOR_TRACK_CAUTION;
    Object.assign(tracks[0], {
        roomId: "bedroom-2", trackDoorId: "bedroom-2",
        name: "滑門軌道－臥室2（原主浴額度暫移）",
    });
    for (const track of tracks) {
        Object.assign(track, {
            doorQuoteAllocation: 1,
            priceSource: "原報價｜輕隔間工程，屋主暫定歸屬調整，非追加",
            note: DOOR_TRACK_CAUTION,
        });
    }
    next.items.push(studioDoor);
    next.undo = structuredClone({
        rooms: latest.rooms, items: latest.items, products: latest.products,
    });
    assertReviewedPublicState(next);
    return {
        state: next, changed: true,
        changedItemIds: [
            balcony.id, bedroom2.id, mainMaster.id, mainHall.id,
            ...tracks.map((item) => item.id), studioDoor.id,
        ],
        addedItems: 1, addedProducts: 0,
        deltaTWD: summarize(next).overallTotals.TWD -
            summarize(latest).overallTotals.TWD,
    };
}
