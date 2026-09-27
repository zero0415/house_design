export function kitchenDrawOrder(a, b) {
    const layer = (item) => {
        const type = item.furnitureType ?? "";
        if (!type.startsWith("kitchen-")) return 2;
        return ["kitchen-prep", "kitchen-sink-base", "kitchen-cooktop-base",
            "kitchen-tower", "kitchen-return"].includes(type) ? 0 : 1;
    };
    return layer(a) - layer(b);
}

export function renderKitchenIcon(item, width, height) {
    const type = item.furnitureType;
    if (!type?.startsWith("kitchen-")) return null;
    const x = -width / 2;
    const y = -height / 2;
    const box = (extra = "") => `<rect class="kitchen-outline ${extra}" x="${x}"
        y="${y}" width="${width}" height="${height}" rx="1"/>`;
    const text = (label, cy = 0, size = 7) => `<text class="kitchen-label"
        y="${cy}" style="font-size:${size}px" text-anchor="middle">${label}</text>`;
    let body;
    if (["kitchen-prep", "kitchen-sink-base", "kitchen-cooktop-base"].includes(type)) {
        const label = type === "kitchen-prep" ? "備餐" :
            type === "kitchen-sink-base" ? "水槽櫃" : "共用檯";
        body = box("kitchen-base") +
            text(`${label} ${item.widthCm}cm`,
                y + (type === "kitchen-cooktop-base" ? 17 : 6), 6);
    } else if (type === "kitchen-tower" || type === "kitchen-return") {
        body = box("kitchen-base") + text(type === "kitchen-tower" ? "電器高櫃" : "訂製短櫃") +
            text("暫估", 10, 6);
    } else if (type === "kitchen-ih" || type === "kitchen-gas") {
        const r = Math.min(width, height) * .31;
        body = box() + `<circle class="kitchen-ring" r="${r}"/>` +
            (type === "kitchen-ih"
                ? `<circle class="kitchen-ring" r="${r * .7}"/>`
                : `<path class="kitchen-ring" d="M${-r} 0 H${r} M0 ${-r} V${r}"/>`) +
            text(type === "kitchen-ih" ? "IH" : "瓦斯", height / 2 - 3, 6);
    } else if (type === "kitchen-dishwasher") {
        body = box("kitchen-under") +
            `<path class="kitchen-ring" d="M${x + 5} ${height / 2 - 13} H${-x - 5}"/>` +
            text("Bosch 檯下", height / 2 - 5, 7);
    } else if (type === "kitchen-sink") {
        body = box() + `<rect class="kitchen-water" x="${x + 4}" y="${y + 4}"
            width="${width - 8}" height="${height - 8}" rx="5"/>` +
            text("水槽", 3);
    } else if (type === "kitchen-faucet") {
        body = `<path class="kitchen-ring" d="M0 ${height / 2} V${y} H${width / 3} V0"/>`;
    } else if (type === "kitchen-hood") {
        body = box("kitchen-overhead") + text("80cm 排油煙機 ↑ 上方", 2, 5);
    } else if (type === "kitchen-hot-water") {
        body = box() + text("3M 櫃下", 2, 4);
    } else {
        throw new RangeError(`未知廚房圖例：${type}`);
    }
    return `<g class="object-icon kitchen-icon ${type}">${body}</g>`;
}
