export const QUOTED_SOCKET_COUNT = 50;
export const QUOTED_DEDICATED_COUNT = 7;
export const SOCKET_UNIT_PRICE_TWD = 1800;
export const DEDICATED_CIRCUIT_UNIT_PRICE_TWD = 4500;
export const SOCKET_PLAN_VERSION = 2;
export const PLANNER_STATE_VERSION = 5;
export const WEAK_CURRENT_UNIT_PRICE_TWD = 3000;
export const QUOTED_WEAK_CURRENT_IDS = Object.freeze(
    Array.from({ length: 7 }, (_, index) => `weak-outlet-C0${index + 1}`));

export function isWeakCurrent(item) {
    return item?.kind === "equipment" && item.equipmentType === "weak-current";
}

export function isPairedSocket(item, items) {
    return isSocket(item) && items.some((entry) =>
        isDedicatedCircuit(entry) && entry.circuitOutletId === item.id);
}

export function electricalPointCounts(items) {
    const sockets = items.filter(isSocket);
    const dedicated = sockets.filter((item) => isPairedSocket(item, items)).length;
    return { power: sockets.length, general: sockets.length - dedicated, dedicated,
        circuits: items.filter(isDedicatedCircuit).length,
        weak: items.filter(isWeakCurrent).length };
}

const dedicated = [
    ["outlet-master-ac", "master", "主臥冷氣", .82, .29,
        "原報價三條冷氣專屬迴路暫配主臥；W40 窗外機位及吊裝尚未確認。"],
    ["outlet-bedroom-1-ac", "bedroom-1", "臥室1冷氣", .83, .22,
        "原報價三條冷氣專屬迴路暫配臥室1；插座電壓、電流與冷氣型號待核。"],
    ["outlet-living-ac", "living-dining", "客餐廳冷氣", .30, .14,
        "原報價三條冷氣專屬迴路暫配客餐廳；工作室及臥室3冷氣另須核價。"],
    ["outlet-kitchen-cabinet", "kitchen", "電器櫃", .82, .30,
        "原報價電器櫃專屬迴路暫標廚房側；櫃體位置與實際負載待核。"],
    ["outlet-bath-main-fan", "bath-main", "主浴風機", .40, .37,
        "原報價列暖風機專屬迴路；現改真正室外進氣新風機，能否抵用、插座或固定接線及濕區防護均待重報。"],
    ["outlet-bath-guest-fan", "bath-guest", "客浴風機", .80, .64,
        "原報價列暖風機專屬迴路；現改新風機，須核對電壓、漏電保護、潮濕區域與施工額度。"],
    ["outlet-kitchen-ih", "kitchen", "IH 爐", .59, .77,
        "原報價 IH 爐專屬迴路；實機可能要求特定電壓／電流的專用接頭或固定配線，不可用一般插座代替。"],
];

const general = {
    "living-dining": [
        ["沙發左側", .13, .23], ["沙發右側", .39, .31],
        ["電視及機上盒", .85, .38], ["餐桌旁", .34, .52],
        ["冰箱附近", .38, .68], ["餐櫃小家電", .81, .67],
        ["掃地機充電", .14, .84], ["窗側空氣清淨機", .60, .10],
        ["落地燈預留", .80, .23], ["臥室2隔間外側備用", .76, .91],
    ],
    master: [
        ["床頭左側", .27, .71], ["床頭右側", .73, .70],
        ["窗側空氣清淨機", .89, .38], ["書桌預留", .56, .48],
        ["門邊清潔設備", .26, .87],
    ],
    "bedroom-1": [
        ["床頭左側", .22, .56], ["床頭右側", .76, .56],
        ["書桌側", .79, .81], ["窗側備用", .27, .26],
    ],
    "bedroom-2": [
        ["床頭左側", .21, .62], ["床頭右側", .76, .62],
        ["書桌側", .24, .23], ["走道門旁", .81, .27],
    ],
    "bedroom-3": [
        ["床頭左側", .20, .54], ["床頭右側", .72, .54],
        ["書桌側", .22, .25], ["工作室拉門旁", .78, .77],
    ],
    studio: [
        ["工作桌左側", .24, .36], ["工作桌右側", .68, .35],
        ["工作桌下方", .68, .65], ["陽台拉門內側", .23, .81],
        ["牆面備用", .41, .64],
    ],
    kitchen: [
        ["料理檯左側", .23, .28], ["料理檯中央", .49, .26],
        ["料理檯右側", .81, .65], ["小家電備用", .34, .77],
        ["冰箱／備餐預留", .62, .56],
    ],
    entry: [
        ["玄關置物檯", .70, .25], ["門內清潔設備", .56, .75],
    ],
    corridor: [
        ["走廊清潔設備", .53, .78],
    ],
    balcony: [
        ["洗衣機附近", .62, .82],
    ],
    "bath-main": [
        ["主浴馬桶旁（免治座）", .13, .75],
    ],
    "bath-guest": [
        ["客浴馬桶旁（免治座）", .93, .43],
    ],
};

