export function laundryDimensions(item) {
    const width = item?.widthCm ?? 60;
    const depth = item?.depthCm ?? 60;
    return `${width}×${depth}cm${item?.productId ? "商品占地（未含安裝淨距）" : "占地暫估"}`;
}

export function conditionalGasDryerWarning(item) {
    if (!/8TWGD5050PW/i.test(item?.brandModel ?? "")) return "";
    return "Whirlpool 8TWGD5050PW 瓦斯烘衣機僅條件式選款，非可施工配置。" +
        "商品寬73.7×深72.1×高102.9cm；外推鐵窗約78cm為圖示毛深，" +
        "即使按72.1cm深度也僅剩約5.9cm（不足6cm），尚未扣框架、排氣及維修空間。" +
        "瓦斯供應、排氣、防雨、荷重／振動、防火及合法許可均未核；未確認安全接管或安裝核可，" +
        "必須由合格專業人員現勘，不得依此圖自行施工。";
}

export function laundryMarkerNote(item) {
    if (!["washer", "dryer"].includes(item?.furnitureType)) return "";
    return `${laundryDimensions(item)}；${conditionalGasDryerWarning(item) ||
        "供電、給排水或排氣、承重與安裝待現場確認。"}`;
}
