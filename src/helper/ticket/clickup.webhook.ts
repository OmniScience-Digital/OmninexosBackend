// src/helper/ticket/clickup.webhook.ts  (NEW FILE)
// TICKETING: pure helpers for the ClickUp "comment added" webhook.
import crypto from 'crypto';

/**
 * ClickUp signs each delivery: header X-Signature = hex HMAC-SHA256 of the raw body, keyed with the
 * secret returned when the webhook was created. Compared in constant time.
 */
export function verifyClickUpSignature(
  raw: Buffer,
  header: string | undefined,
  secret: string
): boolean {
  if (!header || !secret) return false;
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const given = header.trim().toLowerCase();
  if (given.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
}

/** The task a "comment added" delivery is about, or null for any other event / malformed body. */
export function parseCommentEvent(raw: Buffer): { taskId: string } | null {
  try {
    const body = JSON.parse(raw.toString('utf8'));
    if (body?.event !== 'taskCommentPosted' || !body?.task_id) return null;
    return { taskId: String(body.task_id) };
  } catch {
    return null;
  }
}
