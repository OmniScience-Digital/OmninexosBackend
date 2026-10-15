// src/helper/jobcard/certificate.helper.ts  (NEW FILE)
// Certificate numbering and the "does this scale need a certificate now?" decision. Pure.
import { CALIBRATION_TYPES } from "./jobcard.config.js";
export const CERTIFICATE_PREFIX = "CRT-";
/** CRT-000123. Plain sequence: it does not restart each year. */
export const formatCertificateNumber = (n) => `${CERTIFICATE_PREFIX}${String(n).padStart(6, "0")}`;
/**
 * One certificate per scale, issued when EVERY Zero and Span work item on that scale is submitted
 * (inspections do not count). It is built from the latest result of each of those work items.
 *  - same results already certified and stored  -> nothing to do
 *  - same results, number reserved but PDF missing -> resume (reuse the reserved number: no gaps)
 *  - results changed (a corrected result)           -> new version, the old one is superseded
 */
export function planCertificate(scaleModules, submissions, existing) {
    const calibration = scaleModules.filter((m) => CALIBRATION_TYPES.includes(m.moduleType));
    if (calibration.length === 0)
        return { action: "none", reason: "no calibration work on this scale" };
    if (calibration.some((m) => m.status !== "SUBMITTED"))
        return { action: "none", reason: "calibration work still pending" };
    const sourceIds = [];
    for (const m of calibration) {
        const latest = submissions
            .filter((s) => s.moduleId === m.id)
            .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))[0];
        if (!latest)
            return { action: "none", reason: `no result found for work item ${m.id}` };
        sourceIds.push(latest.id);
    }
    sourceIds.sort();
    const issued = existing.filter((c) => c.status === "ISSUED");
    const same = issued.find((c) => sameSet(c.sourceSubmissionIds, sourceIds));
    if (same)
        return same.pdfStored === false
            ? { action: "resume", certificate: same }
            : { action: "none", reason: "already issued" };
    const version = existing.reduce((max, c) => Math.max(max, c.version || 0), 0) + 1;
    return {
        action: "issue",
        sourceSubmissionIds: sourceIds,
        version,
        supersede: issued.map((c) => c.id),
    };
}
const sameSet = (a, b) => a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);
export const certificateRowId = (scaleId, version) => `${scaleId}#v${version}`;
export const certificatePdfKey = (jobCardId, number) => `jobcards/${jobCardId}/certificates/${number}.pdf`;
