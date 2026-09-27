export const DOOR_OPTIONS = Object.freeze({
    "solid-wood": Object.freeze({ label: "實木門（品牌省略）", unitPrice: 14000, opening: "swing" }),
    "wood-fiber": Object.freeze({ label: "木纖門", unitPrice: 10500, opening: "swing" }),
    "bathroom": Object.freeze({ label: "塑鋼廁所門", unitPrice: 8500, opening: "swing" }),
    "wood-slide": Object.freeze({ label: "木纖滑門", unitPrice: 19000, opening: "slide" }),
    "shower-glass": Object.freeze({ label: "無框強化玻璃門（費用另列設備）", unitPrice: 0, opening: "swing" }),
    custom: Object.freeze({ label: "自訂材質（請填價格）", unitPrice: null, opening: null }),
});
