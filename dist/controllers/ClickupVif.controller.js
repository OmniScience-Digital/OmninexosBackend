import logger from "../utils/logger.js";
export const vifControllerRouter = async (req, res) => {
    try {
        logger.info("Executing Inspection control route.");
        console.log(JSON.stringify(req.body, null, 2));
        // const payload = parseInspectionClickUpPayload(req.body);
        // await insertInspectionService(payload);
        res.status(200).json({ success: true, message: "Inspection inserted successfully" });
    }
    catch (error) {
        logger.error("Failed to insert inspection:", error);
        console.error(error);
        res.status(500).json({
            success: false,
            error: "Error inserting inspection",
            details: error.message,
        });
    }
};
function parseInspectionClickUpPayload(clickupPayload) {
    try {
        const { payload } = clickupPayload;
        const text = payload.text_content;
        const name = payload.name;
        logger.info("Received ClickUp payload for inspection.");
        return { text, name };
    }
    catch (error) {
        logger.error("Error parsing inspection payload:", error);
        throw error;
    }
}
