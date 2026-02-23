import express from 'express';
import 'dotenv/config';
import crypto from 'crypto';
const app = express();
const PORT = parseInt(process.env.PORT || '5001', 10);
const WEBHOOK_KEY = process.env.XERO_WEBHOOK_KEY || '';
// Other middleware can be used for other routes
app.use(express.json());
app.post('/xero-webhook', (req, res) => {
    const xeroSignature = req.headers['x-xero-signature'];
    const computedSignature = crypto
        .createHmac('sha256', Buffer.from(WEBHOOK_KEY, 'utf8'))
        .update(req.body) // Use the raw body
        .digest('base64');
    if (xeroSignature === computedSignature) {
        console.log('Signature passed! This is from Xero!');
        // Process the events in the background (see Step 3)
        const payload = JSON.parse(req.body.toString());
        processWebhookEvents(payload.events);
        // Respond immediately with 200 OK
        res.sendStatus(200);
    }
    else {
        console.log('Signature failed.');
        res.sendStatus(401);
    }
});
function processWebhookEvents(events) {
    // Iterate through all events in the payload (a single payload can have multiple events)
    events.forEach(event => {
        // e.g. add to a processing queue or database
        console.log(`Processing event: ${event.eventType} on resource ${event.resourceId} for tenant ${event.tenantId}`);
        // A separate worker process should then fetch the full resource details from the 
    });
}
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Server running on port ${PORT}`);
    console.log(`📋 Webhook endpoint: http://localhost:${PORT}/xero-webhook`);
    console.log(`🔑 Webhook key configured: ${!!WEBHOOK_KEY}`);
    console.log(`🌐 Ngrok URL: https://unslumping-zariyah-sturdily.ngrok-free.dev/xero-webhook\n`);
});