const layout = [
    ...dedicated.map(([id, roomId, purpose, x, y, caution]) => ({
        id, roomId, purpose, placement: { x, y },
        outletCircuit: "dedicated", caution,
    })),
    ...Object.entries(general).flatMap(([roomId, points]) => points.map(
        ([purpose, x, y], index) => ({
            id: `outlet-${roomId}-general-${String(index + 1).padStart(2, "0")}`,
            roomId, purpose, placement: { x, y },
            outletCircuit: "general",
        }),
    )),
];

if (layout.length !== QUOTED_SOCKET_COUNT ||
    dedicated.length !== QUOTED_DEDICATED_COUNT ||
    new Set(layout.map((entry) => entry.id)).size !== layout.length ||
    layout.some((entry) => !Number.isFinite(entry.placement.x) ||
        !Number.isFinite(entry.placement.y))) {
    throw new RangeError("插座配置必須剛好包含 7 個專用與 43 個一般位置。");
}

const legacyDedicated = layout.filter((entry) => entry.outletCircuit === "dedicated");
export const QUOTED_OUTLETS = Object.freeze(layout.map((entry) => Object.freeze({
    ...entry, outletCircuit: "general", placement: Object.freeze(entry.placement),
})));
export const QUOTED_OUTLET_BY_ID = new Map(
    QUOTED_OUTLETS.map((entry) => [entry.id, entry]),
);
export const QUOTED_CIRCUITS = Object.freeze(legacyDedicated.map((entry) =>
    Object.freeze({ id: `circuit-${entry.id}`, outletId: entry.id,
        purpose: entry.purpose, roomId: entry.roomId })));
export const QUOTED_CIRCUIT_BY_ID = new Map(
    QUOTED_CIRCUITS.map((entry) => [entry.id, entry]),
);

export function isSocket(item) {
    return item?.kind === "equipment" &&
        ["general", "additional-general"].includes(item.outletCircuit);
}

export function isDedicatedCircuit(item) {
    return item?.kind === "equipment" &&
        item.equipmentType === "dedicated-circuit";
}

export function isQuotedOutlet(item) {
    return item?.kind === "equipment" && QUOTED_OUTLET_BY_ID.has(item.id);
}

export function isQuotedCircuit(item) {
    return isDedicatedCircuit(item) && QUOTED_CIRCUIT_BY_ID.has(item.id);
}

export function circuitPlacement(position) {
    if (!position) return null;
    return {
        x: position.x > .5 ? Math.max(.06, position.x - .07) :
            Math.min(.94, position.x + .07),
        y: position.y > .5 ? Math.max(.06, position.y - .06) :
            Math.min(.94, position.y + .06),
    };
}

