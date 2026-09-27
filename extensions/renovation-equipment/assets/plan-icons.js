import { FURNITURE_TEMPLATES } from "./furniture.js";
import { renderKitchenIcon } from "./kitchen-icons.js";
import { isUnknownDepthGuestTub } from "./guest-bath-plan.js";
import {
    BALCONY_SINK_ID, isConditionalFloorDryer, isConditionalOutboardSink,
} from "./laundry-notes.js";

const FURNITURE_BY_NAME = new Map(Object.entries(FURNITURE_TEMPLATES)
    .map(([type, template]) => [template.name, type]));

export function objectIconKind(item) {
    if (item.kind === "furniture") return item.furnitureType;
    if (item.kind !== "equipment" || item.equipmentType || item.lightType ||
        item.switchType || item.outletCircuit) return null;
    const name = item.name ?? "";
    if (item.id === BALCONY_SINK_ID) return "basin";
    const furnitureType = FURNITURE_BY_NAME.get(name);
    if (furnitureType) return furnitureType;
    if (item.id === "bath-guest-tub" || /^浴缸(?:（|$)/.test(name)) return "bathtub";
    if (item.id.endsWith("-toilet") || /^馬桶(?:（|$)/.test(name)) return "toilet";
    if (item.id.endsWith("-basin-tap") || /^(面盆龍頭|水龍頭)(?:（|$)/.test(name)) {
        return "faucet";
    }
    if (item.id.endsWith("-vanity") || /^面盆、浴櫃/.test(name)) return "basin";
    if (item.id.endsWith("-shower") || /^淋浴龍頭/.test(name) ||
        name.includes("蓮蓬頭")) return "shower";
    if (item.id.includes("-urinal-") || name.startsWith("小便斗")) return "urinal";
    if (item.id === "balcony-water-heater" || /^熱水器(?:（|$)/.test(name)) {
        return "water-heater";
    }
    return null;
}

