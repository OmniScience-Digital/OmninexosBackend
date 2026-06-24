import fetch from 'node-fetch';
import { Quote, ClickUpTaskResponse } from '../schema/xero.schema';
import logger from '../utils/logger';
import {
  getQuoteByNumber,
  createQuote,
  updateQuote,
} from '../repositories/dynamo.quote.repository';

const API_TOKEN = process.env.CLICKUP_API_TOKEN!;
const CRM_SHAUGHN_LIST_ID = process.env.CRM_SHAUGHN_LIST_ID!;
const Xero_Url = process.env.Xero_Url!;

const CUSTOMER_FIELD_ID = 'b1b8b307-162d-46b6-8dbb-6e995d1130bc';
const VALUE_FIELD_ID = 'a515d39a-2f1e-4b1e-8279-21e6007b7912';
const QUOTE_NUMBER_FIELD_ID = '2bc85e1d-b40a-44eb-ad3f-2875e582dc51';

// ─── Status constants (must match the CRM-Shaughn list exactly) ───────────────
const STATUS_QUOTED = 'quoted';
const STATUS_SENT = 'sent';
const STATUS_ACCEPTED = 'accepted';

export async function syncQuoteToCrmShaughn(quote: Quote) {
  const existingQuote = await getQuoteByNumber(quote.QuoteNumber);

  const quoteIssueDate = quote.DateString
    ? new Date(quote.DateString).toISOString()
    : new Date().toISOString();

  const quoteExpireyDate = quote.ExpiryDateString
    ? new Date(quote.ExpiryDateString).toISOString()
    : new Date().toISOString();

  let action: 'Created' | 'Updated' | 'Sent' | 'Revised' | 'Accepted' = 'Created';

  if (existingQuote) {
    const lineItemsChanged =
      JSON.stringify(existingQuote.lineItems) !== JSON.stringify(quote.LineItems);
    const totalsChanged =
      existingQuote.subTotal !== quote.SubTotal ||
      existingQuote.taxTotal !== quote.TotalTax ||
      existingQuote.quTotal !== quote.Total;

    if (quote.Status !== existingQuote.quoteStatus) {
      if (quote.Status === 'SENT') {
        action = existingQuote.quoteStatus === 'SENT' ? 'Revised' : 'Sent';
      } else if (quote.Status === 'ACCEPTED') {
        action = 'Accepted';
      } else {
        action = 'Updated';
      }
    } else if (lineItemsChanged || totalsChanged) {
      action = existingQuote.quoteStatus === 'SENT' ? 'Revised' : 'Updated';
    } else {
      logger.info(`[CRM Shaughn] No changes for quote ${quote.QuoteNumber}`);
      return { skipped: true, quoteNumber: quote.QuoteNumber };
    }
  } else {
    switch (quote.Status) {
      case 'SENT':
        action = 'Sent';
        break;
      case 'ACCEPTED':
        action = 'Accepted';
        break;
      default:
        action = 'Created';
        break;
    }
  }

  const record: any = {
    id: existingQuote?.id || `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
    quoteId: existingQuote?.quoteId || quote.QuoteID,
    quoteNumber: quote.QuoteNumber,
    quoteReference: quote.Reference || '',
    customerID: quote.Contact?.ContactID || '',
    customerName: quote.Contact?.Name || '',
    quoteIssueDate,
    quoteExpireyDate,
    title: quote.Title || `${quote.QuoteNumber}, ${quote.Contact?.Name}, ${quote.Reference || ''}`,
    quoteStatus: quote.Status || '',
    currencyCode: quote.CurrencyCode || '',
    lineItems: quote.LineItems || [],
    subTotal: quote.SubTotal || 0,
    taxTotal: quote.TotalTax || 0,
    quTotal: quote.Total || 0,
    totalDiscount: quote.TotalDiscount || 0,
    clickUpTaskidCrmShaughn: existingQuote?.clickUpTaskidCrmShaughn || '',
    createdAt: existingQuote?.createdAt || new Date().toISOString(),
  };

  await handleCrmShaughnTask(record, action);

  if (existingQuote) {
    const { id, ...updates } = record;
    await updateQuote(existingQuote.id, updates);
  } else {
    await createQuote({ ...record, updatedAt: new Date().toISOString() });
  }

  logger.info(`[CRM Shaughn] Quote ${quote.QuoteNumber} processed with action: ${action}`);
  return { skipped: false, quoteNumber: quote.QuoteNumber, action };
}

async function handleCrmShaughnTask(quote: any, action: string) {
  const payload = buildShaughnPayload(action, quote);

  if (!quote.clickUpTaskidCrmShaughn) {
    const task = await createClickUpTask(
      payload.topic,
      payload.description,
      payload.listid,
      payload.status,
      payload.customFields,
      payload.due_date
    );
    if (!task) {
      logger.error(`[CRM Shaughn] Failed to create task for ${quote.quoteNumber}`);
      return;
    }
    quote.clickUpTaskidCrmShaughn = task.id;
    if (payload.comment) await addClickUpComment(task.id, payload.comment);
    logger.info(`[CRM Shaughn] Created task ${task.id} for ${quote.quoteNumber}`);
    return;
  }

  // Task already exists — update in place
  await updateClickUpTask(
    quote.clickUpTaskidCrmShaughn,
    payload.topic,
    payload.description,
    payload.status
  );
  if (payload.comment) await addClickUpComment(quote.clickUpTaskidCrmShaughn, payload.comment);
  logger.info(`[CRM Shaughn] Updated task ${quote.clickUpTaskidCrmShaughn} (${action})`);
}

// ─── Payload builder ──────────────────────────────────────────────────────────
// Spec reference: Current_CRM_Scope_Rev_0.pdf — "Trigger / Backend CRM-Shaughn" table
function buildShaughnPayload(action: string, quote: any) {
  const topic = `${quote.quoteNumber}, ${quote.customerName}, ${quote.title}`;

  const viewOrEdit = quote.quoteStatus === 'DRAFT' ? 'edit' : 'view';
  const quoteUrl = `${Xero_Url}${viewOrEdit}/${quote.quoteId}`;

  const now = Date.now();
  const DAY_MS = 24 * 60 * 60 * 1000;

  // ── Status & due date per action (spec) ──────────────────────────────────
  //  Created / Updated  → status: QUOTED,    due: now + 2 days
  //  Sent    / Revised  → status: SENT,      due: ExpiryDate
  //  Accepted           → status: ACCEPTED,  due: now + 14 days
  let status: string;
  let due_date: number;

  switch (action) {
    case 'Sent':
    case 'Revised':
      status = STATUS_SENT;
      due_date = new Date(quote.quoteExpireyDate).getTime();
      break;
    case 'Accepted':
      status = STATUS_ACCEPTED;
      due_date = now + 14 * DAY_MS;
      break;
    case 'Created':
    case 'Updated':
    default:
      status = STATUS_QUOTED;
      due_date = now + 2 * DAY_MS;
      break;
  }

  // ── Line items — spec uses detailed view for all except Accepted ──────────
  const detailedItems = (quote.lineItems || [])
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

  // Accepted uses simplified items (description + quantity only per spec)
  const simpleItems = (quote.lineItems || [])
    .map(
      (item: any, index: number) =>
        `Item ${index + 1}:
    - Item Description: ${item.Description}
    - Item Quantity: ${item.Quantity}`
    )
    .join('\n\n');

  const isAccepted = action === 'Accepted';
  const quoteItemsText = isAccepted ? simpleItems : detailedItems;

  // ── Totals block — spec omits unit-level tax on Accepted but keeps totals ─
  const totalsText = isAccepted
    ? `Quote Subtotal: ${quote.subTotal}
Quote Discount: ${quote.totalDiscount || 0}`
    : `Quote Currency: ${quote.currencyCode}
Quote Subtotal: ${quote.subTotal}
Quote Discount: ${quote.totalDiscount || 0}
Quote Tax: ${quote.taxTotal}
Quote Total: ${quote.quTotal}`;

  // ── Description layout (matches spec for every trigger row) ──────────────
  const baseDescription = `Description:
Scope of Work - ${quote.title}
Quote Status - ${quote.quoteStatus}
Quote Expiry - ${quote.quoteExpireyDate}

Quote Link - ${quoteUrl}

Quote Items:
${quoteItemsText}

${totalsText}
`;
  const description = baseDescription.replace(/\n\n\n+/g, '\n\n');

  // ── Custom fields — spec: Customer Name + Value (Subtotal) + Quote Number ─
  const customFields = [
    { id: CUSTOMER_FIELD_ID, value: quote.customerName },
    { id: VALUE_FIELD_ID, value: quote.subTotal },
    { id: QUOTE_NUMBER_FIELD_ID, value: quote.quoteNumber },
  ];

  // ── Comment per trigger ───────────────────────────────────────────────────
  const commentMap: Record<string, string> = {
    Created: 'Quote Created',
    Updated: 'Quote Updated',
    Sent: 'Quote Updated & Sent',
    Revised: 'Quote Revised',
    Accepted: 'Quote Accepted',
  };
  const comment = commentMap[action] ?? '';

  return {
    listid: CRM_SHAUGHN_LIST_ID,
    topic,
    status,
    due_date,
    description,
    customFields,
    comment,
    quoteUrl,
  };
}

// ─── ClickUp helpers ──────────────────────────────────────────────────────────

async function createClickUpTask(
  topic: string,
  description: string,
  listId: string,
  status: string,
  customFields: any[],
  due_date: number
): Promise<ClickUpTaskResponse | null> {
  const res = await fetch(`https://api.clickup.com/api/v2/list/${listId}/task`, {
    method: 'POST',
    headers: {
      Authorization: API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: topic,
      description,
      status,
      due_date,
      custom_fields: customFields,
    }),
  });

  if (!res.ok) {
    logger.error(`[CRM Shaughn] ClickUp create task error: ${await res.text()}`);
    return null;
  }

  return (await res.json()) as ClickUpTaskResponse;
}

async function updateClickUpTask(
  taskId: string,
  topic: string,
  description: string,
  status: string
) {
  const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}`, {
    method: 'PUT',
    headers: {
      Authorization: API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: topic, description, status }),
  });

  if (!res.ok) {
    logger.error(`[CRM Shaughn] ClickUp update task error for ${taskId}: ${await res.text()}`);
    return null;
  }

  return taskId;
}

async function addClickUpComment(taskId: string, commentText: string) {
  if (!commentText) return;
  const res = await fetch(`https://api.clickup.com/api/v2/task/${taskId}/comment`, {
    method: 'POST',
    headers: {
      Authorization: API_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ comment_text: commentText }),
  });
  if (!res.ok) {
    logger.error(`[CRM Shaughn] Failed to add comment to ${taskId}: ${await res.text()}`);
  }
}