export function createCircuitForSocket(outlet, id) {
    if (!isSocket(outlet) || !id) {
        throw new TypeError("專用迴路須指定一個一般插座。");
    }
    return {
        id, roomId: outlet.roomId,
        name: `專用迴路－${outlet.name.replace(/^新增/, "")}`,
        quantity: 1, unit: "條",
        brandModel: "專屬配線（5.5mm²；實際電流與保護待電工核對）",
        unitPrice: DEDICATED_CIRCUIT_UNIT_PRICE_TWD,
        priceCurrency: "TWD",
        priceSource: "暫依原報專屬迴路每條 NT$4,500 試算；增減及實價待電工確認",
        note: "此迴路僅對應一個實體插座；線徑、負載、保護開關及配電容量須由合格電工核對，迴路不足或共用高負載設備可能跳電。",
        placement: circuitPlacement(outlet.placement),
        orientation: null,
        kind: "equipment", furnitureType: null, equipmentType: "dedicated-circuit",
        widthCm: null, depthCm: null, circuitOutletId: outlet.id,
        quotedUnitPrice: null, quotedQuantity: null,
    };
}

export function createQuotedOutletItems() {
    return QUOTED_OUTLETS.map((entry) => {
        const hasCircuit = legacyDedicated.some((dedicated) => dedicated.id === entry.id);
        const caution = entry.roomId === "balcony"
            ? "陽台須確認遮雨、戶外適用防護及漏電保護；此一般插座先對應洗衣機，不代表鐵窗烘衣機已取得專屬迴路。"
            : entry.roomId.startsWith("bath-")
                ? "浴室馬桶旁僅暫標討論點；濕區距離、漏電保護及免治便座的實際電壓須由合格電工確認。"
                : "";
        return {
            id: entry.id,
            roomId: entry.roomId,
            name: `一般插座－${entry.purpose}`,
            quantity: 1,
            unit: "個",
            brandModel: "國際星光開關插座（接頭／電壓／防護等級待核）",
            unitPrice: SOCKET_UNIT_PRICE_TWD,
            priceCurrency: "TWD",
            priceSource: "原報價｜插座迴路配置 NT$1,800（太平洋電線 2.0mm²／CD 硬管）",
            note: `用途暫擬：${entry.purpose}。每個標記是 1 個實體插座，
                共 50 個中的一個；圖示中心只表示用電區域，不是地板插座、
                已丈量的牆面／高度、可用插孔數或已核准的迴路。
                原插座迴路單價 NT$1,800 已含於工程總價；不代表可供高功率設備使用。
                ${hasCircuit ? "此點另有一筆獨立的原報專用迴路物件，額度 NT$4,500；兩筆不得重複加價。" : ""}
                ${entry.caution ?? caution}`.replace(/\s+/g, " ").trim(),
            placement: { ...entry.placement },
            orientation: null,
            kind: "equipment",
            furnitureType: null,
            widthCm: null,
            depthCm: null,
            outletCircuit: "general",
            quotedUnitPrice: SOCKET_UNIT_PRICE_TWD,
            quotedQuantity: 1,
        };
    });
}

export function createQuotedCircuitItems(outlets = createQuotedOutletItems()) {
    const byId = new Map(outlets.map((outlet) => [outlet.id, outlet]));
    return QUOTED_CIRCUITS.map((entry) => {
        const outlet = byId.get(entry.outletId);
        if (!outlet) throw new RangeError(`找不到原報專用迴路對應的插座：${entry.outletId}`);
        return {
            ...createCircuitForSocket(outlet, entry.id),
            name: `專用迴路－${entry.purpose}`,
            priceSource: "原報價｜專屬迴路(5.5mm²)每條 NT$4,500",
            quotedUnitPrice: DEDICATED_CIRCUIT_UNIT_PRICE_TWD,
            quotedQuantity: 1,
        };
    });
}

function unbundlePrice(value, label) {
    if (value == null) return null;
    if (typeof value !== "number" || !Number.isFinite(value) ||
        value < DEDICATED_CIRCUIT_UNIT_PRICE_TWD) {
        throw new RangeError(`舊版「${label}」合計單價低於 NT$4,500，無法安全拆分插座與專用迴路；原資料未變更。`);
    }
    return value - DEDICATED_CIRCUIT_UNIT_PRICE_TWD;
}

