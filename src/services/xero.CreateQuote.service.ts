// import fetch from 'node-fetch';
// import { getAccessToken } from '../helper/tokens/token.helper';
// import { QuoteData } from '../schema/xero.schema';

// const TENANT_ID = process.env.XERO_TENANT_ID!;

// // Create a quote in Xero
// export async function createXeroQuote(data: QuoteData) {
//   const ACCESS_TOKEN = await getAccessToken();

//   const body = {
//     Type: 'ACCREC',
//     Contact: { ContactID: data.contactId },
//     Reference: data.reference,
//     Date: data.date,
//     ExpiryDate: data.expiryDate,
//     LineItems: data.lineItems,
//   };

//   const res = await fetch('https://api.xero.com/api.xro/2.0/Quotes', {
//     method: 'POST',
//     headers: {
//       Authorization: `Bearer ${ACCESS_TOKEN}`,
//       'xero-tenant-id': TENANT_ID,
//       'Content-Type': 'application/json',
//       Accept: 'application/json',
//     },
//     body: JSON.stringify(body),
//   });

//   const result = await res.json();

//   console.log('Quote creation response:', JSON.stringify(result, null, 2));
//   return result;
// }

// src/services/xero.CreateQuote.service.ts  (MODIFIED - search "XERO-API-ESCALATION")
import fetch from 'node-fetch';
import {
  getAccessToken,
  raiseXeroApiEscalation,
  clearXeroApiEscalation,
} from '../helper/tokens/token.helper';
import { QuoteData } from '../schema/xero.schema';

const TENANT_ID = process.env.XERO_TENANT_ID!;

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

  const result: any = await res.json().catch(() => ({}));

  console.log('Quote creation response:', JSON.stringify(result, null, 2));

  // XERO-API-ESCALATION: Xero errors used to be returned to the app as success. Fail loudly instead.
  if (!res.ok) {
    const detail = JSON.stringify(result).slice(0, 1500);
    await raiseXeroApiEscalation(
      'quote-create',
      `Xero quote creation is failing (${res.status} ${res.statusText})`,
      `Creating a quote in Xero for tenant ${TENANT_ID} returned ${res.status} ${res.statusText}.\n\n` +
        `Xero said: ${detail}\n\nReference: ${data.reference || '-'}. ` +
        `401/403 usually means a missing scope or a disconnected organisation: re-connect via /api/v1/xero/connect.`
    );
    throw new Error(`Xero rejected the quote: ${res.status} ${res.statusText} ${detail}`);
  }
  clearXeroApiEscalation('quote-create');
  return result;
}
