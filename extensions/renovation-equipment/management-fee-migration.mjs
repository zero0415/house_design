import { isDeepStrictEqual } from "node:util";
import { validateState } from "./state.mjs";
import {
    APPROVED_MANAGEMENT_FEE, editManagementFee, hasManagementFee,
} from "./assets/management-fee.js";

const PUBLIC_SAMPLE_FIELDS = [
    "version", "revision", "updatedAt", "rooms", "items",
    "products", "undo", "constructionCalendar",
];

export function migratePublicManagementFee(source) {
    const keys = Object.keys(source ?? {});
    if (keys.length !== PUBLIC_SAMPLE_FIELDS.length &&
            keys.length !== PUBLIC_SAMPLE_FIELDS.length + 1 ||
        PUBLIC_SAMPLE_FIELDS.some((key) => !Object.hasOwn(source, key)) ||
        keys.some((key) => key !== "managementCleaningFee" &&
            !PUBLIC_SAMPLE_FIELDS.includes(key))) {
        throw new TypeError("來源須為完整匿名 v5 存檔，不得加入其他欄位。");
    }
    const before = structuredClone(source);
    const validated = validateState(source);
    if (!isDeepStrictEqual(source, before)) {
        throw new TypeError("驗證不應修改來源存檔。");
    }
    if (hasManagementFee(source)) return before;

    // Validation normalizes some existing public equipment fields in memory;
    // keep their published serialized values unchanged in the new sample.
    const candidate = {
        ...before,
        managementCleaningFee: editManagementFee(
            undefined, APPROVED_MANAGEMENT_FEE),
    };
    const { managementCleaningFee, ...unchanged } = validateState(candidate);
    if (!isDeepStrictEqual(unchanged, validated) ||
        !isDeepStrictEqual(
            managementCleaningFee, candidate.managementCleaningFee)) {
        throw new TypeError("加入清潔費時不得變更原有規劃資料。");
    }
    return candidate;
}
