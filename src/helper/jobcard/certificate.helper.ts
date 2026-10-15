// src/helper/jobcard/certificate.helper.ts  (NEW FILE)
// Certificate numbering and the "does this scale need a certificate now?" decision. Pure.
import { CALIBRATION_TYPES } from './jobcard.config';

export const CERTIFICATE_PREFIX = 'CRT-';

/** CRT-000123. Plain sequence: it does not restart each year. */
export const formatCertificateNumber = (n: number): string =>
  `${CERTIFICATE_PREFIX}${String(n).padStart(6, '0')}`;

export interface ModuleLite {
  id: string;
  scaleId: string;
  moduleType: string;
  status: string;
}
export interface SubmissionLite {
  id: string;
  moduleId: string;
  submittedAt: string;
}
export interface CertLite {
  id: string;
  status: string;
  version: number;
  sourceSubmissionIds: string[];
  pdfStored?: boolean;
}

export type CertificatePlan =
  | { action: 'none'; reason: string }
  | { action: 'resume'; certificate: CertLite }
  | { action: 'issue'; sourceSubmissionIds: string[]; version: number; supersede: string[] };

/**
 * One certificate per scale, issued when EVERY Zero and Span work item on that scale is submitted
 * (inspections do not count). It is built from the latest result of each of those work items.
 *  - same results already certified and stored  -> nothing to do
 *  - same results, number reserved but PDF missing -> resume (reuse the reserved number: no gaps)
 *  - results changed (a corrected result)           -> new version, the old one is superseded
 */
export function planCertificate(
  scaleModules: ModuleLite[],
  submissions: SubmissionLite[],
  existing: CertLite[]
): CertificatePlan {
  const calibration = scaleModules.filter((m) =>
    (CALIBRATION_TYPES as readonly string[]).includes(m.moduleType)
  );
  if (calibration.length === 0)
    return { action: 'none', reason: 'no calibration work on this scale' };
  if (calibration.some((m) => m.status !== 'SUBMITTED'))
    return { action: 'none', reason: 'calibration work still pending' };

  const sourceIds: string[] = [];
  for (const m of calibration) {
    const latest = submissions
      .filter((s) => s.moduleId === m.id)
      .sort((a, b) => Date.parse(b.submittedAt) - Date.parse(a.submittedAt))[0];
    if (!latest) return { action: 'none', reason: `no result found for work item ${m.id}` };
    sourceIds.push(latest.id);
  }
  sourceIds.sort();

  const issued = existing.filter((c) => c.status === 'ISSUED');
  const same = issued.find((c) => sameSet(c.sourceSubmissionIds, sourceIds));
  if (same)
    return same.pdfStored === false
      ? { action: 'resume', certificate: same }
      : { action: 'none', reason: 'already issued' };

  const version = existing.reduce((max, c) => Math.max(max, c.version || 0), 0) + 1;
  return {
    action: 'issue',
    sourceSubmissionIds: sourceIds,
    version,
    supersede: issued.map((c) => c.id),
  };
}

const sameSet = (a: string[], b: string[]) =>
  a.length === b.length && [...a].sort().every((x, i) => x === [...b].sort()[i]);

export const certificateRowId = (scaleId: string, version: number): string =>
  `${scaleId}#v${version}`;
export const certificatePdfKey = (jobCardId: string, number: string): string =>
  `jobcards/${jobCardId}/certificates/${number}.pdf`;
