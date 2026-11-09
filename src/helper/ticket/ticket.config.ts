// src/helper/ticket/ticket.config.ts
// TICKETING: every setting for the task / ticket system in one place.
// See TICKETING.md in the project root for the environment variables and set-up steps.

export const TABLE_ENV = {
  ticket: 'TICKET_TABLE', // the Amplify "Ticket" table
  counter: 'TICKET_COUNTER_TABLE', // the Amplify "TicketCounter" table
} as const;
export type TableKey = keyof typeof TABLE_ENV;

export function table(key: TableKey): string {
  const name = process.env[TABLE_ENV[key]];
  if (!name) throw new Error(`${TABLE_ENV[key]} is not set`);
  return name;
}

/** Index names exactly as Amplify generates them (see amplify/data/ticketing.models.ts). */
export const INDEX = {
  ticketsByStatus: 'ticketsByStatusAndSubmittedAt',
  ticketsByNumber: 'ticketsByTicketNumber',
} as const;

/** The flow only runs once everything it needs is configured, so deploying early is harmless. */
export const ticketFlowEnabled = (): boolean =>
  Boolean(
    process.env.TICKET_TABLE &&
    process.env.TICKET_COUNTER_TABLE &&
    process.env.TICKET_CLICKUP_LIST_ID &&
    process.env.TASKING_TELEGRAM_CHAT_ID &&
    process.env.CLICKUP_API_TOKEN
  );

// ---------------------------------------------------------------------------------------------
// Urgency (the radio group on the form). Values are business minutes. Keep in step with
// URGENCY_OPTIONS in the web app (src/types/ticket.types.ts).
// ASAP has no duration: it is due as soon as work can happen (see businessTime.addBusinessMinutes)
// and is escalated on the first check inside business hours.
// ---------------------------------------------------------------------------------------------
export const URGENCY_MINUTES: Readonly<Record<string, number>> = {
  ASAP: 0,
  '1H': 60,
  '2H': 120,
  '4H': 240,
  '16H': 16 * 60,
  '27H': 27 * 60,
};

export const isKnownUrgency = (value: unknown): value is string =>
  typeof value === 'string' && Object.prototype.hasOwnProperty.call(URGENCY_MINUTES, value);

// ---------------------------------------------------------------------------------------------
// Business hours. Every day of the week, 06:00 to 17:00 Johannesburg time. Anything that runs
// past the end of the day carries over to 06:00 the next day. Override with TICKET_BUSINESS_START
// / TICKET_BUSINESS_END ("HH:mm") if the hours change.
// ---------------------------------------------------------------------------------------------
export interface BusinessCalendar {
  zone: string;
  startMinute: number; // minutes after midnight
  endMinute: number;
}

export function parseClock(value: string): number {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) throw new Error(`Bad time "${value}", expected HH:mm`);
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 24 || min > 59 || (h === 24 && min !== 0)) throw new Error(`Bad time "${value}"`);
  return h * 60 + min;
}

export function getBusinessCalendar(env: NodeJS.ProcessEnv = process.env): BusinessCalendar {
  const cal: BusinessCalendar = {
    zone: 'Africa/Johannesburg',
    startMinute: parseClock(env.TICKET_BUSINESS_START || '06:00'),
    endMinute: parseClock(env.TICKET_BUSINESS_END || '17:00'),
  };
  if (cal.endMinute <= cal.startMinute) {
    throw new Error('TICKET_BUSINESS_END must be later than TICKET_BUSINESS_START');
  }
  return cal;
}

// ---------------------------------------------------------------------------------------------
// Escalation matrix (from the spreadsheet). Fractions of the urgency window with no update:
//   50%  -> post a follow-up in the ClickUp task, tagging the assignee(s)
//   70%  -> tag Gleed
// ---------------------------------------------------------------------------------------------
export const ESCALATION = { followUpAt: 0.5, gleedAt: 0.7 } as const;

/** Gleed is the form's owner: the fallback assignee and the person tagged at 70%. */
export const GLEED_NAME = process.env.TICKET_FALLBACK_NAME || 'Gleed';

/** Task numbers are T-0001, T-0002 ... Set TICKET_NUMBER_PAD=5 for T-00001. */
export const numberPad = (): number => Number(process.env.TICKET_NUMBER_PAD) || 4;

/** Every comment the system posts ends with this, so it can never be mistaken for a user update. */
export const BOT_SIGNATURE = '(automated by Omni-Nexos)';

// ---------------------------------------------------------------------------------------------
// Processing
// ---------------------------------------------------------------------------------------------
export const INTAKE_BATCH = 25; // tickets handled per 15 second run
export const MAX_ATTEMPTS = 6; // creation attempts before a ticket is marked FAILED
export const INTAKE_LEASE_MS = 2 * 60_000;
export const SYNC_LEASE_MS = 4 * 60_000;
export const MAX_TELEGRAM_TEXT = 3500; // Telegram caps a message at 4096 characters

/** Optional: also post "task created" in the Telegram group. Off by default (not in the spec). */
export const notifyOnCreate = (): boolean => process.env.TICKET_TELEGRAM_ON_CREATE === 'true';

/** Optional explicit map of form name -> ClickUp user id, e.g. {"Shaughn":12345678}. */
export function assigneeOverrides(env: NodeJS.ProcessEnv = process.env): Record<string, number> {
  if (!env.TICKET_ASSIGNEE_MAP) return {};
  try {
    const parsed = JSON.parse(env.TICKET_ASSIGNEE_MAP);
    const out: Record<string, number> = {};
    for (const [name, id] of Object.entries(parsed)) {
      if (Number.isFinite(Number(id))) out[name.toLowerCase()] = Number(id);
    }
    return out;
  } catch {
    return {};
  }
}
