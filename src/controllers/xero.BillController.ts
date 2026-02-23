import { Request, Response } from 'express';
import crypto from 'crypto';
import logger from '../utils/logger';

export const xeroControllerRouter = async (req: Request, res: Response) => {
  try {
    // Intent-to-receive request (no signature)
    const signature = req.headers['x-xero-signature'] as string;
    if (!signature) {
      console.log('✅ Intent-to-receive request detected');
      return res.status(200).send('OK');
    }

    const webhookKey = process.env.XERO_WEBHOOK_KEY;
    if (!webhookKey) {
      logger.error('XERO_WEBHOOK_KEY not configured');
      return res.status(500).send('Webhook key missing');
    }

    const rawBody = req.body as Buffer; // express.raw() gives Buffer

    // Verify Xero signature
    const hmac = crypto.createHmac('sha256', webhookKey);
    hmac.update(rawBody);
    const computedSignature = hmac.digest('base64');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
      logger.warn('❌ Invalid Xero signature');
      return res.status(401).send('Unauthorized');
    }

    console.log('🚀 Xero webhook verified, responding 200 immediately');

    // Respond immediately so Xero is happy
    res.status(200).send('OK');

    // Process payload asynchronously
    const payload = JSON.parse(rawBody.toString('utf8'));
    processWebhookEvents(payload);
  } catch (error) {
    logger.error('Error in Xero webhook:', error);
    if (!res.headersSent) res.status(500).send('Internal Server Error');
  }
};

async function processWebhookEvents(payload: any) {
  if (!payload.events) return;

  for (const event of payload.events) {
    logger.info(
      `Processing event: ${event.eventType} - ${event.resourceId} for tenant ${event.tenantId}`
    );
    // Place your business logic here
  }

  logger.info('✅ Webhook processing complete');
}
