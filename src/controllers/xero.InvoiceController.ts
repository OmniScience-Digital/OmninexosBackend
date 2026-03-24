import { Request, Response } from 'express';
import crypto from 'crypto';
import fetch from 'node-fetch';
import logger from '../utils/logger';
import { getAccessToken } from '../helper/tokens/token.helper';
import { Contact, XeroWebhookEvent, XeroWebhookPayload } from '../schema/xero.schema';

/*
|--------------------------------------------------------------------------
| Types
|--------------------------------------------------------------------------
*/

// Xero API response types
interface LineItem {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  AccountCode: string;
  LineAmount: number;
}

interface Invoice {
  InvoiceID: string;
  InvoiceNumber: string;
  Status: 'DRAFT' | 'AUTHORISED' | 'PAID' | 'VOIDED';

  Total: number;
  AmountPaid: number;
  AmountDue: number;

  Reference?: string;

  DateString?: string;
  DueDateString?: string;

  LineItems?: LineItem[];
}

interface Subscription {
  Status: string;
  Plan?: { Name: string };
}

interface XeroInvoiceResponse {
  Invoices: Invoice[];
}

interface XeroContactResponse {
  Contacts: Contact[];
}

interface XeroSubscriptionResponse {
  Subscriptions: Subscription[];
}

/*
|--------------------------------------------------------------------------
| Controller
|--------------------------------------------------------------------------
*/

export const xeroControllerRouter = async (req: Request, res: Response) => {
  try {
    const signature = req.headers['x-xero-signature'] as string;

    // Intent-to-receive test
    if (!signature) {
      console.log('✅ Intent-to-receive test passed');
      return res.status(200).send('OK');
    }

    const webhookKey = process.env.XERO_WEBHOOK_KEY;
    if (!webhookKey) {
      logger.error('XERO_WEBHOOK_KEY not configured');
      return res.status(500).send('Webhook key missing');
    }

    const rawBody = req.body as Buffer;

    const hmac = crypto.createHmac('sha256', webhookKey);
    hmac.update(rawBody);
    const computedSignature = hmac.digest('base64');

    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(computedSignature))) {
      logger.warn('❌ Invalid Xero signature');
      return res.status(401).send('Unauthorized');
    }

    console.log('🚀 Xero webhook verified, returning 200');

    // Return 200 immediately (important for Xero)
    res.status(200).send('OK');

    // Process asynchronously
    try {
      const payload: XeroWebhookPayload = JSON.parse(rawBody.toString('utf8'));
      await processWebhookEvents(payload);
    } catch (err) {
      logger.error('Failed to parse webhook payload:', err);
    }
  } catch (error) {
    logger.error('Error in Xero webhook:', error);
    if (!res.headersSent) res.status(500).send('Internal Server Error');
  }
};

/*
|--------------------------------------------------------------------------
| Core Processing
|--------------------------------------------------------------------------
*/

async function processWebhookEvents(payload: XeroWebhookPayload) {
  if (!payload.events?.length) return;

  for (const event of payload.events) {
    logger.info(`Processing: ${event.eventCategory} ${event.eventType} - ${event.resourceId}`);

    switch (event.eventCategory) {
      case 'INVOICE':
        await handleInvoiceEvent(event);
        break;

      case 'CONTACT':
        await handleContactEvent(event);
        break;

      case 'SUBSCRIPTION':
        await handleSubscriptionEvent(event);
        break;

      default:
        logger.warn(`Unhandled category: ${event.eventCategory}`);
    }
  }

  logger.info('✅ Webhook processing complete');
}

/*
|--------------------------------------------------------------------------
| Xero Fetch Helper
|--------------------------------------------------------------------------
*/

async function fetchFromXero<T>(url: string, tenantId: string): Promise<T> {
  const ACCESS_TOKEN = await getAccessToken();

  const res = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'xero-tenant-id': tenantId,
      Accept: 'application/json',
    },
  });

  if (!res.ok) throw new Error(`Xero fetch failed: ${res.status} ${res.statusText}`);

  return (await res.json()) as T;
}

