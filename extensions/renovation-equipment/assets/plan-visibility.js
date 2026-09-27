import { isDedicatedCircuit } from "./socket-plan.js";

export function planDisplayCategory(item) {
    if (!item || typeof item !== "object") {
        throw new TypeError("格局圖物件分類需要有效的設備資料。");
    }
    if (item.kind === "door") return "structure";
    if (item.lightType != null) return "lights";
    if (item.switchType != null) return "switches";
    if (item.outletCircuit != null || isDedicatedCircuit(item)) return "outlets";
    if (item.equipmentCategory != null) return item.equipmentCategory;
    const name = typeof item.name === "string" ? item.name : "";
    if (/插座|電源插孔/.test(name)) return "outlets";
    if (/開關/.test(name)) return "switches";
    if (/燈|照明/.test(name)) return "lights";
    return "furniture";
}
