import { customEquipment } from "./equipment-catalog.js";
import {
    BALCONY_SINK, HOUSE_ZONE_BY_ID, PLAN_PIXELS_PER_CM, footprintFits,
} from "./house-geometry.js";
import {
    BALCONY_BASIN_WARNING, BALCONY_FLOOR_DRYER_WARNING, BALCONY_SINK_ID,
    BALCONY_SWAP_TAG,
} from "./laundry-notes.js";

const REVIEWED_PUBLIC = Object.freeze({
    washer: "Whirlpool 8TWTW5010PW 洗衣機本體參考 NT$21,150；機身寬 70.5×深 68.6cm，保留陽台原標位。圖上未含安裝與維修淨空；給排水、供電、門淨寬及實際施工另核。",
    dryer: "Whirlpool 8TWGD5050PW 瓦斯烘衣機本體 NT$20,599；機身寬73.7×深72.1×高102.9cm，原外推鐵窗暫位不移。約78cm毛深與機身深度只差約5.9cm，尚未扣框架、排氣或維修；供氣、排煙、防雨、承重振動、防火與合法許可全未核，須合格人員現勘，嚴禁據圖施工。",
    heater: "暫標在陽台右側牆面（烘衣機已移至外推鐵窗）；窄條僅表示牆面位置，與烘衣機可能在不同高度，非實際機身尺寸。熱水器型式、型號、尺寸、安裝高度、與烘衣機安全間距、電源或瓦斯、給排水及排氣須現場由合格廠商確認。原報價熱水器安裝單價2,500元／組但數量未填（本次0元）；本體及安裝費待報。",
    productName: "Whirlpool 8TWGD5050PW 瓦斯烘衣機（鐵窗暫位）",
    productNote: "機身寬73.7×深72.1×高102.9cm。外推鐵窗約78cm毛深僅剩約5.9cm，未扣框架、排氣、維修；瓦斯供應、排煙防雨、荷重振動、防火、固定防墜與合法許可全未核。條件式暫位，不得據圖施工。",
});

export function renderBalconyReference() {
    return `<figure class="balcony-reference">
        <figcaption><strong>陽台換位概念｜固定向量示意，不隨拖動更新；以目前存檔為準</strong></figcaption>
        <p class="balcony-safety-cue">非施工配置：烘衣機門口／固定燃氣與排氣未核；
            外推洗衣盆的獨立支撐、護欄與合法排水未核。</p>
        <div class="balcony-reference-scroll" tabindex="0"
            aria-label="橫向捲動查看陽台換位向量圖">
            <svg class="balcony-reference-svg" viewBox="0 0 720 302" role="img"
                data-balcony-reference="vector"
                aria-labelledby="balcony-reference-title balcony-reference-desc">
                <title id="balcony-reference-title">陽台洗烘與外推洗衣盆條件式換位</title>
                <desc id="balcony-reference-desc">左側原泥作水槽僅擬拆，瓦斯烘衣機暫放原混凝土樓板，
                    前門朝右側洗衣機；右側洗衣機原位不動。外推洗衣盆位於陽台部分外側，
                    需獨立可靠混凝土支撐。所有距離與拆除均待實測及核可。</desc>
                <rect class="balcony-reference-floor" x="32" y="53" width="656" height="111" rx="5"/>
                <rect class="balcony-reference-old-sink" x="44" y="64" width="153" height="88" rx="5"/>
                <rect class="balcony-reference-dryer" x="50" y="70" width="141" height="76" rx="5"/>
                <text x="120" y="116" text-anchor="middle">烘衣機</text>
                <path class="balcony-reference-direction" d="M158 131 H210 m-9 -8 9 8 -9 8"/>
                <text class="balcony-reference-annotation" x="135" y="187" text-anchor="middle">
                    原槽擬拆・未核價
                </text>
                <rect class="balcony-reference-washer" x="534" y="70" width="125" height="76" rx="5"/>
                <text x="596" y="116" text-anchor="middle">洗衣機</text>
                <text class="balcony-reference-annotation" x="596" y="187" text-anchor="middle">
                    右側原位
                </text>
                <path class="balcony-reference-slider" d="M202 42 H516"/>
                <text class="balcony-reference-annotation" x="359" y="31" text-anchor="middle">
                    工作室拉門／通行淨寬待核
                </text>
                <rect class="balcony-reference-platform" x="32" y="205" width="656"
                    height="75" rx="5"/>
                <rect class="balcony-reference-basin" x="312" y="215" width="160"
                    height="55" rx="7"/>
                <text x="392" y="250" text-anchor="middle">洗衣盆</text>
                <text class="balcony-reference-annotation" x="359" y="300" text-anchor="middle">
                    外推區不是承重依據・82×48cm 僅概念尺寸
                </text>
            </svg>
        </div>
        <details class="balcony-safety-details">
            <summary>施工安全與承重待核（展開）</summary>
            <p>此圖不隨目前拖動或選款改變，舊瀏覽器存檔不會被自動換位。
                紅框的現況泥作水槽尚未拆除；右側洗衣機、熱水器維持原標位。
                圖中的相對位置不證明拉門可通行或外推區能承重。</p>
            <p>${BALCONY_FLOOR_DRYER_WARNING}</p>
            <p>${BALCONY_BASIN_WARNING}</p>
        </details>
    </figure>`;
}