/*
|--------------------------------------------------------------------------
| Invoice Handler
|--------------------------------------------------------------------------
*/

async function handleInvoiceEvent(event: XeroWebhookEvent) {
  try {
    logger.info('Fetching invoice..');
    const data = await fetchFromXero<XeroInvoiceResponse>(event.resourceUrl, event.tenantId);
    const invoice = data?.Invoices?.[0];
    if (!invoice) return;

    const status = invoice.Status;
    const amountPaid = invoice.AmountPaid || 0;
    const amountDue = invoice.AmountDue || 0;

    if (status === 'DRAFT') {
      console.log('🟡 CREATE INVOICE (DRAFT)');
      console.log('InvoiceNumber:', invoice.InvoiceNumber);
    } else if (status === 'AUTHORISED' && amountPaid === 0) {
      console.log('🟢 APPROVED INVOICE');
      console.log('InvoiceNumber:', invoice.InvoiceNumber);
      console.log('DueDate:', invoice.DueDateString);
    } else if (amountPaid > 0) {
      console.log('💰 PAYMENT RECORDED');
      console.log('InvoiceNumber:', invoice.InvoiceNumber);
      console.log('AmountPaid:', amountPaid);
      console.log('AmountDue:', amountDue);
    }

    // Line items (keep yours)
    const lineItems = invoice.LineItems || [];
    for (const item of lineItems) {
      console.log('---- LINE ITEM ----');
      console.log('Description:', item.Description);
      console.log('Quantity:', item.Quantity);
      console.log('UnitAmount:', item.UnitAmount);
      console.log('AccountCode:', item.AccountCode);
      console.log('LineAmount:', item.LineAmount);
    }
  } catch (err) {
    console.error('Invoice handler error:', err);
  }
}

/*
|--------------------------------------------------------------------------
| Contact Handler
|--------------------------------------------------------------------------
*/

async function handleContactEvent(event: XeroWebhookEvent) {
  try {
    const data = await fetchFromXero<XeroContactResponse>(event.resourceUrl, event.tenantId);
    const contact = data?.Contacts?.[0];
    if (!contact) return;

    // console.log('👤 Contact Name:', contact.Name);
    // console.log('Email:', contact.EmailAddress);

    // console.log(data);
  } catch (err) {
    logger.error('Contact handler error:', err);
  }
}

/*
|--------------------------------------------------------------------------
| Subscription Handler
|--------------------------------------------------------------------------
*/

async function handleSubscriptionEvent(event: XeroWebhookEvent) {
  try {
    const subscriptionUrl = `https://api.xero.com/subscriptions.xro/1.0/Subscriptions/${event.resourceId}`;
    const data = await fetchFromXero<XeroSubscriptionResponse>(subscriptionUrl, event.tenantId);
    const subscription = data?.Subscriptions?.[0];
    if (!subscription) return;

    // console.log('💳 Subscription Status:', subscription.Status);
    // console.log('Plan:', subscription.Plan?.Name);

    // console.log(data);
  } catch (err) {
    logger.error('Subscription handler error:', err);
  }
}

// const fetch = require("node-fetch");
// const fs = require("fs");

// async function downloadInvoicePdf(invoiceId) {
//   const response = await fetch(
//     `https://api.xero.com/api.xro/2.0/Invoices/${invoiceId}/pdf`,
//     {
//       method: "GET",
//       headers: {
//         "Authorization": "Bearer YOUR_ACCESS_TOKEN",
//         "Accept": "application/pdf",
//         "xero-tenant-id": "YOUR_TENANT_ID"
//       }
//     }
//   );

//   const buffer = await response.buffer();
//   fs.writeFileSync("invoice.pdf", buffer);
//   console.log("Invoice saved as invoice.pdf");
// }

// downloadInvoicePdf("INVOICE_ID_HERE");
