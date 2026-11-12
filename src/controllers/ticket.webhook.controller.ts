// src/controllers/ticket.webhook.controller.ts
// TICKETING: ClickUp "comment added" webhook. It only wakes the sync for that one ticket, so a reply
// reaches Telegram in seconds instead of within 5 minutes. It never trusts the payload's content:
// the sync re-reads the comments from ClickUp itself. The 5 minute run stays as the safety net.
import { Request, Response } from 'express';
import logger from '../utils/logger';
import { parseCommentEvent, verifyClickUpSignature } from '../helper/ticket/clickup.webhook';
import { ticketFlowEnabled } from '../helper/ticket/ticket.config';
import { syncTicketByTaskId } from '../services/ticket.sync.service';
import { ticketSyncDeps } from '../services/ticket.deps';

export const ticketWebhookController = async (req: Request, res: Response) => {
  const secret = process.env.CLICKUP_WEBHOOK_SECRET;
  if (!secret) {
    logger.warn(
      '[ticket] ClickUp webhook received but CLICKUP_WEBHOOK_SECRET is not set; ignoring'
    );
    return res.status(503).send('Not configured');
  }

  const raw = req.body as Buffer;
  if (!Buffer.isBuffer(raw) || !verifyClickUpSignature(raw, req.header('x-signature'), secret)) {
    logger.warn('❌ Invalid signature on ClickUp comment webhook');
    return res.status(401).send('Unauthorized');
  }

  // Answer first: ClickUp disables webhooks that time out or keep failing.
  res.status(200).send('OK');

  const event = parseCommentEvent(raw);
  if (!event || !ticketFlowEnabled()) return;
  try {
    const found = await syncTicketByTaskId(ticketSyncDeps(), event.taskId);
    if (found) logger.info(`[ticket] webhook synced task ${event.taskId}`);
  } catch (err) {
    logger.error(`[ticket] webhook sync failed for task ${event.taskId}:`, err);
  }
};
