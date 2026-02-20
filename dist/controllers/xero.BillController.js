import logger from "../utils/logger.js";
export const xeroControllerRouter = async (req, res) => {
    try {
        logger.info("Executing Xero Bill Webhook control route.");
        logger.info(JSON.stringify(req.body, null, 2));
        res.status(200).json({ success: true, message: "Xero Bill Updated successfully" });
    }
    catch (error) {
        logger.error("Failed to update Xero Bill:", error);
        console.error(error);
        res.status(500).json({
            success: false,
            error: "Error Xero Bill not  Updated",
            details: error.message,
        });
    }
};
