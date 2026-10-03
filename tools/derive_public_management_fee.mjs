import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { migratePublicManagementFee } from
    "../extensions/renovation-equipment/management-fee-migration.mjs";
import {
    encodeSave,
} from "../extensions/renovation-equipment/assets/file-actions.js";
import {
    summarize, validateState,
} from "../extensions/renovation-equipment/state.mjs";

const path = fileURLToPath(new URL("../files/設備規劃.json", import.meta.url));
const approvedSha256 =
    "413ae7ded2f07315" +
    "61630e032ec22c966850be87cc357a9c9f01b0f4407db1d6";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceBytes = await readFile(path);
assert.equal(hash(sourceBytes), approvedSha256,
    "公開匿名樣本已變動；不得套用舊的清潔費推導。");
const source = JSON.parse(sourceBytes);
assert.deepEqual([
    source.version, source.revision, source.undo,
    source.rooms.length, source.items.length, source.products.length,
    source.constructionCalendar.version,
    source.constructionCalendar.events.length,
    source.constructionCalendar.undo.length,
], [5, 0, null, 13, 182, 28, 2, 13, 12]);
assert.equal(summarize(source).originalQuoteTWD, 1_959_530);
assert.equal(summarize(source).overallTotals.TWD, 2_322_060.2);

const candidate = migratePublicManagementFee(source);
const { managementCleaningFee, ...unchanged } = candidate;
assert.deepEqual(unchanged, source);
assert.deepEqual(managementCleaningFee, {
    version: 1,
    fee: { start: "2026-10-13", end: "2027-01-30", dailyRate: 100 },
    undo: { fee: null },
});
assert.deepEqual(validateState(candidate).managementCleaningFee,
    managementCleaningFee);
assert.equal(JSON.parse(encodeSave(candidate)).formatVersion, 11);
assert.equal(summarize(candidate).managementFeeTotals.days, 110);
assert.equal(summarize(candidate).managementFeeTotals.sundays, 15);
assert.equal(summarize(candidate).managementFeeTotals.totalTWD, 11_000);
assert.equal(summarize(candidate).overallTotals.TWD, 2_333_060.2);
assert.equal(JSON.stringify(source, null, 2) + "\n",
    sourceBytes.toString("utf8"));

const text = JSON.stringify(candidate, null, 2) + "\n";
const temporary = `${path}.fee-${process.pid}.tmp`;
try {
    await writeFile(temporary, text, { encoding: "utf8", flag: "wx" });
    assert((await readFile(path)).equals(sourceBytes),
        "公開樣本在生成候選期間變動，拒絕覆寫。");
    await rename(temporary, path);
} finally {
    await rm(temporary, { force: true });
}
console.log(JSON.stringify({
    sourceSha256: hash(sourceBytes), candidateSha256: hash(text),
    changedTopLevel: ["managementCleaningFee"],
    fee: summarize(candidate).managementFeeTotals,
    originalQuoteTWD: 1_959_530,
    previousKnownTWD: 2_322_060.2, candidateKnownTWD: 2_333_060.2,
    newKnownTWD: 11_000, formatVersion: 11,
    stageCommitPush: false,
}, null, 2));
