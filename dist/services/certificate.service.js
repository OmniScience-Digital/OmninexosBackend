// src/services/certificate.service.ts  (NEW FILE)
// Issues calibration certificates: allocates the next CRT- number, builds the PDF, stores it in S3 and records
// the row. Switched OFF until CERTIFICATES_ENABLED=true, because the PDF layout is not approved yet.
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import logger from "../utils/logger.js";
import { certificatePdfKey, certificateRowId, formatCertificateNumber, planCertificate, } from "../helper/jobcard/certificate.helper.js";
import { CALIBRATION_TYPES } from "../helper/jobcard/jobcard.config.js";
import { describeResult, MODULE_LABEL, } from "../helper/jobcard/resultFormat.js";
const parsePayload = (p) => {
    try {
        const v = typeof p === "string" ? JSON.parse(p) : p;
        return v && typeof v === "object" ? v : {};
    }
    catch {
        return {};
    }
};
/** Returns what happened for this scale: nothing needed, a new certificate, or an unfinished one completed. */
export async function issueCertificateIfReady(scaleId, jobCard, deps) {
    const { repo } = deps;
    const modules = (await repo.listModules(jobCard.id)).filter((m) => m.scaleId === scaleId);
    const calibration = modules.filter((m) => CALIBRATION_TYPES.includes(m.moduleType));
    const resultsByModule = new Map(); // newest first
    for (const m of calibration)
        resultsByModule.set(m.id, await repo.listSubmissionsByModule(m.id));
    const existingRows = await repo.listCertificatesByScale(scaleId);
    const existing = existingRows.map((r) => ({
        id: r.id,
        status: r.status,
        version: Number(r.version) || 0,
        sourceSubmissionIds: Array.isArray(r.sourceSubmissionIds) ? r.sourceSubmissionIds : [],
        pdfStored: r.pdfStored,
    }));
    const plan = planCertificate(modules.map((m) => ({
        id: m.id,
        scaleId: m.scaleId,
        moduleType: m.moduleType,
        status: m.status,
    })), [...resultsByModule.values()]
        .flat()
        .map((s) => ({ id: s.id, moduleId: s.moduleId, submittedAt: s.submittedAt })), existing);
    if (plan.action === "none")
        return "none";
    const scale = await repo.getScale(scaleId);
    const scaleName = scale?.scaleName ?? scaleId;
    const sourceIds = plan.action === "issue" ? plan.sourceSubmissionIds : plan.certificate.sourceSubmissionIds;
    const dataFor = (certificateNumber, issuedAt) => ({
        certificateNumber,
        issuedAt,
        jcNumber: jobCard.jcNumber ?? jobCard.id,
        customerName: jobCard.customerName,
        scaleName,
        results: calibration
            .map((m) => {
            const sub = (resultsByModule.get(m.id) ?? []).find((s) => sourceIds.includes(s.id));
            return sub
                ? {
                    order: `${m.moduleType}-${String(m.sequence ?? 0).padStart(4, "0")}`,
                    title: `${MODULE_LABEL[m.moduleType]} #${m.sequence ?? 1}`,
                    submittedAt: sub.submittedAt,
                    lines: describeResult(m.moduleType, parsePayload(sub.payload)),
                }
                : null;
        })
            .filter((x) => x !== null)
            .sort((a, b) => a.order.localeCompare(b.order))
            .map(({ title, submittedAt, lines }) => ({ title, submittedAt, lines })),
    });
    let rowId;
    let number;
    let issuedAt;
    let supersede;
    let outcome;
    if (plan.action === "issue") {
        number = formatCertificateNumber(await repo.nextCertificateNumber());
        issuedAt = deps.now().toISOString();
        rowId = certificateRowId(scaleId, plan.version);
        const data = dataFor(number, issuedAt);
        // Reserve the number first (PDF not stored yet): if anything below fails, the next run resumes this very
        // row and reuses its number, so numbers are never wasted or duplicated.
        const reserved = await repo.reserveCertificate({
            id: rowId,
            certificateNumber: number,
            jobCardId: jobCard.id,
            scaleId,
            status: "ISSUED",
            version: plan.version,
            issuedAt,
            issuedBy: "system",
            sourceSubmissionIds: plan.sourceSubmissionIds,
            dataSnapshot: JSON.stringify(data),
            pdfKey: certificatePdfKey(jobCard.id, number),
            pdfStored: false,
            createdAt: issuedAt,
            updatedAt: issuedAt,
        });
        if (!reserved)
            return "none"; // another worker got there first
        supersede = plan.supersede;
        outcome = "issued";
    }
    else {
        const row = existingRows.find((r) => r.id === plan.certificate.id);
        rowId = row.id;
        number = row.certificateNumber;
        issuedAt = row.issuedAt;
        supersede = existing
            .filter((c) => c.status === "ISSUED" && c.id !== rowId && c.version < plan.certificate.version)
            .map((c) => c.id);
        outcome = "resumed";
    }
    const pdf = await deps.render(dataFor(number, issuedAt));
    await deps.upload(certificatePdfKey(jobCard.id, number), pdf);
    await repo.updateCertificate(rowId, { pdfStored: true });
    // Only now retire older versions, so there is always one certificate that can be downloaded.
    for (const id of supersede)
        await repo.updateCertificate(id, { status: "SUPERSEDED" });
    logger.info(`Certificate ${number} ${outcome} for scale ${scaleName} (${jobCard.jcNumber ?? jobCard.id})`);
    return outcome;
}
// ---------- production wiring ----------
// Standard PDF fonts only cover WinAnsi: turn typographic punctuation into plain equivalents, then drop the rest.
const sanitize = (s) => s
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, "\"")
    .replace(/[\u2013\u2014]/g, "-")
    .replace(/\u2026/g, "...")
    .replace(/[^\x20-\x7E\xA0-\xFF]/g, "?");
