// src/scripts/setTelegramWebhook.ts  (NEW FILE)
// One-off: tells Telegram where to send bot events (bot added to / removed from a group, group renamed).
//   TELEGRAM_WEBHOOK_URL=https://your-server/api/v1/telegramWebhook npx tsx src/scripts/setTelegramWebhook.ts
// Needs in .env: telegramBotToken, TELEGRAM_WEBHOOK_SECRET (any long random string, also used by the server).
import 'dotenv/config';
import axios from 'axios';
async function main() {
    const token = process.env.telegramBotToken;
    const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
    const url = process.env.TELEGRAM_WEBHOOK_URL;
    if (!token || !secret || !url) {
        console.error('Set telegramBotToken, TELEGRAM_WEBHOOK_SECRET and TELEGRAM_WEBHOOK_URL first.');
        process.exit(1);
    }
    const res = await axios.post(`https://api.telegram.org/bot${token}/setWebhook`, {
        url,
        secret_token: secret,
        allowed_updates: ['my_chat_member', 'message'],
        drop_pending_updates: false,
    });
    console.log('setWebhook:', res.data);
    const info = await axios.get(`https://api.telegram.org/bot${token}/getWebhookInfo`);
    console.log('getWebhookInfo:', info.data.result);
}
main().catch((e) => {
    console.error('Failed:', e?.response?.data ?? e.message);
    process.exit(1);
});
