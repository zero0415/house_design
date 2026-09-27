export const GUEST_BATH_TARGET_TAG = "[guest-bath-80:1]";
export const GUEST_BATH_TARGET_IDS = Object.freeze([
    "bath-guest-tub", "bath-guest-vanity", "bath-main-vanity",
]);
export const GUEST_BATH_CAUTION =
    "客浴80cm浴缸水平區段與60×47cm壁掛浴櫃僅是規劃目標。" +
    "浴缸實機深度／高度、完成牆面、馬桶膝腿淨距、門扇、櫃底高度、" +
    "承重固定、防水及給排水未實測，非可施工配置；不能據圖訂製或推定零淨距。";

export function isUnknownDepthGuestTub(item) {
    return item?.id === "bath-guest-tub" && item.kind === "equipment" &&
        Number.isFinite(item.widthCm) && item.widthCm > 0 &&
        item.depthCm == null;
}

export function migrateGuestBathTarget(state) {
    if (state?.version !== 5 || !Array.isArray(state.items) ||
        !Array.isArray(state.products) || !Array.isArray(state.rooms)) {
        throw new TypeError("客浴改案需要完整已驗證的 v5 資料。");
    }
    const fixtures = GUEST_BATH_TARGET_IDS.map((id) => {
        const matches = state.items.filter((item) => item.id === id);
        if (matches.length !== 1 || matches[0].kind !== "equipment" ||
            matches[0].roomId !== (id === "bath-main-vanity"
                ? "bath-main" : "bath-guest")) {
            throw new Error("客浴／兩浴浴櫃 ID 缺漏、重複或類型衝突；不復活已刪物件。");
        }
        return matches[0];
    });
    const tagged = fixtures.filter((item) =>
        item.note?.includes(GUEST_BATH_TARGET_TAG)).length;
    if (tagged === fixtures.length) {
        return { state: structuredClone(state), changed: false, changedItemIds: [] };
    }
    if (tagged) throw new Error("客浴目標只套用部分項目；請重新核對。");
    const [tub, guest, main] = fixtures;
    const room = state.rooms.find((entry) => entry.id === "bath-guest");
    const toilet = state.items.find((entry) => entry.id === "bath-guest-toilet");
    const samePoint = (position, x, y) =>
        position?.x === x && position?.y === y;
    if (tub.productId !== "sample-product-03" || tub.brandModel !== "OVO BK106A" ||
        tub.unitPrice !== 26936 || tub.widthCm !== 110 || tub.depthCm !== 70 ||
        tub.heightCm !== null || tub.orientation !== 270 ||
        !samePoint(tub.placement, .202, .382) ||
        !samePoint(guest.placement, .474, .157) || room?.widthCm !== 205 ||
        !samePoint(toilet?.placement, .848, .258) || toilet.widthCm !== 45.2 ||
        toilet.depthCm !== 72.2 || toilet.orientation !== 0 ||
        fixtures.some((item) => item.quantity !== 1 ||
            item.installationUnitPrice !== 0 || item.priceCurrency !== "TWD") ||
        [guest, main].some((item) => item.productId !== null ||
            item.unitPrice !== null || item.widthCm !== 60 ||
            item.depthCm !== 35 || item.orientation !== null ||
            item.brandModel !== "TOTO（品牌暫填，型號待選）") ||
        state.items.some((item) =>
            item.id !== tub.id && item.productId === tub.productId) ||
        !state.products.some((product) =>
            product.id === tub.productId && product.unitPrice === 26936)) {
        throw new Error("浴缸、浴櫃、馬桶或房間不同於已審閱的公開示例；不覆蓋後續修改。");
    }

    const next = structuredClone(state);
    const nextTub = next.items.find((item) => item.id === tub.id);
    Object.assign(nextTub, {
        name: "坐式浴缸（80cm條件目標）",
        brandModel: "", productId: null, unitPrice: null,
        widthCm: 80, depthCm: null, heightCm: null, orientation: 0,
        priceSource: "去識別化示例的80cm坐式浴缸待選；型號與本體價未定，不沿用舊110cm OVO商品價。",
        note: `${GUEST_BATH_TARGET_TAG} 左側80cm僅水平概念區段，非商品實際占地；` +
            "虛線帶高度不代表浴缸深度。" + GUEST_BATH_CAUTION +
            "舊OVO BK106A保留為未選商品，未計入目前已知總額。" +
            "一般衛浴安裝另加NT$0仍引用原報兩套額度；" +
            "浴缸改管、防水與尺寸變更補差未報價，不等於所有施工免費。",
    });
    for (const original of [guest, main]) {
        const item = next.items.find((entry) => entry.id === original.id);
        item.widthCm = 60;
        item.depthCm = 47;
        item.note = `${GUEST_BATH_TARGET_TAG} 兩間壁掛浴櫃暫按寬60×深47cm，` +
            "型號與本體價未定；鏡櫃另選。" + GUEST_BATH_CAUTION +
            (item.id === guest.id
                ? "客浴圖面中心移至80cm浴缸水平區段右側相接處；" +
                    "原給排水未搬動，相接不代表有施工淨距。"
                : "主浴原標位不變，不因客浴方案就認定本房可安裝。") +
            "原報一般衛浴安裝額度保留，移管、牆體補強與防水另待報。";
    }
    const centerXCm = tub.placement.x * room.widthCm + 80 / 2 + 60 / 2;
    next.items.find((item) => item.id === guest.id).placement.x =
        centerXCm / room.widthCm;
    next.undo = structuredClone({
        rooms: state.rooms, items: state.items, products: state.products,
    });
    return {
        state: next, changed: true, changedItemIds: [...GUEST_BATH_TARGET_IDS],
        guestVanityCenterXCm: centerXCm, knownDeltaTWD: -26936,
    };
}
