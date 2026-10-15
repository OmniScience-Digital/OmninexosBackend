// src/helper/jobcard/jobcard.helper.ts
// Pure helpers: turn an accepted Quote row into a JobCard row. No I/O.
/** JC-QU-0032 for quote QU-0032. Also used as the row id, so there is exactly one job card per quote number. */
export const jobCardNumberFor = (quoteNumber) => `JC-${quoteNumber}`;
export function buildJobCardItem(quote, clickupTaskId, nowIso) {
    if (!quote.quoteNumber)
        throw new Error('Cannot create a job card: quote has no quoteNumber');
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
