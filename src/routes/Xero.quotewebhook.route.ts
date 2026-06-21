import express from 'express';
import { xeroQuoteWebhookController } from '../controllers/xero.quotewebhook.controller';
const router = express.Router();

// This route is specifically for Xero QUOTE webhooks (raw body required for HMAC verification — see index.ts)
router.post('/xeroQuotewebhook', xeroQuoteWebhookController);

export default router;
