import { customEquipment } from "./equipment-catalog.js";
import {
    createCircuitForSocket, createQuotedOutletItems, isDedicatedCircuit, isSocket,
    isWeakCurrent, QUOTED_CIRCUITS, QUOTED_OUTLETS, QUOTED_WEAK_CURRENT_IDS,
    DEDICATED_CIRCUIT_UNIT_PRICE_TWD, WEAK_CURRENT_UNIT_PRICE_TWD,
} from "./socket-plan.js";

// Only deidentified point IDs and normalized room hints; no source document bytes.
const rows = [
    ["R01", "entry", .4398, .8747], ["R02", "entry", .5272, .8747],
    ["R03", "living-dining", .04, .6959], ["R04", "bedroom-3", .0519, .5395],
    ["R05", "bedroom-3", .0519, .136], ["R06", "bedroom-2", .1178, .241],
    ["R07", "bedroom-2", .1198, .3035], ["R08", "living-dining", .1744, .532],
    ["R09", "living-dining", .1813, .0912], ["R10", "bedroom-2", .1891, .96],
    ["R11", "bath-guest", .4384, .0912], ["R12", "living-dining", .3999, .96],
    ["R13", "bath-guest", .5047, .9147], ["R14", "bath-guest", .6609, .0937],
    ["R15", "bedroom-2", .8026, .0643], ["R16", "bedroom-3", .6353, .9087],
    ["R17", "bedroom-3", .6912, .9087], ["R18", "living-dining", .96, .8134],
    ["R19", "living-dining", .96, .6162], ["R20", "living-dining", .96, .2953],
    ["R21", "living-dining", .96, .2745], ["R22", "living-dining", .96, .2548],
    ["R23", "living-dining", .96, .04], ["R24", "bedroom-3", .96, .5367],
    ["R25", "master", .0558, .7128], ["R26", "master", .0558, .5095],
    ["R27", "master", .0558, .4799], ["R28", "master", .0558, .4503],
    ["R29", "master", .0558, .1333], ["R30", "master", .0558, .1037],
    ["R31", "bedroom-1", .04, .703], ["R32", "bedroom-1", .0429, .2637],
    ["R33", "balcony", .072, .6904], ["R34", "bath-main", .1004, .8872],
    ["R35", "bath-main", .3809, .0891], ["R36", "bath-main", .3964, .8872],
    ["R37", "kitchen", .3888, .122], ["R38", "studio", .4791, .04],
    ["R39", "bedroom-1", .6471, .96], ["R40", "kitchen", .6729, .122],
    ["R41", "studio", .7961, .7851], ["R42", "master", .8107, .0716],
    ["R43", "master", .9128, .7924], ["R44", "master", .9128, .7595],
    ["R45", "master", .9128, .6487], ["R46", "master", .9128, .3416],
    ["R47", "bedroom-1", .9204, .5608], ["R48", "balcony", .9242, .7204],
    ["R49", "balcony", .9242, .5565], ["R50", "studio", .9258, .4191],
    ["R51", "studio", .9291, .4695],
    ["B01", "bath-guest", .515, .4082, "客浴三合一／現規劃新風機待核", 220, "outlet-bath-guest-fan"],
    ["B02", "bedroom-3", .4052, .96, "外牆冷氣專用1（供應哪台待核）", 220, "outlet-master-ac"],
    ["B03", "bedroom-3", .458, .96, "外牆冷氣專用2（供應哪台待核）", 220, "outlet-bedroom-1-ac"],
    ["B04", "bedroom-3", .5116, .96, "外牆冷氣專用3（供應哪台待核）", 220, "outlet-living-ac"],
    ["B05", "kitchen", .1012, .1167, "電器櫃", 110, "outlet-kitchen-cabinet"],
    ["B06", "kitchen", .3196, .122, "洗碗機", 110],
    ["B07", "bath-main", .4466, .2105, "主浴三合一／現規劃新風機待核", 220, "outlet-bath-main-fan"],
    ["B08", "kitchen", .6104, .1193, "IH 爐", 220, "outlet-kitchen-ih"],
    ["B09", "kitchen", .9196, .5953, "瞬熱飲水器", 220],
    ["C01", "bedroom-2", .1178, .181], ["C02", "bedroom-3", .5825, .9087],
    ["C03", "living-dining", .96, .3167], ["C04", "master", .0574, .1628],
    ["C05", "bedroom-1", .7029, .96], ["C06", "master", .9128, .822],
    ["C07", "studio", .9291, .5236],
];
export const OUTLET_DIAGRAM_POINTS = Object.freeze(rows.map(
    ([sourceId, roomId, x, y, purpose = "", voltage = null, quotedId = null]) =>
        Object.freeze({ sourceId, roomId, placement: Object.freeze({ x, y }),
            purpose, voltage, quotedId })));