/**
 * PLACEHOLDER LAYOUT. A plain, readable certificate so the whole pipeline (numbering, PDF, storage, download)
 * works end to end. Replace this function when the real layout (logo, signature, company details) is approved.
 * Needs the `pdf-lib` package: npm install pdf-lib
 */
export async function renderCertificatePdf(data) {
    const moduleName = "pdf-lib"; // variable import: the server still starts if the package is not installed yet
    const { PDFDocument, StandardFonts, rgb } = (await import(moduleName));
    const doc = await PDFDocument.create();
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    const W = 595.28, H = 841.89, M = 50;
    let page = doc.addPage([W, H]);
    let y = H - M;
    const ensure = (need) => {
        if (y - need < M + 20) {
            page = doc.addPage([W, H]);
            y = H - M;
        }
    };
    const line = (t, size = 10, f = font, color = rgb(0, 0, 0), x = M) => {
        ensure(size + 6);
        page.drawText(sanitize(t), { x, y: y - size, size, font: f, color });
        y -= size + 6;
    };
    const when = (iso) => new Date(iso).toLocaleString("en-ZA", {
        timeZone: "Africa/Johannesburg",
        day: "2-digit",
        month: "long",
        year: "numeric",
    });
    line("CALIBRATION CERTIFICATE", 20, bold);
    y -= 4;
    line(`Certificate number: ${data.certificateNumber}`, 12, bold);
    line(`Date: ${when(data.issuedAt)}`);
    line(`Job card: ${data.jcNumber}`);
    if (data.customerName)
        line(`Customer: ${data.customerName}`);
    line(`Scale: ${data.scaleName}`);
    y -= 10;
    for (const r of data.results) {
        ensure(40);
        line(`${r.title}  (${when(r.submittedAt)})`, 12, bold);
        for (const l of r.lines) {
            ensure(16);
            page.drawText(sanitize(l.label), {
                x: M,
                y: y - 10,
                size: 10,
                font,
                color: rgb(0.25, 0.25, 0.25),
            });
            page.drawText(sanitize(l.value), { x: M + 300, y: y - 10, size: 10, font: bold });
            y -= 16;
        }
        y -= 8;
    }
    for (const p of doc.getPages()) {
        p.drawText(sanitize(`${data.certificateNumber}  -  draft layout, not approved for release`), {
            x: M,
            y: 28,
            size: 8,
            font,
            color: rgb(0.5, 0.5, 0.5),
        });
    }
    return doc.save();
}
export async function uploadCertificatePdf(key, body) {
    const bucket = process.env.JOBCARD_BUCKET;
    if (!bucket)
        throw new Error("JOBCARD_BUCKET is not set");
    const s3 = new S3Client({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
    });
    await s3.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: "application/pdf" }));
}
