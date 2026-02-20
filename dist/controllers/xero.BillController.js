import crypto from "crypto";
import logger from "../utils/logger.js";
export const xeroControllerRouter = async (req, res) => {
    try {
        const signature = req.headers["x-xero-signature"];
        if (!signature) {
            return res.status(401).send("Missing signature");
        }
        const expectedSignature = crypto
            .createHmac("sha256", process.env.XERO_WEBHOOK_KEY)
            .update(req.body) // RAW BUFFER
            .digest("base64");
        if (signature !== expectedSignature) {
            logger.error("Invalid Xero signature");
            return res.status(401).send("Invalid signature");
        }
        logger.info("Xero webhook verified");
        const body = JSON.parse(req.body.toString());
        logger.info(JSON.stringify(body));
        return res.status(200).send("OK"); // IMPORTANT
    }
    catch (error) {
        logger.error("Webhook error", error);
        return res.status(500).send("Webhook error");
    }
};