export function migrateBalconySwap(state) {
    if (state?.version !== 5 || !Array.isArray(state.items) ||
        !Array.isArray(state.products) || !Array.isArray(state.rooms)) {
        throw new TypeError("陽台換位需要完整已驗證的 v5 資料。");
    }
    const one = (id) => {
        const matches = state.items.filter((item) => item.id === id);
        if (matches.length !== 1) {
            throw new Error(`陽台物件 ${id} 缺漏或重複；不復活或覆蓋屋主修改。`);
        }
        return matches[0];
    };
    const dryer = one("balcony-dryer");
    const washer = one("balcony-washer");
    const heater = one("balcony-water-heater");
    const products = state.products.filter((entry) => entry.id === "sample-product-26");
    const product = products[0];
    const sinks = state.items.filter((item) => item.id === BALCONY_SINK_ID);
    const tagged = [dryer, washer, heater, product].filter((entry) =>
        entry?.note?.includes(BALCONY_SWAP_TAG)).length;
    if (tagged === 4 && sinks.length === 1 &&
        sinks[0].note?.includes(BALCONY_SWAP_TAG)) {
        return { state: structuredClone(state), changed: false, changedItemIds: [] };
    }
    if (tagged || sinks.length || products.length !== 1) {
        throw new Error("陽台換位部分套用或新水槽 ID 已占用；請重新審閱。");
    }
    const balcony = state.rooms.find((room) => room.id === "balcony");
    const platform = state.rooms.find((room) => room.id === "ac-platform");
    const at = (item, x, y) => item.placement?.x === x && item.placement?.y === y;
    if (dryer.roomId !== "ac-platform" || !at(dryer, .857, .5) ||
        dryer.orientation !== 180 || dryer.kind !== "furniture" ||
        dryer.furnitureType !== "dryer" || dryer.productId !== product.id ||
        dryer.brandModel !== "Whirlpool 8TWGD5050PW 瓦斯" ||
        dryer.widthCm !== 73.7 || dryer.depthCm !== 72.1 ||
        dryer.unitPrice !== 20599 || dryer.quantity !== 1 ||
        dryer.priceCurrency !== "TWD" || dryer.installationUnitPrice !== null ||
        dryer.note !== REVIEWED_PUBLIC.dryer ||
        washer.roomId !== "balcony" || !at(washer, .856, .503) ||
        washer.orientation !== 90 || washer.productId !== "sample-product-25" ||
        washer.widthCm !== 70.5 || washer.depthCm !== 68.6 ||
        washer.unitPrice !== 21150 || washer.note !== REVIEWED_PUBLIC.washer ||
        heater.roomId !== "balcony" || !at(heater, .979, .518) ||
        heater.orientation !== 270 || heater.note !== REVIEWED_PUBLIC.heater ||
        balcony?.widthCm !== 290 || balcony.depthCm !== 81 ||
        platform?.widthCm !== 590 || platform.depthCm !== 78 ||
        product.name !== REVIEWED_PUBLIC.productName ||
        product.note !== REVIEWED_PUBLIC.productNote ||
        product.unitPrice !== 20599 || product.widthCm !== 73.7 ||
        product.depthCm !== 72.1 || product.type !== "equipment" ||
        product.environment !== "any" ||
        state.items.some((item) => item.id !== dryer.id &&
            item.productId === product.id)) {
        throw new Error("陽台家電／房間與已審閱的匿名示例不同；保留修改，請重新核對。");
    }

    const next = structuredClone(state);
    const zone = HOUSE_ZONE_BY_ID.get("balcony");
    const outboard = HOUSE_ZONE_BY_ID.get("ac-platform");
    const center = {
        x: BALCONY_SINK.x + BALCONY_SINK.width / 2,
        y: BALCONY_SINK.y + BALCONY_SINK.height / 2,
    };
    const moved = next.items.find((item) => item.id === dryer.id);
    Object.assign(moved, {
        roomId: "balcony", orientation: 270,
        placement: {
            x: (center.x - zone.x) / zone.width,
            y: (center.y - zone.y) / zone.height,
        },
        note: `${BALCONY_SWAP_TAG} 前門朝右僅示意；${BALCONY_FLOOR_DRYER_WARNING}` +
            "本體價仍只計一次，拆除、新電路、固定燃氣管與專用排氣不預設已含。",
    });
    if (!footprintFits(zone, center.x, center.y,
        moved.depthCm * PLAN_PIXELS_PER_CM,
        moved.widthCm * PLAN_PIXELS_PER_CM, moved)) {
        throw new Error("烘衣機圖例不能放入舊水槽占地與樓板輪廓；不可縮小或自動移位。");
    }

    const sink = customEquipment({
        roomId: "ac-platform", customType: "equipment",
        name: "外推區掛牆洗衣盆（條件式）", unit: "座", quantity: 1,
        unitPrice: "", model: "",
        priceSource: "匿名換位概念；盆體、獨立支撐、合法改管與安裝均未報價",
        note: `${BALCONY_SWAP_TAG} 非已選商品；${BALCONY_BASIN_WARNING}`,
    }, BALCONY_SINK_ID);
    Object.assign(sink, {
        widthCm: 82, depthCm: 48, heightCm: null, orientation: 0,
        equipmentCategory: null, markerStyle: null, priceSource:
            "匿名換位概念；盆體、獨立支撐、合法改管與安裝均未報價",
        acPlanStatus: null, outdoorPlacement: null, outdoorZoneId: null,
        outdoorWidthCm: null, outdoorDepthCm: null, outdoorOrientation: null,
        equipmentType: null, doorId: null, doorMaterial: null, doorOpeningKind: null,
        trackDoorId: null, trackLengthM: null, partitionMaterial: null,
        switchType: null, switchEnvironment: null, switchPlanStatus: null,
        outletCircuit: null, circuitOutletId: null, lightType: null, lightSelection: null,
        lightWatts: null, lightLumens: null, beamAngleDeg: null, lightSpecSource: "",
        fixtureUnitPrice: null, trackLengthCm: null, trackSelection: null,
        spotlightQuantity: null, spotlightUnitPrice: null, spotlightModel: null,
        spotlightSelection: null, spotlightPriceSource: null,
        productId: null, unitPrice: null, installationUnitPrice: null,
        placement: {
            x: (zone.x + zone.width / 2 - outboard.x) / outboard.width,
            y: .5,
        },
    });
    next.items.push(sink);
    const relatedCaution = " 左側樓板瓦斯烘衣機的固定燃氣、" +
        "獨立室外排氣、拉門逃生與右牆熱水器間距待合格人員核定，非可施工配置。";
    next.items.find((item) => item.id === washer.id).note =
        `${REVIEWED_PUBLIC.washer} ${BALCONY_SWAP_TAG} 烘衣機擬置左側原泥作水槽區，` +
        "舊槽擬拆未核價；洗衣機的右側原標位與機身價格不變。" + relatedCaution;
    next.items.find((item) => item.id === heater.id).note =
        `${BALCONY_SWAP_TAG} 熱水器仍在陽台右側牆面，窄條不代表實機尺寸；` +
        "烘衣機擬置左側原泥作水槽樓板區，安裝高度與安全間距尚未確認。" +
        "型式、供能、給排水與排氣由合格廠商現勘；原報熱水器安裝單價" +
        "2,500元／組但數量未填（本次0元），本體與實際施工費待報。" + relatedCaution;
    const nextProduct = next.products.find((entry) => entry.id === product.id);
    nextProduct.name = "Whirlpool 8TWGD5050PW 瓦斯烘衣機（條件式）";
    nextProduct.note = `${BALCONY_SWAP_TAG} 機身寬73.7×深72.1×高102.9cm、56kg；` +
        "位置依目前存檔，並非商品的安裝認證。外推鐵窗或陽台樓板都不能僅憑圖判斷可安裝；" +
        "固定燃氣、獨立室外排氣、拉門逃生、防雨防火、承重與熱水器間距須現勘，" +
        "基本運送定位不含拆除、新管線、外推盆體或支撐工程。";
    next.undo = structuredClone({
        rooms: state.rooms, items: state.items, products: state.products,
    });
    return {
        state: next, changed: true, addedItems: 1, addedProducts: 0,
        changedItemIds: [dryer.id, washer.id, heater.id, sink.id],
        changedProductIds: [product.id], knownDeltaTWD: 0,
    };
}
