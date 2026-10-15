// src/helper/jobcard/jobcard.helper.ts
// Pure helpers: turn an accepted Quote row into a JobCard row. No I/O.

export interface JobCardItem {
  id: string;
  jcNumber: string;
  quoteId?: string;
  quoteNumber: string;
  customerName?: string;
  title?: string;
  status: 'OPEN';
  openedAt: string;
  clickupTaskId?: string;
  totalMinutes: number;
  createdAt: string;
  updatedAt: string;
}

/** JC-QU-0032 for quote QU-0032. Also used as the row id, so there is exactly one job card per quote number. */
export const jobCardNumberFor = (quoteNumber: string): string => `JC-${quoteNumber}`;

export function buildJobCardItem(
  quote: {
    quoteNumber: string;
    quoteId?: string;
    customerName?: string;
    title?: string;
  },
  clickupTaskId: string | undefined,
  nowIso: string
): JobCardItem {
  if (!quote.quoteNumber) throw new Error('Cannot create a job card: quote has no quoteNumber');
  const jcNumber = jobCardNumberFor(quote.quoteNumber);
  return {
    id: jcNumber,
    jcNumber,
    quoteId: quote.quoteId || undefined,
    quoteNumber: quote.quoteNumber,
    customerName: quote.customerName || undefined,
    title: quote.title || undefined,
    status: 'OPEN',
    openedAt: nowIso,
    clickupTaskId: clickupTaskId || undefined,
    totalMinutes: 0,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}