export function upgradeLegacySocketPlan(data) {
    if (data?.version !== 1) return data;
    if (!Array.isArray(data.items) || data.products !== undefined &&
        !Array.isArray(data.products)) {
        throw new TypeError("舊版存檔的物件或商品資料不完整，無法升級。");
    }
    const oldIds = new Set(data.items.map((item) => item.id));
    const circuits = [];
    const items = data.items.map((item) => {
        const quoted = legacyDedicated.some((entry) => entry.id === item.id);
        const additional = item.outletCircuit === "additional-dedicated";
        if (!quoted && !additional) return item;
        if (item.outletCircuit !== (quoted ? "dedicated" : "additional-dedicated")) {
            throw new RangeError(`舊版「${item.name}」專用插座資料不完整，未升級。`);
        }
        const circuitId = `circuit-${item.id}`;
        if (oldIds.has(circuitId)) {
            throw new RangeError(`舊版資料中已存在迴路識別碼 ${circuitId}，未升級。`);
        }
        const quotedUnitPrice = quoted ? SOCKET_UNIT_PRICE_TWD : null;
        if (quoted && (item.quotedUnitPrice !== SOCKET_UNIT_PRICE_TWD +
            DEDICATED_CIRCUIT_UNIT_PRICE_TWD || item.quotedQuantity !== 1)) {
            throw new RangeError(`舊版原報插座「${item.name}」的報價基準無法拆分，未升級。`);
        }
        const outlet = {
            ...item,
            name: item.name.replace(/^專用插座/, "一般插座")
                .replace(/^新增專用插座＋迴路$/, "新增一般插座"),
            unitPrice: unbundlePrice(item.unitPrice, item.name) ??
                (quoted || item.productId ? null : SOCKET_UNIT_PRICE_TWD),
            outletCircuit: quoted ? "general" : "additional-general",
            quotedUnitPrice,
            priceSource: quoted
                ? "原報價｜插座迴路配置 NT$1,800；專用迴路已另列"
                : item.productId ? item.priceSource :
                    `${item.priceSource ?? ""}；舊版合併單價已拆為插座及獨立迴路`,
            note: (item.note ?? "").replace(
                "本點含原插座迴路 NT$1,800 與一條專屬迴路 NT$4,500 的原報份額；兩筆合併列於同一插座，不能再重複加價。",
                "本點原報插座 NT$1,800；原報專用迴路 NT$4,500 已另列獨立物件。",
            ).replace(
                "此為額外的一個實體插座及新專屬迴路，",
                "舊版將插座與新迴路合列，現已拆為兩筆暫估，",
            ),
        };
        const circuit = createCircuitForSocket(outlet, circuitId);
        circuit.name = `專用迴路－${item.name.replace(/^新增專用插座＋迴路$/, "新增插座")
            .replace(/^專用插座－/, "")}`;
        if (quoted) {
            circuit.quotedUnitPrice = DEDICATED_CIRCUIT_UNIT_PRICE_TWD;
            circuit.quotedQuantity = 1;
            circuit.priceSource = "原報價｜專屬迴路(5.5mm²)每條 NT$4,500";
        }
        circuit.note += ` 舊版此迴路與「${item.name}」合列；原說明：${item.note ?? ""}`;
        if (circuit.note.length > 1000) {
            throw new RangeError(`舊版「${item.name}」備註過長，無法保留拆分紀錄；原資料未變更。`);
        }
        circuits.push(circuit);
        return outlet;
    });
    const products = (data.products ?? []).map((product) => {
        if (product.type !== "outlet-dedicated") return product;
        const note = `${product.note ?? ""} 舊版此款含新迴路；
            現商品單價僅計插座，專用迴路需另建並配對。`.replace(/\s+/g, " ").trim();
        if (note.length > 800) {
            throw new RangeError(`舊版商品「${product.name}」備註過長，無法保留拆分說明；原資料未變更。`);
        }
        return { ...product, type: "outlet-general",
            unitPrice: unbundlePrice(product.unitPrice, product.name), note };
    });
    if (items.length + circuits.length > 600) {
        throw new RangeError("拆分專用迴路後超過 600 筆上限，請先精簡舊版設備清單。");
    }
    return { ...data, version: SOCKET_PLAN_VERSION,
        items: [...items, ...circuits], products };
}
