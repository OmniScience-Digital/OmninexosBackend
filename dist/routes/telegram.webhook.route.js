// src/routes/telegram.webhook.route.ts  (NEW FILE)
import express from "express";
import { telegramWebhookController } from "../controllers/telegram.webhook.controller.js";
const router = express.Router();
// Telegram bot webhook (secret-token protected). Plain JSON body, so no raw parser is needed.
router.post("/telegramWebhook", telegramWebhookController);
export default router;
