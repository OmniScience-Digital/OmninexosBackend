import fetch from 'node-fetch';
import FormData from 'form-data';
import { getAccessToken } from '../helper/tokens/token.helper';
import { ClickUpTaskResponse, Quote, XeroQuotesResponse } from '../schema/xero.schema';
import logger from '../utils/logger';
import { getXeroConfig, updateXeroConfig } from '../repositories/dynamo.xeroconfig.repository';
import {
  createQuote,
  updateQuote,
  getQuoteByNumber,
} from '../repositories/dynamo.quote.repository';
import telegramService from './telegram.service';

const TENANT_ID = process.env.XERO_TENANT_ID!;
const API_TOKEN = process.env.CLICKUP_API_TOKEN!;

const Xero_Url = `https://go.xero.com/app/!97lqx/quotes/`;
const CUSTOMER_FIELD_ID = 'b1b8b307-162d-46b6-8dbb-6e995d1130bc';
const PO_NUMBER_FIELD_ID = '7830276e-f1bb-4efc-8e87-e34693cbd712';
const BUSINESS_UNIT_FIELD_ID = 'fdf29394-d070-4384-863c-9f2f5885061f';

export async function pollQuotes() {
  try {
    const config = await getXeroConfig(TENANT_ID);
    let lastUpdatedDateUTC: string | null = config?.quotesLastSyncUTC ?? null;

    const ACCESS_TOKEN = await getAccessToken();

    const headers: Record<string, string> = {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'xero-tenant-id': TENANT_ID,
      Accept: 'application/json',
    };
    if (lastUpdatedDateUTC) {
      headers['If-Modified-Since'] = new Date(lastUpdatedDateUTC).toUTCString();
    }

    let page = 1;
    let allQuotes: Quote[] = [];

    while (true) {
      const url = `https://api.xero.com/api.xro/2.0/Quotes?order=UpdatedDateUTC DESC&page=${page}&pageSize=100`;

      const res = await fetch(url, { method: 'GET', headers });

      if (res.status === 304) {
        console.log('No new or updated quotes.');
        return;
      }

      if (!res.ok) {
        throw new Error(`Failed to fetch quotes: ${res.statusText}`);
      }

      const data = (await res.json()) as XeroQuotesResponse;

      if (!data.Quotes || data.Quotes.length === 0) {
        break;
      }

      allQuotes = allQuotes.concat(data.Quotes);

      if (data.Quotes.length < 100) {
        break;
      }

      page++;
    }

    if (allQuotes.length === 0) {
      console.log('No quotes found.');
      return;
    }
    logger.info(`✅ Total Purchase Orders Retrieved: ${allQuotes.length}`);
    logger.info('Last Sync Used:', lastUpdatedDateUTC);
    // console.log('Quote ',allQuotes);
    logger.info('--------------------------------------------');

    for (const quote of allQuotes) {
      const rawTimestamp = quote.UpdatedDateUTC.replace(/\/Date\((\d+)\)\//, '$1');
      const updatedISO = new Date(parseInt(rawTimestamp)).toISOString();
      if (!lastUpdatedDateUTC || new Date(updatedISO) > new Date(lastUpdatedDateUTC)) {
        await handleQuoteStatuses(quote);
      }
    }

    // Update lastUpdatedDateUTC to newest record (keep in UTC for comparison)
    const newestQuote = allQuotes.reduce((prev, curr) => {
      const prevDate = new Date(prev.UpdatedDateUTC.replace(/\/Date\((\d+)\)\//, '$1'));
      const currDate = new Date(curr.UpdatedDateUTC.replace(/\/Date\((\d+)\)\//, '$1'));
      return currDate > prevDate ? curr : prev;
    });

    const newestRaw = newestQuote.UpdatedDateUTC.replace(/\/Date\((\d+)\)\//, '$1');
    const newestSync = new Date(parseInt(newestRaw)).toISOString();

    await updateXeroConfig(TENANT_ID, { quotesLastSyncUTC: newestSync });
    logger.info('🕒 New Quote Order SyncTimestamp Stored:', newestSync);
  } catch (err) {
    console.error('❌ Error polling quotes:', err);
  }
}

export async function handleQuoteStatuses(quote: Quote) {
  const existingQuote = await getQuoteByNumber(quote.QuoteNumber);

  let quoteAction = 'Created';
  const quoteIssueDate = quote.DateString
    ? new Date(quote.DateString).toISOString()
    : new Date().toISOString();

  const quoteExpireyDate = quote.ExpiryDateString
    ? new Date(quote.ExpiryDateString).toISOString()
    : new Date().toISOString();

  if (existingQuote) {
    const lineItemsChanged =
      JSON.stringify(existingQuote.lineItems) !== JSON.stringify(quote.LineItems);

    const totalsChanged =
      existingQuote.subTotal !== quote.SubTotal ||
      existingQuote.taxTotal !== quote.TotalTax ||
      existingQuote.quTotal !== quote.Total;

    if (quote.Status !== existingQuote.quoteStatus) {
      switch (quote.Status) {
        case 'SENT':
          quoteAction = 'Sent';
          break;
        case 'ACCEPTED':
          quoteAction = 'Accepted';
          break;
        case 'DELETED':
          quoteAction = 'Deleted';
          break;
      }
    } else if (lineItemsChanged || totalsChanged) {
      quoteAction = existingQuote.quoteStatus === 'SENT' ? 'Revision After Sent' : 'Updated';
    } else {
      logger.info(`No changes for quote ${quote.QuoteNumber}`);
      return;
    }

    const updates: any = {
      quoteNumber: quote.QuoteNumber,
      quoteReference: quote.Reference,
      customerID: quote.Contact?.ContactID || '',
      customerName: quote.Contact?.Name || '',
      quoteIssueDate,
      quoteExpireyDate,
      quoteStatus: quote.Status,
      currencyCode: quote.CurrencyCode,
      lineItems: quote.LineItems,
      subTotal: quote.SubTotal,
      taxTotal: quote.TotalTax,
      quTotal: quote.Total,
      title: quote.Title,
      invNumber: existingQuote.invNumber,
      PoNumber: existingQuote.PoNumber,
      quoteAction,
      businessUnitvalueid: existingQuote.businessUnitvalueid,
      businessUnitvalue: existingQuote.businessUnitvalue,
      // Preserve existing task IDs
      clickUpTaskidCrm1: existingQuote.clickUpTaskidCrm1,
      clickUpTaskidCrm2: existingQuote.clickUpTaskidCrm2,
      clickUpTaskidCrm5: existingQuote.clickUpTaskidCrm5,
      clickUpTaskidCrm7: existingQuote.clickUpTaskidCrm7,
      clickUpTaskidCrm9: existingQuote.clickUpTaskidCrm9,
      quoteId: existingQuote.quoteId || quote.QuoteID,
      createdAt: existingQuote.createdAt,
    };

    // Handle task creation/updates based on quote action
    await handleQuoteTasks(updates, quoteAction);

    await updateQuote(existingQuote.id, updates);
  } else {
    //  NEW QUOTE
    const newItem: any = {
      id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      quoteId: quote.QuoteID,
      quoteNumber: quote.QuoteNumber,
      quoteReference: quote.Reference || '',
      customerID: quote.Contact?.ContactID || '',
      customerName: quote.Contact?.Name || '',
      quoteIssueDate,
      quoteExpireyDate,
      title: quote.Title || quote.QuoteNumber + ', ' + quote.Contact?.Name + ', ' + quote.Reference,
      PoNumber: '',
      quoteStatus: quote.Status || '',
      currencyCode: quote.CurrencyCode || '',
      lineItems: quote.LineItems || [],
      subTotal: quote.SubTotal || 0,
      taxTotal: quote.TotalTax || 0,
      quTotal: quote.Total || 0,
      invNumber: '',
      quoteAction: 'Created',
      businessUnitvalueid: '',
      businessUnitvalue: '',
      clickUpTaskidCrm1: '',
      clickUpTaskidCrm2: '',
      clickUpTaskidCrm5: '',
      clickUpTaskidCrm7: '',
      clickUpTaskidCrm9: '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Handle task creation for new quote
    await handleQuoteTasks(newItem, 'Created');

    await createQuote(newItem);
  }

  logger.info(`Quote ${quote.QuoteNumber} processed with action: ${quoteAction}`);
}

async function handleQuoteTasks(quote: any, action: string) {
  switch (action) {
    case 'Created':
      // Create task in CRM 1 only
      if (!quote.clickUpTaskidCrm1) {
        const task = await createClickUpTaskForCRM('CRM1', 'Created', quote);
        if (task) {
          quote.clickUpTaskidCrm1 = task.id;
        }
      }
      break;

    case 'Sent':
      // Create task in CRM 2
      if (!quote.clickUpTaskidCrm2) {
        const taskCrm2 = await createClickUpTaskForCRM('CRM2', 'Sent', quote);
        if (taskCrm2) {
          quote.clickUpTaskidCrm2 = taskCrm2.id; // <-- now the ID is stored
        }
      }

      // Mark CRM 1 task with the status from buildClickUpPayload
      if (quote.clickUpTaskidCrm1) {
        const { status } = await buildClickUpPayload(action, quote, 'CRM1');
        await updateClickUpTaskStatus(quote.clickUpTaskidCrm1, status);
        await addClickUpComment(quote.clickUpTaskidCrm1, 'Quote updated and sent');

        // ✅ ADD THE LINK HERE (after the CRM‑02 ID is available)
        if (quote.clickUpTaskidCrm2) {
          await addClickUpComment(
            quote.clickUpTaskidCrm1,
            `Task moved to CRM-02\nhttps://app.clickup.com/t/${quote.clickUpTaskidCrm2}`
          );
        }

        // Update CRM‑01 description with the link (handled by buildClickUpPayload)
        await updateClickUpTask(quote.clickUpTaskidCrm1, quote, action, 'CRM1');
      }
      break;

    case 'Revision After Sent':
      // Update existing quote in CRM 2 (pass CRM2 to updateClickUpTask)
      if (quote.clickUpTaskidCrm2) {
        const taskid = await updateClickUpTask(quote.clickUpTaskidCrm2, quote, action, 'CRM2');
        if (taskid) {
          await addClickUpComment(taskid, 'Quote Revised');
        }
      }
      break;

    case 'Accepted':
      // Update task in CRM 2 (pass CRM2 to updateClickUpTask)
      if (quote.clickUpTaskidCrm2) {
        const taskid = await updateClickUpTask(quote.clickUpTaskidCrm2, quote, action, 'CRM2');
        await addClickUpComment(
          quote.clickUpTaskidCrm2,
          '@sales please upload PO and select Process'
        );
      }

      // Create task in CRM 5 if not exists
      if (!quote.clickUpTaskidCrm5) {
        const taskCrm5 = await createClickUpTaskForCRM('CRM5', 'Accepted', quote);
        if (taskCrm5) {
          quote.clickUpTaskidCrm5 = taskCrm5.id;
        }
      }

      // Create task in CRM 7 if not exists
      if (!quote.clickUpTaskidCrm7) {
        const taskCrm7 = await createClickUpTaskForCRM('CRM7', 'Accepted', quote);
        if (taskCrm7) {
          quote.clickUpTaskidCrm7 = taskCrm7.id;
        }
      }

      // After creating CRM7, update CRM5 to include CRM7 link
      if (quote.clickUpTaskidCrm5 && quote.clickUpTaskidCrm7) {
        await updateClickUpTask(quote.clickUpTaskidCrm5, quote, action, 'CRM5');
      }
      break;

    case 'Updated':
      // Update CRM 1 task (pass CRM1 to updateClickUpTask)
      if (quote.clickUpTaskidCrm1) {
        const taskid = await updateClickUpTask(quote.clickUpTaskidCrm1, quote, action, 'CRM1');
        if (taskid) {
          await addClickUpComment(taskid, 'Quote Updated');
        }
      }
      break;
  }
}
async function createClickUpTaskForCRM(crm: string, action: string, quote: any): Promise<any> {
  const { topic, listid, description, status, customFields, comment, due_date, quoteUrl } =
    await buildClickUpPayload(action, quote, crm);

  const task = await createClickUpTask(description, topic, listid, status, customFields, due_date);

  if (!task) {
    logger.error(`Failed to create task for ${quote.quoteNumber} in ${crm}`);
    return null;
  }

  await addClickUpComment(task.id, comment);

  logger.info(`Created task ${task.id} for ${quote.quoteNumber} in ${crm}`);
  return task;
}

export async function updateClickUpTaskStatus(taskId: string, status: string) {
  const url = `https://api.clickup.com/api/v2/task/${taskId}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      status,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error(`Failed to update ClickUp task ${taskId} status: ${err}`);
    return;
  }

  logger.info(`Updated ClickUp task ${taskId} status to ${status}`);
}

export async function buildClickUpPayload(action: string, quote: any, crm: string = 'CRM1') {
  let topic = `${quote.quoteNumber} ,${quote.customerName} ,${quote.title}`;

  const { listid, status, description, customFields, comment, due_date, quoteUrl } =
    await constructClickUpPayload(action, quote, crm);

  return { topic, listid, description, status, customFields, comment, due_date, quoteUrl };
}

async function constructClickUpPayload(
  action: string,
  quote: any,
  crm: string = 'CRM1'
): Promise<{
  listid: string;
  status: string;
  description: string;
  customFields: any[];
  comment: string;
  due_date: number;
  quoteUrl: string;
}> {
  let listid = '';
  let status = '';
  // Build quote items (used by some cases)
  const quoteItemsCrm = (quote.lineItems || [])
    .map((item: any, index: number) => {
      const taxRate =
        item.LineAmount && item.LineAmount !== 0
          ? ((item.TaxAmount / item.LineAmount) * 100).toFixed(2)
          : '0.00';
      return `Item ${index + 1}:
    - Item Description: ${item.Description}
    - Item Quantity: ${item.Quantity}`;
    })
    .join('\n\n');

  const quoteItemsText = (quote.lineItems || [])
    .map((item: any, index: number) => {
      const taxRate =
        item.LineAmount && item.LineAmount !== 0
          ? ((item.TaxAmount / item.LineAmount) * 100).toFixed(2)
          : '0.00';
      return `Item ${index + 1}:
    - Item Description: ${item.Description}
    - Item Quantity: ${item.Quantity}
    - Item Unit Cost: ${item.UnitAmount}
    - Account Code: ${item.AccountCode || 'N/A'}
    - Line Total: ${item.LineAmount}
    - Tax Rate: ${taxRate}%`;
    })
    .join('\n\n');

  const totalsText = `
Quote Currency: ${quote.currencyCode}
Quote Subtotal: ${quote.subTotal}
Quote Discount: ${quote.totalDiscount || 0}
Quote Tax: ${quote.taxTotal}
Quote Total: ${quote.quTotal}
`;

  const viewOrEdit = quote.quoteStatus === 'DRAFT' ? 'edit' : 'view';
  const quoteUrl = `${Xero_Url}${viewOrEdit}/${quote.quoteId}`;
  const relatedTasksSection = getRelatedTasksSection(quote, crm);

  let description = '';
  let comment = '';
  let due_date = 0;
  let customFields: any[] = [];

  let chatId: string;

  if (process.env.NODE_ENV === 'development') {
    chatId = process.env.chartIDTest || '';
  } else {
    chatId = '';
  }

  if (crm === 'CRM1') {
    listid = process.env.CRM1_LIST_ID!;
    status = action.toLowerCase() === 'sent' ? 'complete' : 'to do';
    due_date = new Date(quote.quoteIssueDate).getTime() + 2 * 24 * 60 * 60 * 1000;
    // For CRM1, we skip the Business Unit line in the description
    let relatedSection = '';
    if (action === 'Sent' && quote.clickUpTaskidCrm2) {
      relatedSection = `**Related Tasks**\nCRM-02 - https://app.clickup.com/t/${quote.clickUpTaskidCrm2}\n\n`;
    }
    const baseDescription = `${relatedSection}
Description:
Scope of Work - ${quote.title}
Quote Status - ${quote.quoteStatus}
Quote Expiry - ${quote.quoteExpireyDate}

Quote Link - ${quoteUrl}

Quote Items:
${quoteItemsText}

${totalsText}
`;
    // Remove any potential extra blank lines
    description = baseDescription.replace(/\n\n\n+/g, '\n\n');

    // Custom fields for CRM1
    customFields = [{ id: CUSTOMER_FIELD_ID, value: quote.customerName }];

    if (action === 'Created') {
      comment = 'Quote Created.';
    }
    if (action.toLowerCase() === 'sent') {
      comment = 'Quote Updated and sent';
    }
  } else if (crm === 'CRM2') {
    due_date = new Date(quote.quoteExpireyDate).getTime();
    listid = process.env.CRM2_LIST_ID!;
    status = 'to do';
    customFields = [{ id: CUSTOMER_FIELD_ID, value: quote.customerName }];
    description = `${relatedTasksSection}
Description:
Scope of Work - ${quote.title}
Quote Status - ${quote.quoteStatus}
Quote Expiry - ${quote.quoteExpireyDate}

Quote Link - ${quoteUrl}

Quote Items:
${quoteItemsText}

${totalsText}
`;
    if (action === 'Sent') {
      comment = '@sales please upload quotation pdf.';
    }
  } else if (crm === 'CRM5') {
    listid = process.env.CRM5_LIST_ID!;
    status = 'to do';
    customFields = [
      { id: CUSTOMER_FIELD_ID, value: quote.customerName },
      { id: BUSINESS_UNIT_FIELD_ID, value: quote.businessUnitvalueid },
    ];
    description = `${relatedTasksSection}

Quote Number - ${quote.quoteNumber}
PO Number - ${quote.PoNumber}

Description:
Scope of Work - ${quote.title}
Quote Link - ${quoteUrl}

Quote Items:
${quoteItemsCrm}
`;

    //message for telegram
    const telegrammsg = `Name: ${quote.title}
Scope of Work - ${quote.title}
Quote Link - ${quoteUrl}

Quote Items:
${quoteItemsCrm}
`;

    //send to telegram
    await telegramService.sendMessage(telegrammsg, chatId as string);
  } else if (crm === 'CRM7') {
    listid = process.env.CRM7_LIST_ID!;
    status = 'to do';
    customFields = [
      { id: CUSTOMER_FIELD_ID, value: quote.customerName },
      { id: BUSINESS_UNIT_FIELD_ID, value: quote.businessUnitvalueid },
    ];
    description = `${relatedTasksSection}

Quote Number - ${quote.quoteNumber}
PO Number - ${quote.PoNumber}

Description:
Scope of Work - ${quote.title}
Quote Link - ${quoteUrl}

Quote Items:
${quoteItemsCrm}

`;
  }

  return { listid, status, description, customFields, comment, due_date, quoteUrl };
}

async function updateClickUpTask(taskId: string, quote: any, action: string, crm: string = 'CRM1') {
  const { topic, description, status } = await buildClickUpPayload(action, quote, crm);

  const url = `https://api.clickup.com/api/v2/task/${taskId}`;

  const res = await fetch(url, {
    method: 'PUT',
    headers: {
      Authorization: API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: topic,
      description,
      status: status,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    logger.error(`Failed to update ClickUp task ${taskId}: ${err}`);
    return;
  }

  logger.info(`Updated ClickUp task ${taskId}`);
  return taskId;
}
async function createClickUpTask(
  description: string,
  topic: string,
  listId: string,
  status: string,
  customFields: any[],
  due_date: number
): Promise<ClickUpTaskResponse> {
  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: 'POST',
    headers: {
      Authorization: API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: topic,
      description,
      status: status,
      due_date: due_date,
      custom_fields: customFields,
    }),
  });

  if (!res.ok) {
    throw new Error(await res.text());
  }

  return (await res.json()) as ClickUpTaskResponse;
}

function getRelatedTasksSection(quote: any, crm: string): string {
  const taskIds = {
    crm1: quote.clickUpTaskidCrm1,
    crm2: quote.clickUpTaskidCrm2,
    crm5: quote.clickUpTaskidCrm5,
    crm7: quote.clickUpTaskidCrm7,
    crm9: quote.clickUpTaskidCrm9,
  };

  const links: string[] = [];

  switch (crm) {
    case 'CRM2':
      if (taskIds.crm1) links.push(`CRM-01 - https://app.clickup.com/t/${taskIds.crm1}`);
      break;
    case 'CRM5':
      if (taskIds.crm1) links.push(`CRM-01 - https://app.clickup.com/t/${taskIds.crm1}`);
      if (taskIds.crm2) links.push(`CRM-02 - https://app.clickup.com/t/${taskIds.crm2}`);
      if (taskIds.crm7) links.push(`CRM-07 - https://app.clickup.com/t/${taskIds.crm7}`);
      break;
    case 'CRM7':
      if (taskIds.crm1) links.push(`CRM-01 - https://app.clickup.com/t/${taskIds.crm1}`);
      if (taskIds.crm2) links.push(`CRM-02 - https://app.clickup.com/t/${taskIds.crm2}`);
      if (taskIds.crm5) links.push(`CRM-05 - https://app.clickup.com/t/${taskIds.crm5}`);
      break;
    // CRM1 and CRM9 remain unchanged (no links needed)
  }

  if (links.length === 0) return '';

  return `**Related Tasks**\n${links.join('\n')}\n\n`;
}

export async function addClickUpComment(taskId: string, commentText: string) {
  if (!commentText) return;
  const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/comment`, {
    method: 'POST',
    headers: {
      Authorization: API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ comment_text: commentText }),
  });
  if (!res.ok) console.error('Comment failed:', await res.text());
}

export async function uploadAttachmentToClickUpTask(taskId: string, fileUrl: string) {
  if (!API_TOKEN) throw new Error('ClickUp token not set');

  const fileResponse = await fetch(fileUrl);
  if (!fileResponse.ok) {
    throw new Error(`Failed to download file from ${fileUrl}: ${fileResponse.statusText}`);
  }

  const arrayBuffer = await fileResponse.arrayBuffer(); // No deprecation
  const buffer = Buffer.from(arrayBuffer);

  const filename = fileUrl.split('/').pop() || 'attachment';

  const formData = new FormData();
  formData.append('attachment', buffer, filename);

  const response = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/attachment`, {
    method: 'POST',
    headers: {
      Authorization: API_TOKEN,
      // Let fetch set Content-Type automatically
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to upload attachment: ${response.status} ${errorText}`);
  }

  return await response.json();
}

// Extract Quote Name (quote number) from task
export function extractQuoteName(task: any): string | null {
  if (!task.name) return null;

  // Take the first part before the first comma
  const quoteName = task.name.split(',')[0].trim();
  return quoteName || null;
}