export const OUTLET_DIAGRAM_CAUTION =
    "公開示例僅保留去識別化標位的房間與座標；R 為一般電源、B 為獨立實體專用供電端點、C 為弱電非電源。" +
    "點位與房間配準仍暫定，圖示不是插孔型式、安裝高度或已核准配線；牆外標位未自動移入，須現勘確認。" +
    "110V／220V 是來源標註，電流、接頭、接地、濕區／戶外保護及施工費另核。";
export const OUTLET_POINT_WARNINGS = Object.freeze({
    R08: "客餐廳凹角邊的來源標位與房間輪廓有衝突；保留來源位置，不自動移入，待現場核對。",
    R33: "陽台水槽旁的來源標位與固定水槽有衝突；保留來源位置，不自動移入，濕區安全及位置待現場核對。",
    R42: "主臥弧牆外側的來源標位與房間輪廓有衝突；保留來源位置，不自動移入，待現場核對。",
    B05: "電器櫃供電在原標位左側，但新概念高櫃在右；保留電源原標位、不搬設備，施工路徑與供電設計待確認。",
});

function pointAssignments() {
    const points = OUTLET_DIAGRAM_POINTS.map((point) => ({ ...point }));
    const dedicatedIds = new Set(QUOTED_CIRCUITS.map((entry) => entry.outletId));
    const available = QUOTED_OUTLETS.filter((entry) => !dedicatedIds.has(entry.id));
    for (const point of points.filter((entry) => entry.sourceId.startsWith("R"))) {
        const index = available.findIndex((entry) => entry.roomId === point.roomId);
        if (index >= 0) point.quotedId = available.splice(index, 1)[0].id;
    }
    for (const point of points.filter((entry) => entry.sourceId.startsWith("R") && !entry.quotedId)) {
        if (available.length) point.quotedId = available.shift().id;
    }
    return points.map((point) => ({ ...point, id: point.sourceId.startsWith("C")
        ? `weak-outlet-${point.sourceId}` : point.quotedId ??
            // Keep the original public sample's pseudonymous balcony outlet ID.
            (point.sourceId === "R48" ? "sample-balcony-outlet-01" :
                `pdf-outlet-${point.sourceId}`) }));
}
export const OUTLET_DIAGRAM_ASSIGNMENTS = Object.freeze(pointAssignments());

