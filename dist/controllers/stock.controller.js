import { updateComponents } from "../repositories/dynamo.repository.js";
import logger from "../utils/logger.js";
export const stockControllerRouter = async (req, res) => {
    try {
        logger.info("Executing stock control route.");
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
    const description = payload.text_content;
    const lines = description.split("\n").filter(Boolean);
    const timestamp = payload.name.match(/@ (.*)$/)?.[1] || null;
    const result = {};
    let username = "Unknown";
    let currentCategory = "";
    let currentSubCategory = "";
    const withdrawalField = payload.fields.find((f) => typeof f.value === "string" && f.value.toLowerCase().includes("withdrawal"));
    const userField = payload.fields.find((f) => typeof f.value === "string" &&
        !["withdrawal", "intake"].includes(f.value.toLowerCase().trim()));
    if (userField)
        username = userField.value;
    // Process all lines
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Check if line contains a category (contains comma and doesn't start with "Key:" or "Value:")
        if (line.includes(",") && !line.startsWith("Key:") && !line.startsWith("Value:")) {
            const [categoryName, subCategoryName] = line.split(",").map((s) => s.trim());
            if (!result[categoryName])
                result[categoryName] = {};
            result[categoryName][subCategoryName] = {
                isWithdrawal: withdrawalField ? true : false,
                subComponents: {},
            };
            currentCategory = categoryName;
            currentSubCategory = subCategoryName;
        }
        // Process Key/Value pairs
        else if (line.startsWith("Key:") && i + 1 < lines.length && lines[i + 1].startsWith("Value:")) {
            const keyLine = line.replace("Key: ", "").trim();
            const valueLine = lines[i + 1].replace("Value: ", "").trim();
            if (keyLine && valueLine && currentCategory && currentSubCategory) {
                result[currentCategory][currentSubCategory].subComponents[keyLine] = {
                    value: Number(valueLine),
                };
            }
            i++; // Skip the next line since we processed it
        }
    }
    return {
        ...result,
        username,
        timestamp,
    };
}
