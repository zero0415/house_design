export const DOOR_ALLOCATION_VERSION = 1;
export const DOOR_ALLOCATION_IDS = Object.freeze([
    "door-balcony", "door-bedroom-3-studio",
    "track-main-bath-hall", "track-bedroom-3-studio",
]);
export const DOOR_TRACK_CAUTION =
    "原報「滑門軌道－主浴.工作室」1.6米×1,800元＝2,880元；" +
    "屋主暫改分臥室2、臥室3↔工作室各0.8米，長度未丈量。" +
    "兩組木纖滑門19,000元原稱含緩衝軌道／軌道盒，與另列軌道額度可能重複，" +
    "須廠商核對；保留歷史含項，不新增重複費用、不自動退費，非施工核可。";

export const isAllocatedDoorItem = (item) =>
    item?.doorQuoteAllocation === DOOR_ALLOCATION_VERSION;
export const isUnquotedBalconyDoor = (item) =>
    isAllocatedDoorItem(item) && item.id === "door-balcony";
export const isQuotedDoor = (item) =>
    item?.kind === "door" && !isUnquotedBalconyDoor(item);

export function hasDoorAllocation(state) {
    return [state?.items, state?.undo?.items].some((items) =>
        items?.some((item) => Object.hasOwn(item, "doorQuoteAllocation")));
}

export function guardDoorAllocationUpdate(current, candidate) {
    if ((hasDoorAllocation(current) || hasDoorAllocation(candidate)) &&
        candidate?.doorAllocationVersion !== DOOR_ALLOCATION_VERSION) {
        throw new TypeError(
            "此存檔含門片／軌道額度重歸屬（含復原）；請重新載入支援此功能的版本，舊版不能寫入。"
        );
    }
}

export function allocatedTrackDefinition(item, original) {
    return isAllocatedDoorItem(item) && item.id === "track-main-bath-hall"
        ? { ...original, roomId: "bedroom-2", doorId: "bedroom-2",
            name: "滑門軌道－臥室2（原主浴額度暫移）" }
        : original;
}

export function validateDoorAllocation(items) {
    const tagged = items.filter((item) =>
        Object.hasOwn(item, "doorQuoteAllocation"));
    if (!tagged.length) {
        if (items.some((item) => item.doorId === "bedroom-3-studio")) {
            throw new TypeError(
                "新增工作室滑門須連同陽台與兩筆軌道完整重歸屬，不可重複新增19,000元。"
            );
        }
        return;
    }
    if (tagged.length !== DOOR_ALLOCATION_IDS.length ||
        tagged.some((item) => !isAllocatedDoorItem(item) ||
            !DOOR_ALLOCATION_IDS.includes(item.id)) ||
        !DOOR_ALLOCATION_IDS.every((id) =>
            tagged.some((item) => item.id === id))) {
        throw new TypeError(
            "門片／軌道額度重歸屬缺漏或版本無效，拒絕部分套用。"
        );
    }
    const baselines = new Map([
        ["master", 14000], ["main-bath-master", 14000],
        ["bedroom-1", 10500], ["studio", 10500], ["bedroom-3", 10500],
        ["main-bath-hall", 8500], ["guest-bath", 8500],
        ["main-shower", 0], ["guest-shower", 0],
        ["bedroom-2", 19000], ["balcony", 0],
        ["bedroom-3-studio", 19000],
    ]);
    const doors = items.filter((item) => item.kind === "door");
    if (doors.length !== baselines.size ||
        new Set(doors.map((item) => item.doorId)).size !== baselines.size ||
        doors.some((item) => item.id !== `door-${item.doorId}` ||
            item.quotedUnitPrice !== baselines.get(item.doorId) ||
            item.quotedQuantity !== 1)) {
        throw new TypeError(
            "重歸屬方案須保留完整且不重複的門位與原門片114,500元歷史基準。"
        );
    }
    for (const [id, doorId, roomId, baseline] of [
        ["door-balcony", "balcony", "studio", 0],
        ["door-bedroom-3-studio", "bedroom-3-studio", "studio", 19000],
        ["door-bedroom-2", "bedroom-2", "bedroom-2", 19000],
    ]) {
        const door = items.find((entry) => entry.id === id);
        if (!door || door.kind !== "door" || door.doorId !== doorId ||
            door.roomId !== roomId || door.quotedUnitPrice !== baseline ||
            door.quotedQuantity !== 1) {
            throw new TypeError(
                "門片歷史額度須為臥室2與工作室各19,000元；陽台額度已移轉，不可重複或遺漏。"
            );
        }
    }
    for (const [id, roomId, doorId] of [
        ["track-main-bath-hall", "bedroom-2", "bedroom-2"],
        ["track-bedroom-3-studio", "studio", "bedroom-3-studio"],
    ]) {
        const track = items.find((item) => item.id === id);
        if (!track || track.kind !== "equipment" || track.roomId !== roomId ||
            track.trackDoorId !== doorId || track.quotedQuantity !== .8 ||
            track.quotedUnitPrice !== 1800) {
            throw new TypeError(
                "原報1.6米軌道須暫分兩道木纖滑門各0.8米，不可新增或扣除歷史額度。"
            );
        }
    }
}
