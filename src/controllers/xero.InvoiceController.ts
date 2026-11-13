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

interface XeroContactResponse {
  Contacts: Contact[];
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
      logger.info('✅ Webhook processing complete');
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
