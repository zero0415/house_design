import { assertReviewedPublicState } from "./door-migration.mjs";
import { customEquipment } from "./assets/equipment-catalog.js";
import {
    ROBOT_CAUTION, ROBOT_ID, ROBOT_LABEL, ROBOT_SYMBOL_SIZE, ROBOT_TAG,
} from "./assets/robot-plan.js";
import {
    itemFootprint, markerPosition, planDoors, roomGeometry,
} from "./assets/floorplan.js";
import { footprintFits } from "./assets/house-geometry.js";
import { planDisplayCategory } from "./assets/plan-visibility.js";
import { summarize, validateState } from "./state.mjs";

const intersects = (a, b) =>
    Math.abs(a.x - b.x) * 2 < a.width + b.width &&
    Math.abs(a.y - b.y) * 2 < a.height + b.height;

export function robotProvisionalPosition(state) {
    const room = state.rooms.find((entry) => entry.id === "living-dining");
    const door = state.items.find((entry) => entry.id === "door-main-bath-hall");
    const opening = planDoors.find((entry) => entry.id === "main-bath-hall");
    if (!room || !opening || door?.doorId !== opening.id ||
        door.doorOpeningKind !== "swing" || door.doorMaterial !== "bathroom") {
        throw new Error(
            "主浴入口門型或客餐廳資料已不同；須重新審閱乾側暫位，不猜放置位置。"
        );
    }
    const geometry = roomGeometry(room);
    const center = { x: 535, y: 850 };
    const symbol = {
        ...center, width: ROBOT_SYMBOL_SIZE, height: ROBOT_SYMBOL_SIZE,
    };
    if (!footprintFits(geometry, center.x, center.y,
        ROBOT_SYMBOL_SIZE, ROBOT_SYMBOL_SIZE)) {
        throw new Error("掃拖機暫位符號超出客餐廳乾側輪廓，須重新審閱。");
    }
    const length = door.widthCm ?
        door.widthCm * geometry.cmScale : opening.length;
    const swing = {
        x: opening.x + length / 2, y: opening.y,
        width: length, height: length,
    };
    if (intersects(symbol, swing)) {
        throw new Error("掃拖機暫位符號與目前主浴門弧相交，須重新審閱。");
    }
    for (const item of state.items.filter((entry) =>
        entry.roomId === room.id && entry.placement &&
        planDisplayCategory(entry) === "furniture")) {
        const bounds = {
            ...markerPosition(item, geometry),
            ...itemFootprint(item, geometry),
        };
        if (intersects(symbol, bounds)) {
            throw new Error(
                `掃拖機暫位與「${item.name}」圖例重疊；保留原擺位，須重新審閱。`
            );
        }
    }
    return {
        x: (center.x - geometry.x) / geometry.width,
        y: (center.y - geometry.y) / geometry.height,
    };
}

export function migrateRobotPlan(latest) {
    if (latest?.version !== 5) {
        throw new TypeError("掃拖機新增須使用最新的公開 v5 資料。");
    }
    assertReviewedPublicState(latest);
    const existing = latest.items.find((item) => item.id === ROBOT_ID);
    if (existing) {
        if (existing.kind !== "equipment" ||
            !existing.note.includes(ROBOT_TAG)) {
            throw new Error("掃拖機識別碼已被其他用途占用，不覆蓋。");
        }
        return {
            state: structuredClone(latest), changed: false,
            addedItems: 0, addedProducts: 0,
            changedItemIds: [], deltaTWD: 0,
        };
    }
    if (latest.undo?.items.some((item) => item.id === ROBOT_ID)) {
        throw new Error("復原點已有掃拖機；可能由屋主刪除，不自動重新加入。");
    }
    if (latest.items.some((item) => item.note.includes(ROBOT_TAG) ||
        /掃地|掃拖|拖地|吸塵|vacuum|robot/i.test(item.name) &&
            !item.outletCircuit && !item.circuitOutletId)) {
        throw new Error("已有掃拖機或部分新增標記，拒絕重複建立。");
    }
    const next = structuredClone(latest);
    const robot = customEquipment({
        roomId: "living-dining", customType: "equipment",
        name: ROBOT_LABEL, unit: "台", quantity: 1,
        unitPrice: "", model: "",
        priceSource: "條件式需求，機型、基座、材料及安裝均未報價",
        note: `${ROBOT_TAG} ${ROBOT_CAUTION}`,
    }, ROBOT_ID);
    Object.assign(robot, {
        brandModel: null, widthCm: null, depthCm: null,
        heightCm: null, productId: null, unitPrice: null,
        installationUnitPrice: null,
        priceSource: "規劃需求｜掃拖機／自動上下水（機器、基座及施工未報價；原報未含）",
        equipmentCategory: null, markerStyle: null,
        outletCircuit: null, circuitOutletId: null,
        placement: robotProvisionalPosition(latest), orientation: 0,
    });
    next.items.push(robot);
    next.undo = structuredClone({
        rooms: latest.rooms, items: latest.items, products: latest.products,
    });
    const normalized = validateState(next);
    next.items[next.items.length - 1] =
        normalized.items.find((item) => item.id === ROBOT_ID);
    assertReviewedPublicState(next);
    return {
        state: next, changed: true, addedItems: 1, addedProducts: 0,
        changedItemIds: [ROBOT_ID],
        deltaTWD: summarize(next).overallTotals.TWD -
            summarize(latest).overallTotals.TWD,
    };
}
