import { updateComponents } from "../repositories/dynamo.repository.js";
import logger from "../utils/logger.js";
export const stockControllerRouter = async (req, res) => {
    try {
        logger.info("Executing stock control route.");
        console.log("Full request body:");
        console.log(JSON.stringify(req.body, null, 2));
        const payload = parseClickUpPayload(req.body);
        await updateComponents(payload);
        res.status(200).json({ success: true, message: "Report Generated" });
    }
    catch (error) {
        logger.error("Failed to generate report:", error);
        console.error(error);
        res.status(500).json({
            success: false,
            error: "Error generating report",
            details: error.message,
        });
    }
};
function parseClickUpPayload(clickupPayload) {
    const { payload } = clickupPayload;
    // Extract description text
    const description = payload.text_content;
    // Break into subcomponents
    const lines = description.split("\n").filter(Boolean);
    const subComponents = {};
    for (let i = 0; i < lines.length; i += 2) {
        const keyLine = lines[i].replace("Key: ", "").trim();
        const valueLine = lines[i + 1].replace("Value: ", "").trim();
        subComponents[keyLine] = {
            value: Number(valueLine),
            // read from custom_fields: Intake vs Withdrawal
            isWithdrawal: payload.fields.find((f) => f.field_id === "0714e91c-fb89-43b7-b8f0-deb3d1b4d973")
                ?.value === "Withdrawal",
        };
    }
    // Extract username from fields
    const username = payload.fields.find((f) => f.field_id === "daf6f996-8096-473b-b9e4-9e20f4568d63")?.value ||
        "Unknown";
    return {
        [payload.name]: subComponents,
        username,
    };
}
