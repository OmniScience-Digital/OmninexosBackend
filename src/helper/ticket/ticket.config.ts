// src/helper/ticket/ticket.config.ts  (NEW FILE)
// TICKETING: every setting for the task / ticket system in one place.
// See TICKETING.md in the project root for the environment variables and set-up steps.

export const TABLE_ENV = {
  ticket: 'TICKET_TABLE', // the Amplify "Ticket" table
  counter: 'TICKET_COUNTER_TABLE', // the Amplify "TicketCounter" table
  member: 'TICKET_MEMBER_TABLE', // the Amplify "ClickUpMember" table (people shown on the form)
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

const FLOW_VARS = [
  'TICKET_TABLE',
  'TICKET_COUNTER_TABLE',
  'TICKET_CLICKUP_LIST_ID',
  'TASKING_TELEGRAM_CHAT_ID',
  'CLICKUP_API_TOKEN',
];
const ROSTER_VARS = ['TICKET_MEMBER_TABLE', 'TICKET_CLICKUP_LIST_ID', 'CLICKUP_API_TOKEN'];

/** Names of the variables that are empty or missing, so the log can say exactly what to add. */
export const missingVars = (names: string[], env: NodeJS.ProcessEnv = process.env): string[] =>
  names.filter((n) => !env[n]);
export const missingFlowVars = () => missingVars(FLOW_VARS);
export const missingRosterVars = () => missingVars(ROSTER_VARS);

/** The flow only runs once everything it needs is configured, so deploying early is harmless. */
export const ticketFlowEnabled = (): boolean => missingFlowVars().length === 0;

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

/**
 * Hourly reminders: every open task past its due date is listed in one Telegram message on the hour
 * (06:00 to 17:00). ASAP tasks are due the moment they are created, so they get their first reminder
 * one hour after creation instead of straight away. The reminder only goes out in the first
 * REMINDER_WINDOW_MINUTES of each hour (the 5 minute job runs twice in that window, so a failed send is retried).
 */
export const ASAP_FIRST_REMINDER_MS = 60 * 60_000;
export const REMINDER_WINDOW_MINUTES = 10;

/** Set TICKET_CRONS_ALWAYS=true to run the sync job at any hour (handy when testing at night). */
export const cronsAlwaysOn = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.TICKET_CRONS_ALWAYS === 'true';

/**
 * Who is tagged in ClickUp at 70% (and who gets a task when the person picked has left ClickUp).
 * Set TICKET_ESCALATION_USER_ID to that person's ClickUp user id. If it is not set, the ClickUp list
 * member named TICKET_FALLBACK_NAME (default "Gleed") is used. If neither exists in ClickUp, nobody
 * can be tagged: the comment is still posted, untagged, and a warning is logged.
 */
export const GLEED_NAME = process.env.TICKET_FALLBACK_NAME || 'Gleed';
export function escalationUserId(env: NodeJS.ProcessEnv = process.env): number | null {
  const n = Number(env.TICKET_ESCALATION_USER_ID);
  return env.TICKET_ESCALATION_USER_ID && Number.isFinite(n) ? n : null;
}

/** The people list on the form is kept up to date from ClickUp whenever this is configured. */
export const rosterEnabled = (): boolean =>
  Boolean(
    process.env.TICKET_MEMBER_TABLE &&
    process.env.TICKET_CLICKUP_LIST_ID &&
    process.env.CLICKUP_API_TOKEN
  );

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
