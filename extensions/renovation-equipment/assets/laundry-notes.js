export const BALCONY_SWAP_TAG = "[balcony-swap:1]";
export const BALCONY_SINK_ID = "balcony-outboard-sink";
export const BALCONY_FLOOR_DRYER_WARNING =
    "陽台左側原混凝土樓板僅條件式暫位；現況泥作水槽擬拆，須核價與許可，尚未拆除。" +
    "Whirlpool 8TWGD5050PW 為瓦斯機，寬73.7×深72.1×高102.9cm、56kg；" +
    "約81cm僅為圖示毛深，未轉向深72.1cm已只餘不足9cm，" +
    "轉向後機寬73.7cm占短邊，尚未扣管線、排氣、維修與拉門淨距，可能阻擋逃生。" +
    "R33 原始插座標位靠舊水槽，可能與機身圖示重疊；不自動移位或視為烘衣機專線。" +
    "必須由合格人員確認固定燃氣路徑（不可用軟管跨門）、獨立室外排氣、" +
    "右牆熱水器安全間距、防雨、防水供電、漏電保護、荷重振動與許可。" +
    "移離外推鐵窗不等於可安裝；非可施工配置，不得據圖施工。";
export const BALCONY_BASIN_WARNING =
    "外推區掛牆洗衣盆82×48cm僅概念尺寸，型號、實重與盛水荷重未知；" +
    "需由專業人員設計可錨固於可靠混凝土結構的獨立支撐，不能以原鐵窗作承重依據。" +
    "外推實際淨深、合法給排水／污水接管、護欄使用口、防墜及從原樓板使用的動線未核；" +
    "缺乏安全支撐、淨空或合法許可即不能採用。盆體、支撐、拆除、改管與安裝均待報價，非可施工配置。";

export function isConditionalFloorDryer(item) {
    return item?.id === "balcony-dryer" && item.roomId === "balcony" &&
        item.kind === "furniture" && item.furnitureType === "dryer" &&
        item.note?.includes(BALCONY_SWAP_TAG) === true;
}

export function isConditionalOutboardSink(item) {
    return item?.id === BALCONY_SINK_ID && item.roomId === "ac-platform" &&
        item.note?.includes(BALCONY_SWAP_TAG) === true;
}

export function laundryDimensions(item) {
    const width = item?.widthCm ?? 60;
    const depth = item?.depthCm ?? 60;
    return `${width}×${depth}cm${item?.productId ? "商品占地（未含安裝淨距）" : "占地暫估"}`;
}

export function conditionalGasDryerWarning(item) {
    if (!/8TWGD5050PW/i.test(item?.brandModel ?? "")) return "";
    if (item.roomId === "balcony") return BALCONY_FLOOR_DRYER_WARNING;
    if (item.roomId !== "ac-platform") {
        return "瓦斯烘衣機的新位置未經專業核可；固定燃氣、獨立排氣、門口淨距與防火待現勘，非可施工配置。";
    }
    return "Whirlpool 8TWGD5050PW 瓦斯烘衣機僅條件式選款，非可施工配置。" +
        "商品寬73.7×深72.1×高102.9cm；外推鐵窗約78cm為圖示毛深，" +
        "即使按72.1cm深度也僅剩約5.9cm（不足6cm），尚未扣框架、排氣及維修空間。" +
        "瓦斯供應、排氣、防雨、荷重／振動、防火及合法許可均未核；未確認安全接管或安裝核可，" +
        "必須由合格專業人員現勘，不得依此圖自行施工。";
}

export function laundryMarkerNote(item) {
    if (isConditionalOutboardSink(item)) return BALCONY_BASIN_WARNING;
    if (!["washer", "dryer"].includes(item?.furnitureType)) return "";
    return `${laundryDimensions(item)}；${conditionalGasDryerWarning(item) ||
        "供電、給排水或排氣、承重與安裝待現場確認。"}`;
}
