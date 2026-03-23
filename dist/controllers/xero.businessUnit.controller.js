import logger from "../utils/logger.js";
import { getClickUpTask } from "../services/clickUpfetch.service.js";
import { getQuoteByNumber, updateQuote } from "../repositories/dynamo.quote.repository.js";
export const businessUnit_FIELD_ID = "fdf29394-d070-4384-863c-9f2f5885061f";
export const xeroBusinessUnitController = {
    businessUnit: async (req, res) => {
        try {
            const taskId = parseInspectionClickUpPayload(req.body);
            // Fetch the full ClickUp task
            const task = await getClickUpTask(taskId);
            // console.log(JSON.stringify(task));
            // Extract Business Unit info
            const businessUnit = extractBusinessUnit(task);
            // Extract Quote Name from text_content or description
            const quoteName = extractQuoteName(task);
            // Fetch quote from DB
            const existingQuote = await getQuoteByNumber(quoteName);
            if (!existingQuote) {
                return res.status(404).json({
                    success: false,
                    error: "Quote not found"
                });
            }
            // Build updates object using the actual fields from existingQuote
            const updates = {
                quoteNumber: existingQuote.quoteNumber,
                quoteReference: existingQuote.quoteReference,
                customerID: existingQuote.customerID,
                customerName: existingQuote.customerName,
                quoteIssueDate: existingQuote.quoteIssueDate,
                quoteExpireyDate: existingQuote.quoteExpireyDate,
                quoteStatus: existingQuote.quoteStatus,
                currencyCode: existingQuote.currencyCode,
                lineItems: existingQuote.lineItems,
                subTotal: existingQuote.subTotal,
                taxTotal: existingQuote.taxTotal,
                quTotal: existingQuote.quTotal,
                quoteAction: existingQuote.quoteAction,
                title: existingQuote.Title,
                // Set business unit fields from extracted data
                businessUnitvalueid: businessUnit?.valueId || existingQuote.businessUnitvalueid,
                businessUnitvalue: businessUnit?.name || existingQuote.businessUnitvalue,
                // Preserve ClickUp task IDs
                clickUpTaskidCrm1: existingQuote.clickUpTaskidCrm1,
                clickUpTaskidCrm2: existingQuote.clickUpTaskidCrm2,
                clickUpTaskidCrm5: existingQuote.clickUpTaskidCrm5,
                clickUpTaskidCrm7: existingQuote.clickUpTaskidCrm7,
                clickUpTaskidCrm9: existingQuote.clickUpTaskidCrm9,
                quoteId: existingQuote.quoteId,
                createdAt: existingQuote.createdAt,
            };
            const quoteUpdate = await updateQuote(existingQuote.id, updates);
            return res.status(200).json({
                success: true,
                businessUnit,
                quoteName
            });
        }
        catch (error) {
            console.error("Error updating Business Unit:", error);
            return res.status(500).json({
                success: false,
                error: error.message || "Unknown error"
            });
        }
    }
};
// Parse task ID from webhook payload
function parseInspectionClickUpPayload(clickupPayload) {
    try {
        return clickupPayload.payload.id;
    }
    catch (error) {
        logger.error("Error parsing inspection payload:", error);
        throw error;
    }
}
// Extract Business Unit with TypeScript-safe types
function extractBusinessUnit(task) {
    const t = task.task || task;
    const field = t.custom_fields?.find((f) => f.name === "Business Unit");
    if (!field)
        return null;
    const selectedOption = field.type_config?.options?.find((opt) => opt.id === field.value || opt.orderindex === field.value);
    if (!selectedOption)
        return null;
    return {
        valueId: selectedOption.id, // actual ClickUp option ID
        name: selectedOption.name, // human-readable name
        rawValue: field.value // value sent by ClickUp
    };
}
// Extract Quote Name from task text_content or description
function extractQuoteName(task) {
    const text = task.text_content || task.description || "";
    const match = text.match(/Name\s*-\s*(.+)/);
    return match ? match[1].trim() : null;
}
