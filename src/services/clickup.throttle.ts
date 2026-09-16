import fetch, { Response, RequestInit } from 'node-fetch';
import { client as redisClient } from './redis.service';
import logger from '../utils/logger';

/**
 * Per-ClickUp-call throttling.
 *
 * Root cause this addresses: the quote poller fires every ClickUp call as fast
 * as the event loop allows, with zero delay between calls. Sequential (not
 * concurrent) is not the same as "safe" - a burst of 100+ quick sequential
 * calls (e.g. the 107-quote backfill, each needing multiple steps replayed)
 * blows straight through ClickUp's per-token rate limit (100 req/min on
 * Free/Unlimited/Business plans, confirmed via ClickUp's own docs), and the
 * previous code silently logged the resulting 429/APP_002 and moved on -
 * meaning the DB got marked "synced" for quotes whose ClickUp update actually
 * failed. That's the direct cause of the inconsistent CRM-01/CRM-02 statuses.
 *
 * This module provides `clickupFetch`, a drop-in replacement for `fetch` used
 * only for calls to api.clickup.com, which:
 *   1. Blocks (does not drop) until a slot is free under a shared, Redis-backed
 *      per-minute budget - Redis-backed so the budget survives a process
 *      restart and (if adopted elsewhere) can be shared across other
 *      ClickUp-calling code in this backend that uses the same token.
 *   2. Retries with backoff on an actual 429, honoring ClickUp's Retry-After
 *      header when present, instead of giving up on the first hit.
 *   3. THROWS if every retry is exhausted - callers must not swallow this.
 *      The whole point is that a step which didn't actually succeed against
 *      ClickUp must not be treated as done.
 */

const WINDOW_MS = 60_000;

// Default budget deliberately conservative (below ClickUp's 100/min on
// Free/Unlimited/Business plans) to leave headroom for the other controllers
// in this backend that share the same CLICKUP_API_TOKEN (cron.crm, cron.hrd,
// businessUnit webhook, purchaseorder webhook) and are NOT yet routed through
// this limiter. Override via env once the real plan/ceiling is confirmed.
const DEFAULT_LIMIT_PER_MIN = 80;

const RATE_LIMIT_KEY = 'clickup:rate:window';
const MAX_RETRIES = 5;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Blocks until a ClickUp API call slot is available under the shared
 * per-minute budget. Fails OPEN (proceeds without throttling) if Redis itself
 * is unreachable - a Redis outage must not mean ClickUp calls hang forever.
 */
async function acquireClickUpSlot(): Promise<void> {
  const limit = Number(process.env.CLICKUP_RATE_LIMIT_PER_MIN) || DEFAULT_LIMIT_PER_MIN;

  // Loop rather than recurse - this can legitimately wait through several
  // consecutive full windows if a very large batch is queued up.
  while (true) {
    let count: number;
    try {
      count = await redisClient.incr(RATE_LIMIT_KEY);
      if (count === 1) {
        // First call in a fresh window - start its TTL (second precision is
        // more than sufficient for a 60s window; avoids relying on the
        // exact camelCase name node-redis v5 uses for the ms-precision variant).
        await redisClient.expire(RATE_LIMIT_KEY, WINDOW_MS / 1000);
      }
    } catch (err) {
      logger.error('[ClickUp throttle] Redis error, proceeding without throttling:', err);
      return;
    }

    if (count <= limit) return;

    let waitMs = WINDOW_MS;
    try {
      const ttlSeconds = await redisClient.ttl(RATE_LIMIT_KEY);
      if (ttlSeconds > 0) waitMs = ttlSeconds * 1000;
    } catch {
      // Redis ttl() failed - fall back to waiting a full window.
    }

    logger.warn(
      `[ClickUp throttle] Budget (${limit}/min) reached, waiting ${waitMs}ms for window reset`
    );
    await sleep(waitMs + 250); // small buffer past the window's actual expiry
  }
}

/**
 * Drop-in replacement for `fetch` for calls to api.clickup.com. Blocks under
 * the shared rate budget, retries on 429 with backoff, and throws (does not
 * swallow) once retries are exhausted.
 */
export async function clickupFetch(url: string, init: RequestInit): Promise<Response> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    await acquireClickUpSlot();

    const res = await fetch(url, init);

    if (res.status !== 429) {
      return res;
    }

    if (attempt === MAX_RETRIES) {
      throw new Error(
        `[ClickUp] Rate limit exceeded after ${MAX_RETRIES} retries: ${init.method || 'GET'} ${url}`
      );
    }

    const retryAfterHeader = res.headers.get('retry-after');
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : 2000 * (attempt + 1); // exponential-ish fallback if header absent

    logger.warn(
      `[ClickUp throttle] 429 on ${url}, retrying in ${retryAfterMs}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
    );
    await sleep(retryAfterMs);
  }

  // Unreachable - loop above always returns or throws - but keeps TS's
  // control-flow analysis happy about a guaranteed return type.
  throw new Error(`[ClickUp] Rate limit exceeded: ${url}`);
}
