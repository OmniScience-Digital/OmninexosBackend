import { Request, Response } from 'express';
import logger from '../utils/logger';
import { getClickUpTask } from '../services/clickUpfetch.service';
import { getQuoteByNumber, updateQuote } from '../repositories/dynamo.quote.repository';

export const businessUnit_FIELD_ID = 'fdf29394-d070-4384-863c-9f2f5885061f';

export const xeroBusinessUnitController = {
  businessUnit: async (req: Request, res: Response) => {
    try {
      const taskId = parseInspectionClickUpPayload(req.body);

      // Fetch the full ClickUp task
      const task = await getClickUpTask(taskId);

      // console.log(JSON.stringify(task));

      // Extract Business Unit info
      const businessUnit = extractBusinessUnit(task);

      // Extract Quote Name from text_content or description
      const quoteName = extractQuoteName(task) as string;

      // Fetch quote from DB
      const existingQuote = await getQuoteByNumber(quoteName);

      if (!existingQuote) {
        return res.status(404).json({
          success: false,
          error: 'Quote not found',
        });
      }

      // Build updates object using the actual fields from existingQuote
      const updates: any = {
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
        quoteName,
      });
    } catch (error: any) {
      console.error('Error updating Business Unit:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Unknown error',
      });
    }
  },
};

// Parse task ID from webhook payload
function parseInspectionClickUpPayload(clickupPayload: any): string {
  try {
    return clickupPayload.payload.id;
  } catch (error: any) {
    logger.error('Error parsing inspection payload:', error);
    throw error;
  }
}

// Extract Business Unit with TypeScript-safe types
function extractBusinessUnit(task: any) {
  const t = task.task || task;

  type Option = { id: string; name: string; orderindex?: number };
  type CustomField = {
    id: string;
    name: string;
    value?: string | number;
    type_config?: { options: Option[] };
  };

  const field = t.custom_fields?.find((f: CustomField) => f.name === 'Business Unit');
  if (!field) return null;

  const selectedOption = field.type_config?.options?.find(
    (opt: Option) => opt.id === field.value || opt.orderindex === field.value
  );

  if (!selectedOption) return null;

  return {
    valueId: selectedOption.id, // actual ClickUp option ID
    name: selectedOption.name, // human-readable name
    rawValue: field.value, // value sent by ClickUp
  };
}

// Extract Quote Name from task text_content or description
function extractQuoteName(task: any): string | null {
  const text = task.text_content || task.description || '';
  const match = text.match(/Name\s*-\s*(.+)/);
  return match ? match[1].trim() : null;
}
