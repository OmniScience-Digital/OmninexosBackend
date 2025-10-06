import { updateComponents } from "../repositories/dynamo.repository.js";
import logger from "../utils/logger.js";
export const stockControllerRouter = async (req, res) => {
    try {
        logger.info("Executing stock control route.");
        // console.log('Full request body:');
        // console.log(JSON.stringify(req.body, null, 2));
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
    const description = payload.text_content;
    const lines = description.split("\n").filter(Boolean);
    const result = {};
    let username = "Unknown";
    // Detect Withdrawal field dynamically
    const withdrawalField = payload.fields.find((f) => typeof f.value === "string" && f.value.toLowerCase().includes("withdrawal"));
    // Detect user field dynamically (assuming it’s an email or anything not "Intake"/"Withdrawal")
    const userField = payload.fields.find((f) => typeof f.value === "string" &&
        !["withdrawal", "intake"].includes(f.value.toLowerCase().trim()));
    if (userField)
        username = userField.value;
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Detect "Category, Subcategory" line
        if (line.includes(",")) {
            const [categoryName, subCategoryName] = line.split(",").map((s) => s.trim());
            if (!result[categoryName])
                result[categoryName] = {};
            if (!result[categoryName][subCategoryName]) {
                result[categoryName][subCategoryName] = {
                    isWithdrawal: withdrawalField ? true : false,
                    subComponents: {},
                };
            }
            const keyLine = lines[i + 1]?.replace("Key: ", "").trim();
            const valueLine = lines[i + 2]?.replace("Value: ", "").trim();
            if (keyLine && valueLine) {
                result[categoryName][subCategoryName].subComponents[keyLine] = {
                    value: Number(valueLine),
                };
            }
            i += 2; // Skip Key/Value lines
        }
    }
    return {
        ...result,
        username,
    };
}
