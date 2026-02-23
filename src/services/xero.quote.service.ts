import fetch from 'node-fetch';
import { client } from '../services/redis.service';

const TENANT_ID = process.env.XERO_TENANT_ID!;

interface XeroTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  id_token?: string;
  token_type?: string;
}

interface LineItem {
  Description: string;
  Quantity: number;
  UnitAmount: number;
  AccountCode: string;
}

interface QuoteData {
  contactId: string;
  reference: string;
  date: string;
  expiryDate: string;
  lineItems: LineItem[];
}

// Get a fresh access token using the refresh token
export async function getAccessToken(): Promise<string> {
  // Get refresh token from Redis
  const refreshToken = await client.get('xero:refresh_token');

  if (!refreshToken) {
    throw new Error('No refresh token found in Redis');
  }

  const params = new URLSearchParams();
  params.append('grant_type', 'refresh_token');
  params.append('refresh_token', refreshToken);
  params.append('client_id', process.env.XERO_CLIENT_ID!);
  params.append('client_secret', process.env.XERO_SECRET!);

  const res = await fetch('https://identity.xero.com/connect/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: params.toString(),
  });

  if (!res.ok) throw new Error(`Failed to refresh Xero token: ${res.statusText}`);

  const data = (await res.json()) as XeroTokenResponse;

  // Store the new refresh token in Redis
  await client.set('xero:refresh_token', data.refresh_token);

  return data.access_token;
}

// Create a quote in Xero
export async function createXeroQuote(data: QuoteData) {
  const ACCESS_TOKEN = await getAccessToken();

  const body = {
    Type: 'ACCREC',
    Contact: { ContactID: data.contactId },
    Reference: data.reference,
    Date: data.date,
    ExpiryDate: data.expiryDate,
    LineItems: data.lineItems,
  };

  const res = await fetch('https://api.xero.com/api.xro/2.0/Quotes', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${ACCESS_TOKEN}`,
      'xero-tenant-id': TENANT_ID,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  console.log('Quote creation response:', JSON.stringify(result, null, 2));
  return result;
}

// To create a quote we need a contact

// - A quote always belongs to a customer/contact.
// - You either:
//     1. Use an **existing contact** (like “Marine Systems”), or
//     2. **Create a new contact via the Contacts API** and then use its `ContactID` in the quote creation.
