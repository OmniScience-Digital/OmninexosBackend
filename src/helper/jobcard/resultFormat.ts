// src/helper/jobcard/resultFormat.ts
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

const PHOTO_LABEL: Record<string, string> = {
  speedSensor: 'Speed sensor',
  integratorPanel: 'Integrator panel',
  scale: 'Scale photo',
  zero: 'Zero',
  offset: 'Offset',
  actual: 'Actual',
  indicated: 'Indicated',
};

export interface PhotoEntry {
  key: string;
  label: string;
}

/**
 * Extra context to append to each photo label:
 *   "Actual" → "Actual — Avery 1064 — 22 Oct 2026"
 * Both fields are optional; whatever is provided is joined with " — ".
 */
export interface PhotoLabelContext {
  scaleName?: string;
  /** ISO timestamp of the submission, e.g. sub.submittedAt */
  submittedAt?: string;
}

const sastDateOnly = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString('en-ZA', {
    timeZone: 'Africa/Johannesburg',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

/** Every photo in a result as storage key + a readable name, in a stable order. */
export function photoEntries(
  payload: Record<string, unknown>,
  ctx?: PhotoLabelContext
): PhotoEntry[] {
  const photos = (payload.photos ?? {}) as Record<string, unknown>;

  const suffixParts: string[] = [];
  if (ctx?.scaleName) suffixParts.push(ctx.scaleName);
  if (ctx?.submittedAt) {
    const d = sastDateOnly(ctx.submittedAt);
    if (d) suffixParts.push(d);
  }
  const suffix = suffixParts.join(' — ');
  const decorate = (base: string) => (suffix ? `${base} — ${suffix}` : base);

  const out: PhotoEntry[] = [];
  for (const [field, value] of Object.entries(photos)) {
    const keys = (Array.isArray(value) ? value : [value]).filter(
      (k): k is string => typeof k === 'string' && k.length > 0
    );
    const base =
      PHOTO_LABEL[field] ?? field.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase());
    keys.forEach((key, i) =>
      out.push({
        key,
        label: decorate(keys.length > 1 ? `${base} ${i + 1}` : base),
      })
    );
  }
  return out;
}

export interface ResultContext {
  jcNumber: string;
  customerName?: string;
  scaleName: string;
  moduleType: ModuleType;
  sequence?: number;
  submittedAt: string;
  submittedByName?: string;
  /** 2 or more when the technician edited finished work: it is a new result, not a change to the old one */
  revision?: number;
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
    `*${e(MODULE_LABEL[c.moduleType])}${c.sequence ? ` #${c.sequence}` : ''} ${e(
      c.revision && c.revision > 1 ? `updated (revision ${c.revision})` : 'completed'
    )}*`,
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
    `${MODULE_LABEL[c.moduleType]}${c.sequence ? ` #${c.sequence}` : ''} ${
      c.revision && c.revision > 1 ? `updated (revision ${c.revision})` : 'completed'
    } - ${c.jcNumber}`,
    `Scale: ${c.scaleName}`,
    `${sast(c.submittedAt)}${c.submittedByName ? ` by ${c.submittedByName}` : ''}`,
    '',
    ...lines,
    ...(photos ? [`Photos: ${photos}`] : []),
  ].join('\n');
}

/** Posted once per job card, when the whole scope of work is done. */
export function formatTotalTimeForTelegram(c: {
  jcNumber: string;
  customerName?: string;
  totalText: string;
  people: { name: string; text: string }[];
}): string {
  const e = escapeTelegramMarkdown;
  return [
    `*Job card complete*`,
    `${e(c.jcNumber)}${c.customerName ? ` - ${e(c.customerName)}` : ''}`,
    ``,
    `Total time: *${e(c.totalText)}*`,
    ...c.people.map((p) => `${e(p.name)}: ${e(p.text)}`),
  ].join('\n');
}
