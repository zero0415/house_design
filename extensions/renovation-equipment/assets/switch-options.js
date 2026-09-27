export const SWITCH_QUOTED_UNIT_PRICE_TWD = 2250;

export const SWITCH_TYPES = Object.freeze({
    single: Object.freeze({ label: "單開關", brandModel: "國際牌 Risna 黑灰色單開關" }),
    double: Object.freeze({ label: "雙開關", brandModel: "國際牌 Risna 黑灰色雙開關" }),
});

export const OUTDOOR_SWITCH_TYPES = Object.freeze({
    single: Object.freeze({
        label: "戶外單開關",
        marker: "單",
        brandModel: "戶外防潮單開關（防護等級／型號待核）",
    }),
    double: Object.freeze({
        label: "戶外雙開關",
        marker: "雙",
        brandModel: "戶外防潮雙開關（防護等級／型號待核）",
    }),
});
export const BALCONY_SWITCH_PLACEMENT = Object.freeze({ x: 0.39, y: 0.22 });

export function switchOptionFor(item) {
    if (!item?.switchType) return null;
    return (item.switchEnvironment === "outdoor"
        ? OUTDOOR_SWITCH_TYPES : SWITCH_TYPES)[item.switchType] ?? null;
}

const locations = [
    ["entry", "玄關入口", 0.828, 0.324, "入門照明控制點"],
    ["living-dining", "客餐廳入口", 0.070, 0.914, "進入客餐廳的照明控制點"],
    ["living-dining", "客廳主臥側", 0.924, 0.552, "客廳與主臥交界的照明控制點"],
    ["living-dining", "餐區", 0.921, 0.080, "餐區照明控制點"],
    ["master", "主臥門旁", 0.109, 0.946, "主臥入門照明控制點"],
    ["master", "主臥窗側", 0.905, 0.430, "主臥另一組燈光控制點"],
    ["bedroom-1", "臥室1門旁", 0.106, 0.847, "臥室1入門照明控制點"],
    ["bedroom-2", "臥室2門旁", 0.861, 0.605, "臥室2走廊門邊照明控制點"],
    ["bedroom-3", "臥室3門旁", 0.689, 0.101, "臥室3入門照明控制點"],
    ["studio", "工作室入口", 0.109, 0.134, "工作室走道門旁照明控制點"],
    ["studio", "工作室工作區", 0.891, 0.509, "工作區另一組照明控制點"],
    ["studio", "工作室陽台側", 0.255, 0.909, "由工作室內控制陽台照明；開關不設在室外"],
    ["kitchen", "廚房門旁", 0.106, 0.724, "廚房入門照明控制點"],
    ["bath-main", "主浴乾區側", 0.117, 0.705, "主浴圖面暫標乾區側；實際位置應由電工確認並避開濕區"],
    ["bath-guest", "客浴乾區側", 0.840, 0.788, "客浴圖面暫標乾區側；實際位置應由電工確認並避開濕區"],
];

export const QUOTED_SWITCHES = Object.freeze(locations.map(
    ([roomId, label, x, y, purpose], index) => Object.freeze({
        id: `quoted-switch-${String(index + 1).padStart(2, "0")}`,
        roomId,
        name: `開關配置－${label}`,
        placement: Object.freeze({ x, y }),
        purpose,
    }),
));
