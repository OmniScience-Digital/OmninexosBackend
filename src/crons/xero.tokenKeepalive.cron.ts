import cron from 'node-cron';
import { getAccessToken } from '../helper/tokens/token.helper';
import logger from '../utils/logger';

const timeZone = 'Africa/Johannesburg';

/**
 * Xero refresh tokens expire after 60 days of inactivity. Every other call to
 * getAccessToken() (polling, webhooks, frontend-triggered quote creation) already
 * rotates the stored refresh token as a side effect — but if the system goes quiet
 * (e.g. no quotes/bills/POs move for a while), nothing calls it and the token can
 * silently expire, breaking every Xero integration at once.
 *
 * This cron exists purely to guarantee getAccessToken() is called at least once
 * every 24 hours, regardless of business activity, keeping the refresh token alive.
 */
cron.schedule(
  '0 3 * * *', // 03:00 daily — outside the 1:00/1:10 fleet/HRD cron window
  async () => {
    try {
      logger.info('[CRON] Xero token keepalive - refreshing token');
      await getAccessToken();
      logger.info('[CRON] Xero token keepalive - refreshed successfully');
    } catch (error) {
      logger.error('[CRON] Xero token keepalive failed:', error);
    }
  },
  { timezone: timeZone }
);

logger.info('🕒 Xero token keepalive cron scheduled (daily @ 03:00 Africa/Johannesburg)');
