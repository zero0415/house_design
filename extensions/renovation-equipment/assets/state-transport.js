import { PLANNER_STATE_VERSION } from "./socket-plan.js";
import { CONTROL_RELATIONS_VERSION } from "./circuit-preview.js";
import { DOOR_ALLOCATION_VERSION } from "./door-allocation.js";

export function isPortableMode() {
    return Boolean(globalThis.__RENOVATION_OFFLINE_STORE__);
}

export async function readPlannerState() {
    let result;
    if (isPortableMode()) {
        result = await globalThis.__RENOVATION_OFFLINE_STORE__.read();
    } else {
        const response = await fetch("/api/state", { cache: "no-store" });
        result = await response.json();
        if (!response.ok) throw new Error(result.error || "無法讀取設備資料。");
    }
    if (result.products !== undefined && !Array.isArray(result.products)) {
        throw new TypeError("物件資料庫格式錯誤，未載入設備清單。");
    }
    if (result.version !== PLANNER_STATE_VERSION) {
        throw new TypeError("設備資料版本不相容，請重新載入新版規劃器。");
    }
    return { ...result, products: result.products ?? [] };
}

export async function writePlannerState(payload) {
    payload = {
        ...payload, controlRelationsVersion: CONTROL_RELATIONS_VERSION,
        doorAllocationVersion: DOOR_ALLOCATION_VERSION,
    };
    if (isPortableMode()) {
        return globalThis.__RENOVATION_OFFLINE_STORE__.update(payload);
    }
    const response = await fetch("/api/state", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
    });
    const result = await response.json();
    if (!response.ok) {
        const error = new Error(result.error || "儲存失敗。");
        error.conflict = response.status === 409;
        throw error;
    }
    return result;
}
