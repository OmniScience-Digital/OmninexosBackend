// src/routes/ticket.webhook.route.ts
import express from 'express';
import { ticketWebhookController } from '../controllers/ticket.webhook.controller';
const router = express.Router();

// ClickUp "comment added" webhook for the ticket system (raw body for HMAC, see index.ts)
router.post('/clickupCommentWebhook', ticketWebhookController);

export default router;
