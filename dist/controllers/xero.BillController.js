import logger from "../utils/logger.js";
import crypto from "crypto";
export const xeroControllerRouter = async (req, res) => {
    // IMMEDIATE LOGGING - This should always show
    console.log("\uD83D\uDE80 Xero webhook hit!"); // Direct console.log for immediate visibility
    logger.info("Xero Bill Controller - START");
    try {
        // Log headers for debugging
        logger.debug("Headers:", JSON.stringify(req.headers));
        // Get the raw body
        const rawBody = req.rawBody;
        // CRITICAL DEBUG: Log what we received
        logger.info(`Raw body present: ${!!rawBody}`);
        logger.info(`Content-Type: ${req.headers["content-type"]}`);
        logger.info(`Content-Length: ${req.headers["content-length"]}`);
        if (!rawBody) {
            logger.error("No raw body captured! Check middleware configuration.");
            // Still return 200 to acknowledge receipt
            res.status(200).send("OK");
            return;
        }
        const signature = req.headers["x-xero-signature"];
        const webhookKey = process.env.XERO_WEBHOOK_KEY;
        logger.info(`Signature present: ${!!signature}`);
        logger.info(`Webhook key configured: ${!!webhookKey}`);
        if (!signature) {
            logger.warn("Missing Xero signature header");
            res.status(200).send("OK"); // Still return 200 to acknowledge
            return;
        }
        if (!webhookKey) {
            logger.error("XERO_WEBHOOK_KEY not configured");
            res.status(200).send("OK");
            return;
        }
        // Verify signature
        const isValid = verifyXeroWebhookSignature(rawBody, signature, webhookKey);
        logger.info(`Signature valid: ${isValid}`);
        if (!isValid) {
            logger.warn("Invalid Xero webhook signature");
            res.status(200).send("OK");
            return;
        }
        // Parse body for logging
        try {
            const body = JSON.parse(rawBody);
            logger.info("Webhook payload received:");
            logger.info(`Events count: ${body.events?.length || 0}`);
            // Process in background
            processWebhookEvents(body);
        }
        catch (parseError) {
            logger.error("Error parsing webhook body:", parseError);
        }
        // ALWAYS return 200 OK
        res.status(200).send("OK");
    }
    catch (error) {
        logger.error("Error in webhook handler:", error);
        // Even on error, return 200
        if (!res.headersSent) {
            res.status(200).send("OK");
        }
    }
};
const verifyXeroWebhookSignature = (payload, signature, webhookKey) => {
    try {
        const hmac = crypto.createHmac("sha256", webhookKey);
        hmac.update(payload);
        const computedSignature = hmac.digest("base64");
        logger.debug(`Computed signature: ${computedSignature}`);
        logger.debug(`Received signature: ${signature}`);
        return crypto.timingSafeEqual(Buffer.from(computedSignature), Buffer.from(signature));
    }
    catch (error) {
        logger.error("Signature verification error:", error);
        return false;
    }
};
async function processWebhookEvents(payload) {
    try {
        if (payload.events) {
            for (const event of payload.events) {
                logger.info(`Processing: ${event.eventType} - ${event.resourceId}`);
                // Add your business logic here
            }
        }
        logger.info("Webhook processing complete");
    }
    catch (error) {
        logger.error("Error processing events:", error);
    }
}
