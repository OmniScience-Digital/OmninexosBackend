// src/controllers/telegram.webhook.controller.ts  (NEW FILE)
import { Request, Response } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger';
import { handleTelegramUpdate } from '../services/telegram.webhook.service';

/**
 * Telegram bot webhook. Telegram sends the secret you chose in setWebhook as the header
 * X-Telegram-Bot-Api-Secret-Token, so only Telegram can call this. Register it with
 * `npx tsx src/scripts/setTelegramWebhook.ts`.
 *
 * Returns 200 once the update is handled. If saving fails it returns 500, so Telegram retries the update.
 */
export const telegramWebhookController = async (req: Request, res: Response) => {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) {
    logger.error('TELEGRAM_WEBHOOK_SECRET is not configured');
    return res.status(500).send('Webhook secret missing');
  }
  const given = String(req.headers['x-telegram-bot-api-secret-token'] ?? '');
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    logger.warn('Telegram webhook called with a wrong secret');
    return res.status(401).send('Unauthorized');
  }

  try {
    await handleTelegramUpdate(req.body);
    return res.status(200).send('OK');
  } catch (err) {
    logger.error('Telegram webhook failed to save the update:', err);
    return res.status(500).send('Error');
  }
};