export function renderObjectIcon(item, width, height) {
    const kind = objectIconKind(item);
    if (!kind) return "";
    if (!(Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0)) {
        throw new RangeError("物件圖示缺少有效的占地寬深。");
    }
    if (isUnknownDepthGuestTub(item)) {
        return `<g class="object-icon unknown-depth-tub" data-tub-depth="unknown">
            <title>坐式浴缸：${item.widthCm}cm僅水平概念區段；
                虛線帶高度不是實機深度，不可據此判定占地</title>
            <rect x="${-width / 2}" y="${-height / 2}"
                width="${width}" height="${height}" rx="2"/>
            <text text-anchor="middle" x="7" y="-2">${item.widthCm}cm區段</text>
            <text text-anchor="middle" x="7" y="8">深度未定</text>
        </g>`;
    }
    if (isConditionalFloorDryer(item)) {
        return `<g class="object-icon conditional-floor-dryer">
            <title>瓦斯烘衣機僅條件式樓板暫位；前門箭頭隨轉向，通行與排氣未核</title>
            <rect x="${-width / 2}" y="${-height / 2}" width="${width}"
                height="${height}" rx="3"/>
            <circle r="${Math.min(width, height) * .25}"/>
            <path d="M0 0 V${height * .42}
                M-4 ${height * .34} L0 ${height * .42} L4 ${height * .34}"/>
        </g>`;
    }
    if (isConditionalOutboardSink(item)) {
        return `<g class="object-icon conditional-outboard-basin">
            <title>掛牆洗衣盆僅概念占地；不含櫃體或已確認支架，獨立混凝土錨固待設計</title>
            <rect x="${-width / 2}" y="${-height / 2}" width="${width}"
                height="${height}" rx="3"/>
            <ellipse class="icon-porcelain" cx="0" cy="0"
                rx="${width * .38}" ry="${height * .38}"/>
            <ellipse class="icon-basin" cx="0" cy="0"
                rx="${width * .3}" ry="${height * .28}"/>
            <circle class="icon-hardware" cx="0" cy="${-height * .22}"
                r="${Math.min(width, height) * .035}"/>
        </g>`;
    }
    const kitchen = renderKitchenIcon(item, width, height);
    if (kitchen) return kitchen;
    const w = width;
    const h = height;
    const m = Math.max(1, Math.min(w, h) * 0.07);
    const x = -w / 2 + m;
    const y = -h / 2 + m;
    const iw = w - 2 * m;
    const ih = h - 2 * m;
    const rect = (style, rx, ry, rw, rh, radius = 2) =>
        `<rect class="icon-${style}" x="${rx}" y="${ry}" width="${rw}"
            height="${rh}" rx="${radius}"/>`;
    const path = (style, d) => `<path class="icon-${style}" d="${d}"/>`;
    const circle = (style, cx, cy, radius) =>
        `<circle class="icon-${style}" cx="${cx}" cy="${cy}" r="${radius}"/>`;
    const ellipse = (style, cx, cy, rx, ry) =>
        `<ellipse class="icon-${style}" cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}"/>`;
    let shape;
    if (kind === "bed-single" || kind === "bed-double") {
        const twoPillows = kind === "bed-double";
        shape = rect("sheet", x, y, iw, ih, Math.min(5, m)) +
            rect("blanket", x + m, y + ih * .38, iw - 2 * m, ih * .56, 3) +
            (twoPillows
                ? [0, 1].map((index) => rect("pillow",
                    x + iw * (.05 + index * .47), y + ih * .06,
                    iw * .43, ih * .23, 4)).join("")
                : rect("pillow", x + iw * .12, y + ih * .06,
                    iw * .76, ih * .23, 4)) +
            path("seam", `M${x + m} ${y + ih * .44} H${x + iw - m}`);
    } else if (kind === "sofa") {
        shape = rect("cushion", x, y + ih * .19, iw, ih * .76, 5) +
            rect("wood", x, y, iw, ih * .24, 3) +
            rect("wood", x, y + ih * .2, iw * .13, ih * .74, 3) +
            rect("wood", x + iw * .87, y + ih * .2, iw * .13, ih * .74, 3) +
            path("seam", `M${x + iw * .5} ${y + ih * .25}
                V${y + ih * .87}`);
    } else if (kind === "dining-table") {
        shape = rect("wood", x, y, iw, ih, Math.min(9, ih * .2)) +
            ellipse("plate", x + iw * .27, 0, iw * .1, ih * .14) +
            ellipse("plate", x + iw * .73, 0, iw * .1, ih * .14) +
            circle("hardware", 0, 0, Math.min(iw, ih) * .055);
    } else if (kind === "desk") {
        shape = rect("wood", x, y, iw, ih, 3) +
            rect("screen", x + iw * .27, y + ih * .13, iw * .45, ih * .47, 2) +
            path("seam", `M${x + iw * .3} ${y + ih * .72}
                H${x + iw * .7}`);
    } else if (kind === "wardrobe") {
        shape = rect("cabinet", x, y, iw, ih, 2) +
            path("seam", `M0 ${y + m} V${y + ih - m}`) +
            circle("hardware", -m * .95, 0, Math.max(1.3, m * .36)) +
            circle("hardware", m * .95, 0, Math.max(1.3, m * .36));
    } else if (kind === "tv-cabinet") {
        shape = rect("wood", x, y, iw, ih, 2) +
            [0, 1, 2].map((index) => rect("drawer",
                x + iw * (.04 + index * .32), y + ih * .15,
                iw * .28, ih * .7, 2)).join("");
    } else if (kind === "refrigerator") {
        shape = rect("appliance", x, y, iw, ih, 4) +
            path("seam", `M${x + m} ${y + ih * .47}
                H${x + iw - m}`) +
            path("hardware", `M${x + iw * .78} ${y + ih * .3}
                V${y + ih * .41} M${x + iw * .78} ${y + ih * .55}
                V${y + ih * .73}`);
    } else if (kind === "television") {
        shape = rect("screen", x, y, iw, ih, Math.min(2, ih * .25)) +
            path("seam", `M${x + m} ${y + ih - m * .5}
                H${x + iw - m}`);
    } else if (kind === "washer" || kind === "dryer") {
        const radius = Math.min(iw, ih) * .29;
        shape = rect("appliance", x, y, iw, ih, 5) +
            path("seam", `M${x + m} ${y + ih * .21}
                H${x + iw - m}`) +
            ellipse("drum", 0, ih * .08, radius, radius) +
            circle("glass", 0, ih * .08, radius * .73) +
            (kind === "washer"
                ? path("water", `M${-radius * .6} ${ih * .13}
                    Q${-radius * .2} ${ih * .01} 0 ${ih * .13}
                    T${radius * .6} ${ih * .13}`)
                : path("fan", `M0 ${ih * .08 - radius * .48}
                    V${ih * .08 + radius * .48}
                    M${-radius * .48} ${ih * .08}
                    H${radius * .48}`)) +
            circle("hardware", x + iw * .78, y + ih * .12,
                Math.max(1.2, m * .27));
    } else if (kind === "toilet") {
        shape = rect("tank", x + iw * .12, y, iw * .76, ih * .22, 3) +
            circle("flush-button", 0, y + ih * .11, Math.max(1.2, m * .45)) +
            path("toilet-shell", `M${x + iw * .2} ${y + ih * .22}
                Q${x + iw * .08} ${y + ih * .34} ${x + iw * .16} ${y + ih * .72}
                Q${x + iw * .23} ${y + ih * .98} 0 ${y + ih * .98}
                Q${x + iw * .77} ${y + ih * .98} ${x + iw * .84} ${y + ih * .72}
                Q${x + iw * .92} ${y + ih * .34} ${x + iw * .8} ${y + ih * .22} Z`) +
            ellipse("toilet-seat", 0, y + ih * .59, iw * .32, ih * .27) +
            ellipse("toilet-water", 0, y + ih * .59, iw * .2, ih * .16);
    } else if (kind === "bathtub") {
        shape = rect("porcelain", x, y, iw, ih, Math.min(9, ih * .28)) +
            rect("basin", x + m * 1.3, y + m * 1.3,
                iw - 2.6 * m, ih - 2.6 * m, Math.min(8, ih * .2)) +
            circle("hardware", x + iw * .84, 0, Math.max(1.5, m * .47));
    } else if (kind === "basin") {
        shape = rect("cabinet", x, y, iw, ih, 3) +
            ellipse("porcelain", 0, ih * .06, iw * .35, ih * .31) +
            ellipse("basin", 0, ih * .06, iw * .26, ih * .23) +
            circle("hardware", 0, ih * .1, Math.max(1.2, m * .36));
    } else if (kind === "faucet") {
        shape = path("hardware", `M${-iw * .3} ${ih * .2}
            H${iw * .3} V${-ih * .17} Q${iw * .3} ${-ih * .32}
            ${iw * .15} ${-ih * .32} H0 V${-ih * .02}`) +
            circle("water", 0, ih * .14, Math.min(2.5, iw * .08));
    } else if (kind === "shower") {
        shape = circle("porcelain", 0, -ih * .12, Math.min(iw, ih) * .32) +
            circle("hardware", 0, -ih * .12, Math.min(iw, ih) * .12) +
            [-.26, 0, .26].map((ratio) => circle("water", iw * ratio, ih * .3,
                Math.min(2, iw * .045))).join("");
    } else if (kind === "urinal") {
        shape = rect("urinal-mount", x + iw * .31, y, iw * .38, ih * .15, 2) +
            circle("flush-button", 0, y + ih * .11, Math.max(1.2, m * .42)) +
            path("urinal-shell", `M${x + iw * .19} ${y + ih * .2}
                Q${x + iw * .09} ${y + ih * .29} ${x + iw * .2} ${y + ih * .66}
                Q${x + iw * .3} ${y + ih * .95} 0 ${y + ih * .95}
                Q${x + iw * .7} ${y + ih * .95} ${x + iw * .8} ${y + ih * .66}
                Q${x + iw * .91} ${y + ih * .29} ${x + iw * .81} ${y + ih * .2} Z`) +
            path("urinal-recess", `M${x + iw * .33} ${y + ih * .31}
                Q${x + iw * .32} ${y + ih * .64} 0 ${y + ih * .79}
                Q${x + iw * .68} ${y + ih * .64} ${x + iw * .67} ${y + ih * .31} Z`) +
            circle("flush-button", 0, y + ih * .71, Math.max(1, m * .26));
    } else if (kind === "water-heater") {
        shape = rect("appliance", x, y, iw, ih, 2) +
            circle("hardware", x + iw * .72, 0, Math.min(2.5, ih * .25)) +
            path("seam", `M${x + iw * .15} 0 H${x + iw * .5}`);
    }
    return `<g class="object-icon icon-${kind}">${shape}</g>`;
}
