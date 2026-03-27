import { Request, Response } from 'express';
import crypto from 'crypto';
import fetch from 'node-fetch';
import logger from '../utils/logger';
import { getAccessToken } from '../helper/tokens/token.helper';
import { Contact, XeroWebhookEvent, XeroWebhookPayload } from '../schema/xero.schema';
import {
  createInvoice,
  getInvByXeroInvoiceId,
  updateInvoice,
} from '../repositories/xero.invoice.repository';
import { updateClickUpTask } from './xero.purchaseorder.controller';
import { addClickUpComment } from '../services/xero.quote.service';

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

export interface XeroInvoice {
  InvoiceID: string;
  InvoiceNumber?: string;
  Reference?: string;
  xeroQuoteId: string;

  Status: string;

  DateString?: string;
  DueDateString?: string;

  CurrencyCode?: string;

  SubTotal?: number;
  TotalTax?: number;
  Total?: number;

  AmountPaid?: number;
  AmountDue?: number;

  Contact?: {
    ContactID?: string;
    Name?: string;
  };

  LineItems?: LineItem[];
}
interface XeroInvoiceResponse {
  Invoices: XeroInvoice[];
}

interface Subscription {
  Status: string;
  Plan?: { Name: string };
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

/*
|--------------------------------------------------------------------------
| Invoice Handler
|--------------------------------------------------------------------------
*/

async function handleInvoiceEvent(event: XeroWebhookEvent) {
  try {
    const data = await fetchFromXero<XeroInvoiceResponse>(event.resourceUrl, event.tenantId);

    const invoice = data?.Invoices?.[0];
    if (!invoice) return;

    const status = invoice.Status;
    const amountPaid = invoice.AmountPaid || 0;
    const amountDue = invoice.AmountDue || 0;
    if (status === 'DRAFT') {
      logger.info('🟡 CREATE INVOICE (DRAFT)');

      // Guard: don't create duplicates
      const existingInv = await getInvByXeroInvoiceId(invoice.InvoiceID);
      if (existingInv) {
        logger.info(`Invoice ${invoice.InvoiceNumber} already exists, skipping create`);
        return;
      }

      const newItem: any = {
        id: `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,

        // Core
        invoiceId: invoice.InvoiceID,
        invoiceNumber: invoice.InvoiceNumber || '',

        // Link to quote
        xeroQuoteId: `temp-${Date.now()}-${Math.random().toString(36).substring(2, 4)}`,
        quoteNumber: 'NO_QUOTE',

        reference: invoice.Reference || '',

        // Customer
        customerID: invoice.Contact?.ContactID || '',
        customerName: invoice.Contact?.Name || '',

        // Dates
        invoiceDate: null,
        dueDate: null,

        // Status
        status: invoice.Status || 'DRAFT',
        invoiceAction: 'Created',

        // Currency
        currencyCode: invoice.CurrencyCode || '',

        // Line items
        lineItems: invoice.LineItems || [],

        // Totals
        subTotal: invoice.SubTotal || 0,
        taxTotal: invoice.TotalTax || 0,
        total: invoice.Total || 0,

        amountPaid: invoice.AmountPaid || 0,
        amountDue: invoice.AmountDue || 0,

        // Extra fields
        PoNumber: '', // empty string

        businessUnitvalueid: '', // empty string
        businessUnitvalue: '', // empty string

        // CRM
        clickUpTaskidCrm1: '',
        clickUpTaskidCrm2: '',
        clickUpTaskidCrm5: '',
        clickUpTaskidCrm7: '',
        clickUpTaskidCrm9: '',

        // timestamps
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      // Save to Dynamo
      await createInvoice(newItem);
    }
    if (status === 'AUTHORISED' && amountPaid === 0) {
      const existingInv = await getInvByXeroInvoiceId(invoice.InvoiceID); // fetch by invoiceId
      logger.info('🟢 APPROVED INVOICE');

      let invoiceAction = 'Approved';
      const invoiceDate = invoice.DateString
        ? new Date(invoice.DateString).toISOString()
        : new Date().toISOString();
      const dueDate = invoice.DueDateString
        ? new Date(invoice.DueDateString).toISOString()
        : new Date().toISOString();

      if (existingInv) {
        // Check if line items or totals changed
        const lineItemsChanged =
          JSON.stringify(existingInv.lineItems) !== JSON.stringify(invoice.LineItems);

        const totalsChanged =
          existingInv.subTotal !== invoice.SubTotal ||
          existingInv.taxTotal !== invoice.TotalTax ||
          existingInv.total !== invoice.Total;

        // Adjust invoiceAction if something changed
        if (existingInv.status !== invoice.Status) {
          invoiceAction = 'Approved';
        } else if (lineItemsChanged || totalsChanged) {
          invoiceAction = 'Updated';
        } else {
          logger.info(`No changes for invoice ${invoice.InvoiceNumber}`);
          return;
        }

        const updates: any = {
          invoiceNumber: invoice.InvoiceNumber,
          reference: invoice.Reference || '',
          customerID: invoice.Contact?.ContactID || '',
          customerName: invoice.Contact?.Name || '',
          invoiceDate,
          dueDate,
          status: invoice.Status,
          currencyCode: invoice.CurrencyCode,
          lineItems: invoice.LineItems || [],
          subTotal: invoice.SubTotal,
          taxTotal: invoice.TotalTax,
          total: invoice.Total,
          amountPaid: invoice.AmountPaid || 0,
          amountDue: invoice.AmountDue || 0,
          PoNumber: existingInv.PoNumber || '',
          invoiceAction,
          businessUnitvalueid: existingInv.businessUnitvalueid,
          businessUnitvalue: existingInv.businessUnitvalue,
          clickUpTaskidCrm1: existingInv.clickUpTaskidCrm1,
          clickUpTaskidCrm2: existingInv.clickUpTaskidCrm2,
          clickUpTaskidCrm5: existingInv.clickUpTaskidCrm5,
          clickUpTaskidCrm7: existingInv.clickUpTaskidCrm7,
          clickUpTaskidCrm9: existingInv.clickUpTaskidCrm9,
          xeroQuoteId: existingInv.xeroQuoteId || '0000',
          createdAt: existingInv.createdAt,
        };

        const description = `
    Description:
    Invoice Date Sent - ${invoiceDate}
    Invoice Amount - ${amountDue}
    Due Date - ${dueDate}
  `;

        await updateClickUpTask(existingInv.clickUpTaskidCrm9, description);

        await addClickUpComment(existingInv.clickUpTaskidCrm9, 'Invoice Approved.');
        // Update Dynamo
        await updateInvoice(existingInv.id, updates);
      }
    } else if (amountPaid > 0) {
      logger.info('💰 PAYMENT RECORDED');

      // Fetch existing invoice by invoiceId
      const existingInv = await getInvByXeroInvoiceId(invoice.InvoiceID);

      if (!existingInv) {
        logger.warn(`Invoice not found in DB: ${invoice.InvoiceNumber}`);
        return;
      }

      // Determine if any key fields changed (optional)
      const lineItemsChanged =
        JSON.stringify(existingInv.lineItems) !== JSON.stringify(invoice.LineItems);

      const totalsChanged =
        existingInv.subTotal !== invoice.SubTotal ||
        existingInv.taxTotal !== invoice.TotalTax ||
        existingInv.total !== invoice.Total;

      let invoiceAction = 'Payment Recorded';
      if (lineItemsChanged || totalsChanged) {
        invoiceAction = 'Updated';
      }

      const invoiceDate = invoice.DateString
        ? new Date(invoice.DateString).toISOString()
        : existingInv.invoiceDate || new Date().toISOString();

      const dueDate = invoice.DueDateString
        ? new Date(invoice.DueDateString).toISOString()
        : existingInv.dueDate || new Date().toISOString();

      const updates: any = {
        invoiceNumber: invoice.InvoiceNumber,
        reference: invoice.Reference || '',
        customerID: invoice.Contact?.ContactID || '',
        customerName: invoice.Contact?.Name || '',
        invoiceDate,
        dueDate,
        status: invoice.Status,
        currencyCode: invoice.CurrencyCode || '',
        lineItems: invoice.LineItems || [],
        subTotal: invoice.SubTotal,
        taxTotal: invoice.TotalTax,
        total: invoice.Total,
        amountPaid: invoice.AmountPaid || 0,
        amountDue: invoice.AmountDue || 0,
        PoNumber: existingInv.PoNumber || '',
        invoiceAction,
        businessUnitvalueid: existingInv.businessUnitvalueid,
        businessUnitvalue: existingInv.businessUnitvalue,
        clickUpTaskidCrm1: existingInv.clickUpTaskidCrm1,
        clickUpTaskidCrm2: existingInv.clickUpTaskidCrm2,
        clickUpTaskidCrm5: existingInv.clickUpTaskidCrm5,
        clickUpTaskidCrm7: existingInv.clickUpTaskidCrm7,
        clickUpTaskidCrm9: existingInv.clickUpTaskidCrm9,
        xeroQuoteId: existingInv.xeroQuoteId || '0000',
        createdAt: existingInv.createdAt,
      };

      await updateInvoice(existingInv.id, updates);

      const description = `
      Description:
      Invoice Date Sent - ${updates.invoiceDate}
      Invoice Total - ${updates.total}
      Due Date - ${updates.dueDate}
      `;

      const comment = `
      Payment Amount - ${updates.amountPaid}
      Payment Date - ${updates.invoiceDate}
      Balance Remaining - ${updates.amountDue}
      `;

      //update the task in click up
      await updateClickUpTask(updates.clickUpTaskidCrm9, description);
      await addClickUpComment(existingInv.clickUpTaskidCrm9, comment);
    }
  } catch (err) {
    console.error('Invoice handler error:', err);
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