export function migrateOutletDiagram(state) {
    if (state?.version !== 5 || !Array.isArray(state.items) || !Array.isArray(state.rooms)) {
        throw new TypeError("插座遷移需要驗證過的最新 v5 存檔。");
    }
    const existing = new Map(state.items.map((item) => [item.id, item]));
    const already = state.items.filter((item) => item.outletPlanPointId);
    if (already.length) {
        const complete = OUTLET_DIAGRAM_ASSIGNMENTS.every((point) =>
            existing.get(point.id)?.outletPlanPointId === point.sourceId);
        const black = already.filter((item) => item.outletPlanPointId.startsWith("B"));
        if (!complete || already.length !== 67 || state.items.filter(isSocket).length !== 60 ||
            state.items.filter(isDedicatedCircuit).length !== 9 ||
            state.items.filter(isWeakCurrent).length !== 7 ||
            !black.every((outlet) => state.items.some((circuit) =>
                isDedicatedCircuit(circuit) && circuit.circuitOutletId === outlet.id &&
                circuit.roomId === outlet.roomId))) {
            throw new Error("去識別化標位已部分套用或曾刪除；停止遷移，請核對，不自動覆蓋後續編輯。");
        }
        return { state: structuredClone(state), changed: false };
    }
    const quoteDefaults = new Map(createQuotedOutletItems().map((item) => [item.id, item]));
    const points = OUTLET_DIAGRAM_ASSIGNMENTS.map((point) => {
        if (!state.rooms.some((room) => room.id === point.roomId)) {
            throw new Error(`標位 ${point.sourceId} 缺少房間 ${point.roomId}。`);
        }
        if (existing.has(point.id) && !isSocket(existing.get(point.id)) &&
            !isWeakCurrent(existing.get(point.id))) {
            throw new Error(`標位 ID 衝突：${point.id}，未覆寫。`);
        }
        const weak = point.sourceId.startsWith("C");
        const black = point.sourceId.startsWith("B");
        const base = point.quotedId
            ? structuredClone(existing.get(point.quotedId) ?? quoteDefaults.get(point.quotedId))
            : existing.has(point.id) ? structuredClone(existing.get(point.id)) : customEquipment({
                roomId: point.roomId, customType: weak ? "equipment" : "outlet-general",
                name: point.sourceId, quantity: 1, unit: "個",
                unitPrice: weak ? WEAK_CURRENT_UNIT_PRICE_TWD : 1800,
            }, point.id);
        return { ...base, id: point.id, roomId: point.roomId,
            name: `${weak ? "弱電 C 埠" : black ? "專用實體電源" : "一般電源"} ${point.sourceId}${point.purpose ? `－${point.purpose}` : ""}`,
            placement: { ...point.placement }, orientation: 0,
            outletPlanPointId: point.sourceId,
            ...(weak ? { equipmentType: "weak-current", markerStyle: "square-label",
                equipmentCategory: "outlets", quotedUnitPrice: WEAK_CURRENT_UNIT_PRICE_TWD,
                quotedQuantity: 1 } : {}),
            brandModel: weak ? "弱電／網路 C（接頭與系統待核，非電源）" :
                point.voltage ? `標註 ${point.voltage}V 專用供電（接頭／負載待核）` : base.brandModel,
            priceSource: weak ? "原報價｜弱電 7 條 × NT$3,000 已含於原工程基準；此筆標位不重複追加" :
                base.priceSource,
            note: `${OUTLET_DIAGRAM_CAUTION} ${point.sourceId}。${OUTLET_POINT_WARNINGS[point.sourceId] ?? ""}` +
                (black && point.roomId === "bedroom-3" ? "三個 AC 端點沿用原三組插座／迴路額度；原 ID 僅為歷史識別，不代表目前服務該房冷氣，供應機組待電工指定。" : "") +
                (weak ? "原報弱電 7 條額度之一，端口不是一顆電力插座，也不是再次增加一條計費線路。" : ""),
        };
    });
    const circuits = points.filter((point) => point.outletPlanPointId.startsWith("B")).map((outlet) => {
        const quote = QUOTED_CIRCUITS.find((entry) => entry.outletId === outlet.id);
        const id = quote?.id ?? `circuit-${outlet.id}`;
        const previous = existing.get(id);
        if (previous && !isDedicatedCircuit(previous)) throw new Error(`迴路 ID 衝突：${id}`);
        return { ...createCircuitForSocket(outlet, id), ...structuredClone(previous ?? {}),
            id, roomId: outlet.roomId, circuitOutletId: outlet.id,
            placement: createCircuitForSocket(outlet, id).placement,
            name: `專用迴路－${outlet.name}`,
            note: `${OUTLET_DIAGRAM_CAUTION} 配對 ${outlet.outletPlanPointId}；此為配線額度，不是第二個實體供電端點。AC 服務機組與浴室原三合一改新風機是否可抵用均待核。`,
            ...(quote ? { quotedUnitPrice: DEDICATED_CIRCUIT_UNIT_PRICE_TWD, quotedQuantity: 1 } : {}),
        };
    });
    const retained = state.items.filter((item) =>
        !isSocket(item) && !isDedicatedCircuit(item) && !isWeakCurrent(item));
    return { state: { ...structuredClone(state), items: [...structuredClone(retained), ...points, ...circuits],
        undo: structuredClone({ rooms: state.rooms, items: state.items, products: state.products }) },
        changed: true, powerCount: 60, circuitCount: 9, weakCount: QUOTED_WEAK_CURRENT_IDS.length,
        removedUnmarkedIds: state.items.filter((item) =>
            (isSocket(item) || isDedicatedCircuit(item) || isWeakCurrent(item)) &&
            ![...points, ...circuits].some((next) => next.id === item.id)).map((item) => item.id),
    };
}

export function diagramPointSymbol(item) {
    const id = item.outletPlanPointId;
    if (!id) return "";
    if (!/^(R(?:0[1-9]|[1-4][0-9]|5[01])|B0[1-9]|C0[1-7])$/.test(id)) {
        throw new Error("無效的標位識別碼。");
    }
    const kind = id[0] === "R" ? "general" : id[0] === "B" ? "dedicated" : "weak";
    return `<g class="diagram-point diagram-${kind}">
        ${OUTLET_POINT_WARNINGS[id] ? `<title>${id}：${OUTLET_POINT_WARNINGS[id]}非施工核可。</title>
            <circle class="diagram-warning-ring" r="8"/>` : ""}
        ${kind === "weak" ? '<rect class="icon-diagram" x="-6" y="-6" width="12" height="12" rx="2"/>' :
            '<circle class="icon-diagram" r="6"/>'}
        <text class="diagram-point-label" style="font-size:4.5px" text-anchor="middle" y="1.5">${id}</text>
    </g>`;
}
