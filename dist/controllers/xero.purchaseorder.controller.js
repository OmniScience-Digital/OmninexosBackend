import logger from "../utils/logger.js";
import { getClickUpTask } from "../services/clickUpfetch.service.js";
import { getQuoteByNumber, updateQuote } from "../repositories/dynamo.quote.repository.js";
export const BUSINESS_UNIT_FIELD_ID = "fdf29394-d070-4384-863c-9f2f5885061f";
export const PURCHASE_ORDER_NUMBER_FIELD_ID = "7830276e-f1bb-4efc-8e87-e34693cbd712";
export const xeroPOController = {
    poUpdate: async (req, res) => {
        try {
            const taskId = parseInspectionClickUpPayload(req.body);
            // Fetch the full ClickUp task
            const task = await getClickUpTask(taskId);
            // Extract Purchase Order Number from custom fields
            const poNumber = extractPurchaseOrderNumber(task);
            // Extract Quote Name from text_content or description
            const quoteName = extractQuoteName(task);
            if (!quoteName) {
                return res.status(400).json({
                    success: false,
                    error: "Quote number not found in task description",
                });
            }
            // Fetch quote from DB
            const existingQuote = await getQuoteByNumber(quoteName);
            if (!existingQuote) {
                return res.status(404).json({
                    success: false,
                    error: "Quote not found",
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
                title: existingQuote.title,
                // Set purchase order number (null if not provided)
                PoNumber: poNumber || existingQuote.purchaseOrderNumber || null,
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
                poNumber,
                quoteName,
            });
        }
        catch (error) {
            console.error("Error updating Purchase Order Number:", error);
            return res.status(500).json({
                success: false,
                error: error.message || "Unknown error",
            });
        }
    },
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
// Extract Purchase Order Number from custom fields
function extractPurchaseOrderNumber(task) {
    const t = task.task || task;
    const customFields = t.custom_fields || [];
    const poField = customFields.find((field) => field.id === PURCHASE_ORDER_NUMBER_FIELD_ID ||
        field.name === "Purchase Order Number");
    if (poField && poField.value) {
        return poField.value.toString().trim();
    }
    return null;
}
// Extract Quote Name from task text_content or description
function extractQuoteName(task) {
    const text = task.text_content || task.description || "";
    const match = text.match(/Scope of Work\s*-\s*(.+)/);
    return match ? match[1].trim() : null;
}
