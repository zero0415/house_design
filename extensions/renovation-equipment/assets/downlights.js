export const DOWNLIGHT_QUOTED_UNIT_PRICE_TWD = 950;
export const DOWNLIGHT_REFERENCE_MODEL = "舞光 LED 索爾嵌燈（瓦數／色溫待確認）";

const positions = [
    ["kitchen", 0.348, 0.442, "廚房料理與備餐區上方"],
    ["kitchen", 0.718, 0.647, "廚房另一側工作檯上方"],
    ["bath-main", 0.264, 0.327, "主浴乾區上方"],
    ["bath-main", 0.835, 0.526, "主浴淋浴區上方；濕區燈具防護等級待核"],
    ["bath-guest", 0.644, 0.154, "客浴乾區上方"],
    ["bath-guest", 0.294, 0.795, "客浴浴缸／淋浴區上方；濕區燈具防護等級待核"],
];

export const QUOTED_DOWNLIGHTS = Object.freeze(positions.map(
    ([roomId, x, y, purpose], index) => Object.freeze({
        id: `quoted-downlight-${String(index + 1).padStart(2, "0")}`,
        roomId,
        name: `崁燈配置－${purpose.split("上方")[0]}`,
        placement: Object.freeze({ x, y }),
        purpose,
    }),
));
