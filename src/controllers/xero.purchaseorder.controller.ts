import { Request, Response } from 'express';
import logger from '../utils/logger';
import { getClickUpTask } from '../services/clickUpfetch.service';
import { getQuoteByNumber, updateQuote } from '../repositories/dynamo.quote.repository';
import {
  extractQuoteName,
  updateClickUpTaskStatus,
  uploadAttachmentToClickUpTask,
  getJobCardTaskId,
} from '../services/xero.quote.service';
import { ClickUpTaskResponse } from '../schema/xero.schema';

export const BUSINESS_UNIT_FIELD_ID = 'fdf29394-d070-4384-863c-9f2f5885061f';
export const PURCHASE_ORDER_NUMBER_FIELD_ID = '7830276e-f1bb-4efc-8e87-e34693cbd712';

const CUSTOMER_FIELD_ID = 'b1b8b307-162d-46b6-8dbb-6e995d1130bc';
const CRM07_LINK_FIELD_ID = '30dfc6ea-3e9b-4bf3-962d-1586cd4482d2';

const API_TOKEN = process.env.CLICKUP_API_TOKEN!;

export const xeroPOController = {
  poUpdate: async (req: Request, res: Response) => {
    try {
      const taskId = parseInspectionClickUpPayload(req.body);

      // Fetch the full ClickUp task (CRM2)
      const task = await getClickUpTask(taskId);

      // Extract Purchase Order Number from custom fields
      const poNumber = extractPurchaseOrderNumber(task);

      // Extract Quote Name from text_content or description
      const quoteName = extractQuoteName(task);

      if (!quoteName) {
        return res.status(400).json({
          success: false,
          error: 'Quote number not found in task description',
        });
      }

      // Fetch quote from DB
      const existingQuote = await getQuoteByNumber(quoteName);

      if (!existingQuote) {
        return res.status(404).json({
          success: false,
          error: 'Quote not found',
        });
      }

      // Build updates object
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
        title: existingQuote.title,
        invNumber: existingQuote.invNumber,
        PoNumber: poNumber || existingQuote.PoNumber || null,
        clickUpTaskidCrm1: existingQuote.clickUpTaskidCrm1,
        clickUpTaskidCrm2: existingQuote.clickUpTaskidCrm2,
        clickUpTaskidCrm5: existingQuote.clickUpTaskidCrm5,

        quoteId: existingQuote.quoteId,
        createdAt: existingQuote.createdAt,
      };

      // Update quote in DB
      await updateQuote(existingQuote.id, updates);

      // Check attachments exist on CRM2 task
      if (!task.attachments || !task.attachments.length) {
        return res.status(400).json({
          success: false,
          error: 'No PO attachments found in the source task',
        });
      }

      // Copy PO files to whichever job card (CRM-050/051 x Global/Services) this quote
      // actually has - clickUpTaskidCrm5/Crm7 are the old, now-unused single job-card list
      // and are never populated for quotes going through the current 4-way split.
      const jobCardTaskId = getJobCardTaskId(existingQuote);
      if (jobCardTaskId) {
        const targetTask = await getClickUpTask(jobCardTaskId);
        const existingUrls = new Set((targetTask.attachments || []).map((att: any) => att.url));

        for (const file of task.attachments) {
          if (!existingUrls.has(file.url)) {
            await uploadAttachmentToClickUpTask(jobCardTaskId, file.url);
          }
        }
      } else {
        // Quote hasn't been Accepted yet (no job card exists) - the businessUnit webhook's
        // copy-on-Accept step (see xero.quote.service.ts) will carry these attachments over
        // once the job card is created, so this isn't an error, just a no-op for now.
        logger.info(
          `poUpdate: no job card exists yet for quote ${quoteName} - skipping attachment copy`
        );
      }

      // Mark CRM2 as complete
      await updateClickUpTaskStatus(taskId, 'complete');

      return res.status(200).json({
        success: true,
        poNumber,
        quoteName,
      });
    } catch (error: any) {
      console.error('Error updating Purchase Order Number:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Unknown error',
      });
    }
  },
  poDUpdate: async (req: Request, res: Response) => {
    try {
      const taskId = parseInspectionClickUpPayload(req.body);

      // Fetch the target ClickUp task (where POD should be attached)
      const targetTask = await getClickUpTask(taskId);

      // Extract Quote Name from task description or text_content
      const quoteName = extractQuoteName(targetTask);

      if (!quoteName) {
        return res.status(400).json({
          success: false,
          error: 'Quote number not found in task description',
        });
      }

      // Pull the existing quote from the database
      const existingQuote = await getQuoteByNumber(quoteName);

      if (!existingQuote) {
        return res.status(404).json({
          success: false,
          error: 'Quote not found in the database',
        });
      }

      // Fetch the source task where POD is currently attached
      const sourceTaskId = existingQuote.clickUpTaskidCrm5;
      const sourceTask = await getClickUpTask(sourceTaskId);

      if (!sourceTask.attachments || !sourceTask.attachments.length) {
        return res.status(400).json({
          success: false,
          error: 'No POD attachments found in the source task',
        });
      }

      const targetTaskId = existingQuote.clickUpTaskidCrm7;

      // Fetch the target task (CRM7) to see which attachments already exist
      const targetTaskDetails = await getClickUpTask(targetTaskId);
      const existingUrls = new Set(
        (targetTaskDetails.attachments || []).map((att: any) => att.url)
      );

      let uploaded = 0;
      for (const file of sourceTask.attachments) {
        // Only upload if the file's URL is not already in the target task
        if (!existingUrls.has(file.url)) {
          await uploadAttachmentToClickUpTask(targetTaskId, file.url);
          uploaded++;
        }
      }

      return res.status(200).json({
        success: true,
        message: `${uploaded} new POD attachment(s) copied to task ${targetTaskId}`,
        skipped: sourceTask.attachments.length - uploaded,
      });
    } catch (error: any) {
      console.error('Error updating POD attachments:', error);
      return res.status(500).json({
        success: false,
        error: error.message || 'Unknown error',
      });
    }
  },
};

//1. Parse task ID from webhook payload
function parseInspectionClickUpPayload(clickupPayload: any): string {
  try {
    return clickupPayload.payload.id;
  } catch (error: any) {
    logger.error('Error parsing inspection payload:', error);
    throw error;
  }
}

//2. Extract Purchase Order Number from custom fields
export function extractPurchaseOrderNumber(task: any): string | null {
  const t = task.task || task;
  const customFields = t.custom_fields || [];
  const poField = customFields.find(
    (field: any) =>
      field.id === PURCHASE_ORDER_NUMBER_FIELD_ID || field.name === 'Purchase Order Number'
  );
  if (poField && poField.value) {
    return poField.value.toString().trim();
  }
  return null;
}
