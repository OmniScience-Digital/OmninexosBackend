// src/helper/jobcard/resultFormat.ts  (NEW FILE)
// Turns a submitted result into the text posted to ClickUp and Telegram. Pure.

export type ModuleType = 'INSPECTION' | 'ZERO_CALIBRATION' | 'SPAN_CALIBRATION';
export const MODULE_LABEL: Record<ModuleType, string> = {
  INSPECTION: 'Inspection',
  ZERO_CALIBRATION: 'Zero calibration',
  SPAN_CALIBRATION: 'Span calibration',
};

type Kind = 'text' | 'yesno' | 'yesnona' | 'num2' | 'percent';
interface Spec {
  key: string;
  label: string;
  kind?: Kind;
}

const INSPECTION: Spec[] = [
  { key: 'asFoundTotalizer', label: 'As found totalizer (tons)' },
  { key: 'asFoundSpanCoefficient', label: 'As found span coefficient' },
  { key: 'asFoundZeroValue', label: 'As found zero value' },
  { key: 'asFoundSpeedCoefficient', label: 'As found speed coefficient' },
  { key: 'asFoundMaxTph', label: 'As found max running (tph)', kind: 'num2' },
  { key: 'asFoundMinTph', label: 'As found min running (tph)', kind: 'num2' },
  { key: 'asFoundRunningSpeed', label: 'As found running speed (m/s)', kind: 'num2' },
  { key: 'partsAttached', label: 'All parts still attached', kind: 'yesno' },
  { key: 'weighframeClean', label: 'Weighframe free of dirt', kind: 'yesno' },
  { key: 'integratorPanelClean', label: 'Integrator panel free of dirt and water', kind: 'yesno' },
  { key: 'weighframeMovesFreely', label: 'Weighframe moves freely', kind: 'yesno' },
  { key: 'torsionRodsMoveFreely', label: 'Torsion rods move freely', kind: 'yesnona' },
  { key: 'rollersTurning', label: 'Rollers turning smoothly on an empty belt', kind: 'yesno' },
  { key: 'beltTracking', label: 'Belt tracking properly over the scale', kind: 'yesno' },
  { key: 'integratorOk', label: 'Integrator in good working order', kind: 'yesno' },
  { key: 'speedSensorOk', label: 'Speed sensor in good working order', kind: 'yesno' },
];
const ZERO: Spec[] = [{ key: 'newZeroValue', label: 'New zero value (points)' }];
const SPAN: Spec[] = [
  { key: 'offset', label: 'Offset (kg/m)', kind: 'num2' },
  { key: 'actual', label: 'Actual (kg/m)', kind: 'num2' },
  { key: 'indicated', label: 'Indicated (kg/m)', kind: 'num2' },
  { key: 'indicatedActual', label: 'Indicated actual (kg/m)', kind: 'num2' },
  { key: 'adjustmentRatio', label: 'Adjustment required', kind: 'percent' },
  { key: 'latestZeroUsed', label: 'Latest zero used (points)' },
  { key: 'latestSpanUsed', label: 'Latest span used (points)' },
  { key: 'newPotentialSpan', label: 'New potential span (points)', kind: 'num2' },
  { key: 'spanAdjusted', label: 'Span adjusted', kind: 'yesno' },
  { key: 'newSpan', label: 'New span (points)' },
];
const SPECS: Record<ModuleType, Spec[]> = {
  INSPECTION,
  ZERO_CALIBRATION: ZERO,
  SPAN_CALIBRATION: SPAN,
};

export function formatValue(value: unknown, kind: Kind = 'text'): string {
  if (value === null || value === undefined || value === '')
    return kind === 'yesnona' ? 'N/A' : '-';
  switch (kind) {
    case 'yesno':
    case 'yesnona':
      return value === true ? 'Yes' : value === false ? 'No' : String(value);
    case 'num2': {
      const n = Number(value);
      return Number.isFinite(n) ? n.toFixed(2) : String(value);
    }
    case 'percent': {
      const n = Number(value);
      return Number.isFinite(n) ? `${(n * 100).toFixed(2)} %` : String(value);
    }
    default:
      return String(value);
  }
}

export interface ResultLine {
  label: string;
  value: string;
}

/** Labelled rows for a result. Optional fields that were never filled in are left out. */
export function describeResult(type: ModuleType, payload: Record<string, unknown>): ResultLine[] {
  const out: ResultLine[] = [];
  for (const sp of SPECS[type] ?? []) {
    if (!(sp.key in payload) && sp.kind !== 'yesnona') continue;
    out.push({ label: sp.label, value: formatValue(payload[sp.key], sp.kind) });
  }
  return out;
}

export function countPhotos(payload: Record<string, unknown>): number {
  const photos = (payload.photos ?? {}) as Record<string, unknown>;
  return Object.values(photos).reduce<number>(
    (n, v) => n + (Array.isArray(v) ? v.length : v ? 1 : 0),
    0
  );
}

export interface ResultContext {
  jcNumber: string;
  customerName?: string;
  scaleName: string;
  moduleType: ModuleType;
  sequence?: number;
  submittedAt: string;
  submittedByName?: string;
  payload: Record<string, unknown>;
}

const sast = (iso: string) =>
  new Date(iso).toLocaleString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

/** Telegram uses legacy Markdown in TelegramService, where _ * ` [ would break a message. */
export const escapeTelegramMarkdown = (s: string): string => s.replace(/([_*`[])/g, '\\$1');

export function formatForTelegram(c: ResultContext): string {
  const e = escapeTelegramMarkdown;
  const lines = describeResult(c.moduleType, c.payload).map(
    (l) => `${e(l.label)}: *${e(l.value)}*`
  );
  const photos = countPhotos(c.payload);
  return [
    `*${e(MODULE_LABEL[c.moduleType])}${c.sequence ? ` #${c.sequence}` : ''} completed*`,
    `${e(c.jcNumber)}${c.customerName ? ` - ${e(c.customerName)}` : ''}`,
    `Scale: ${e(c.scaleName)}`,
    `${sast(c.submittedAt)}${c.submittedByName ? ` by ${e(c.submittedByName)}` : ''}`,
    '',
    ...lines,
    ...(photos ? [`Photos: ${photos}`] : []),
  ].join('\n');
}

/** ClickUp comments accept markdown; plain lines are enough. */
export function formatForClickUp(c: ResultContext): string {
  const lines = describeResult(c.moduleType, c.payload).map((l) => `${l.label}: ${l.value}`);
  const photos = countPhotos(c.payload);
  return [
    `${MODULE_LABEL[c.moduleType]}${c.sequence ? ` #${c.sequence}` : ''} completed - ${c.jcNumber}`,
    `Scale: ${c.scaleName}`,
    `${sast(c.submittedAt)}${c.submittedByName ? ` by ${c.submittedByName}` : ''}`,
    '',
    ...lines,
    ...(photos ? [`Photos: ${photos}`] : []),
  ].join('\n');
}
