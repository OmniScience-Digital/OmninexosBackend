// src/scripts/backfillJobCards.ts  (NEW FILE)
// One-off: opens a job card for every quote that is ALREADY accepted (the live flow only handles
// quotes that become accepted from now on). Safe to re-run: existing job cards are left alone.
//
//   npx tsx src/scripts/backfillJobCards.ts --dry   # list what would be created
//   npx tsx src/scripts/backfillJobCards.ts         # create them
import 'dotenv/config';
import { listQuotesByStatus } from '../repositories/dynamo.quote.repository';
import { ensureJobCardForQuote, jobCardsEnabled } from '../repositories/dynamo.jobcard.repository';
import { getJobCardTaskId } from '../services/xero.quote.service';

async function main() {
  const dry = process.argv.includes('--dry');
  if (!jobCardsEnabled()) {
    console.error('JOBCARD_TABLE is not set in .env - nothing to do.');
    process.exit(1);
  }

  const quotes = await listQuotesByStatus('ACCEPTED');
  console.log(`Found ${quotes.length} accepted quote(s)${dry ? ' (dry run)' : ''}`);

  const counts = { created: 0, updated: 0, exists: 0, failed: 0 };
  for (const quote of quotes) {
    const taskId = getJobCardTaskId(quote);
    if (dry) {
      console.log(
        `  would open JC-${quote.quoteNumber}  customer=${quote.customerName}  clickup=${taskId ?? '-'}`
      );
      continue;
    }
    try {
      const result = await ensureJobCardForQuote(quote, taskId);
      counts[result] += 1;
      console.log(`  JC-${quote.quoteNumber}: ${result}`);
    } catch (err) {
      counts.failed += 1;
      console.error(`  JC-${quote.quoteNumber}: FAILED`, err);
    }
  }
  if (!dry) console.log('Done:', counts);
  process.exit(counts.failed ? 1 : 0);
}

main();
