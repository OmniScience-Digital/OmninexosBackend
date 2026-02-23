import express from "express";
import "dotenv/config";
import cors from "cors";
import compression from "compression";
import crypto from "crypto";
import logger from "./utils/logger.js";
import executiontime from "./middlewares/execution.middleware.js";
import errorhandling from "./middlewares/errorhandling.middleware.js";
const app = express();
const PORT = process.env.PORT;
const HOST = process.env.HOST;
const WEBHOOK_KEY = process.env.XERO_WEBHOOK_KEY;
// Trust proxy
app.set("trust proxy", true);
// Execution time middleware
executiontime(app);
// Enable CORS and compression
app.use(cors({ origin: "*", methods: "GET,POST", credentials: true }));
app.use(compression());
// Use raw parser only for Xero webhook
app.use("/api/v1/xero/xeroBillwebhook", express.raw({ type: "*/*", limit: "10mb" }));
// Xero webhook endpoint
app.post("/api/v1/xero/xeroBillwebhook", (req, res) => {
    try {
        const signature = req.headers["x-xero-signature"];
        // Intent-to-receive request
        if (!signature) {
            console.log("\u2705 Intent-to-receive request detected");
            return res.status(200).send("OK");
        }
        if (!WEBHOOK_KEY) {
            logger.error("XERO_WEBHOOK_KEY not configured");
            return res.status(500).send("Webhook key missing");
        }
        const rawBody = req.body;
        // Verify signature
        const hmac = crypto.createHmac("sha256", WEBHOOK_KEY);
        hmac.update(rawBody);
        const computedSignature = hmac.digest("base64");
        if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
            console.log("\u274C Signature verification failed");
            return res.status(401).send("Invalid signature");
        }
        console.log("\u2705 Xero webhook received and verified");
        // Parse payload and process asynchronously
        try {
            const payload = JSON.parse(rawBody.toString());
            if (payload.events) {
                payload.events.forEach((event) => {
                    console.log(`Processing event: ${event.eventType} on resource ${event.resourceId}`);
                    // Add background processing here
                });
            }
        }
        catch (parseError) {
            logger.error("Error parsing webhook body:", parseError);
        }
        // Respond immediately
        res.status(200).send("OK");
    }
    catch (error) {
        logger.error("Webhook handler error:", error);
        res.status(500).send("Server error");
    }
});
// Error handling middleware
errorhandling(app);
app.listen(PORT, () => {
    logger.info(`App running at http://${HOST}:${PORT}`);
    logger.info(`Environment: ${process.env.NODE_ENV}`);
});
export default app;
