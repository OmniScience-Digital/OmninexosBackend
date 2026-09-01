// import fetch from 'node-fetch';
// import crypto from 'crypto';

// const CLIENT_ID = process.env.XERO_CLIENT_ID!;
// const CLIENT_SECRET = process.env.XERO_SECRET!;
// const REDIRECT_URI = process.env.REDIRECT_URI!;

// const xeroService = {
//   getAuthUrl: (): string => {
//     const state = crypto.randomUUID();

//     const params = new URLSearchParams({
//       response_type: 'code',
//       client_id: CLIENT_ID,
//       redirect_uri: REDIRECT_URI,
//       scope:
//         'openid profile email accounting.invoices accounting.quotes accounting.contacts offline_access',
//       state,
//     });

//     return `https://login.xero.com/identity/connect/authorize?${params.toString()}`;
//   },

//   exchangeCodeForToken: async (code: string): Promise<any> => {
//     const body = new URLSearchParams({
//       grant_type: 'authorization_code',
//       code,
//       redirect_uri: REDIRECT_URI,
//     }).toString();

//     const response = await fetch('https://identity.xero.com/connect/token', {
//       method: 'POST',
//       headers: {
//         Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64'),
//         'Content-Type': 'application/x-www-form-urlencoded',
//       },
//       body,
//     });

//     if (!response.ok) throw new Error(`Token exchange failed: ${await response.text()}`);

//     return response.json();
//   },

//   getTenants: async (accessToken: string): Promise<any> => {
//     const response = await fetch('https://api.xero.com/connections', {
//       headers: { Authorization: `Bearer ${accessToken}` },
//     });

//     if (!response.ok) throw new Error(`Fetching tenants failed: ${await response.text()}`);

//     return response.json();
//   },

//   getBills: async (accessToken: string, tenantId: string): Promise<any> => {
//     const url = new URL('https://api.xero.com/api.xro/2.0/Invoices');
//     url.searchParams.append('where', 'Type=="ACCPAY"');

//     const response = await fetch(url.toString(), {
//       headers: {
//         Authorization: `Bearer ${accessToken}`,
//         'Xero-tenant-id': tenantId,
//         Accept: 'application/json',
//       },
//     });

//     if (!response.ok) throw new Error(`Fetching bills failed: ${await response.text()}`);

//     return response.json();
//   },

//   getInvoices: async (accessToken: string, tenantId: string): Promise<any> => {
//     const response = await fetch('https://api.xero.com/api.xro/2.0/Invoices', {
//       headers: {
//         Authorization: `Bearer ${accessToken}`,
//         'Xero-tenant-id': tenantId,
//         Accept: 'application/json',
//       },
//     });

//     if (!response.ok) throw new Error(`Fetching invoices failed: ${await response.text()}`);

//     return response.json();
//   },
// };

// export default xeroService;
import axios from 'axios';
import logger from '../utils/logger';

// NOTE: This is a reconstruction based on what xero.controller.ts calls
// (getAuthUrl, exchangeCodeForToken, getTenants, getBills, getInvoices).
// I don't have your original xero.service.ts, so merge this with your
// existing env/config loading, error handling conventions, and any
// additional logic (e.g. axios instance setup, retries) already in place.
// The key change vs. a typical version is that getAuthUrl now requires
// and forwards the `state` param end-to-end.

const CLIENT_ID = process.env.XERO_CLIENT_ID as string;
const CLIENT_SECRET = process.env.XERO_CLIENT_SECRET as string;
const REDIRECT_URI = process.env.XERO_REDIRECT_URI as string;

const AUTHORIZE_URL = 'https://login.xero.com/identity/connect/authorize';
const TOKEN_URL = 'https://identity.xero.com/connect/token';
const CONNECTIONS_URL = 'https://api.xero.com/connections';

// Granular scopes (post 2 March 2026 update). The old broad scopes
// (accounting.transactions, accounting.reports.read) are being retired —
// apps created on/after 2 March 2026 can't use them at all, and apps
// created before that date can opt into granular scopes now and must
// fully migrate by September 2027. accounting.invoices covers invoices,
// credit notes, purchase orders, quotes, repeating invoices, and items.
const SCOPES = [
  'openid',
  'profile',
  'email',
  'accounting.invoices', // invoices, credit notes, purchase orders, quotes, repeating invoices, items
  'accounting.payments', // batch payments, overpayments, payments, prepayments
  'accounting.banktransactions', // bank transactions, bank transfers
  'accounting.contacts',
  'accounting.settings',
  'offline_access',
].join(' ');

interface XeroTokenResponse {
  access_token: string;
  refresh_token: string;
  id_token?: string;
  expires_in: number;
  token_type: string;
}

interface XeroConnection {
  id: string;
  authEventId: string;
  tenantId: string;
  tenantType: string;
  tenantName: string | null;
  createdDateUtc: string;
  updatedDateUtc: string;
}

function basicAuthHeader(): string {
  return 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
}

const xeroService = {
  // Builds the Xero authorize URL. `state` is required now — the caller
  // (controller) generates it, stores it in a cookie, and must receive
  // the same value back on the callback before exchanging the code.
  getAuthUrl: (state: string): string => {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: SCOPES,
      state,
    });

    return `${AUTHORIZE_URL}?${params.toString()}`;
  },

  exchangeCodeForToken: async (code: string): Promise<XeroTokenResponse> => {
    try {
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
      });

      const { data } = await axios.post<XeroTokenResponse>(TOKEN_URL, body.toString(), {
        headers: {
          Authorization: basicAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      return data;
    } catch (error) {
      logger.error('Error exchanging Xero authorization code for token', error);
      throw error;
    }
  },

  refreshAccessToken: async (refreshToken: string): Promise<XeroTokenResponse> => {
    try {
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      });

      const { data } = await axios.post<XeroTokenResponse>(TOKEN_URL, body.toString(), {
        headers: {
          Authorization: basicAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });

      return data;
    } catch (error) {
      logger.error('Error refreshing Xero access token', error);
      throw error;
    }
  },

  getTenants: async (accessToken: string): Promise<XeroConnection[]> => {
    try {
      const { data } = await axios.get<XeroConnection[]>(CONNECTIONS_URL, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });

      return data;
    } catch (error) {
      logger.error('Error fetching Xero tenants/connections', error);
      throw error;
    }
  },

  getBills: async (accessToken: string, tenantId: string) => {
    try {
      const { data } = await axios.get('https://api.xero.com/api.xro/2.0/Invoices', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantId,
          Accept: 'application/json',
        },
        params: {
          where: 'Type=="ACCPAY"', // bills are Invoices of type ACCPAY in the Xero API
        },
      });

      return data;
    } catch (error) {
      logger.error('Error fetching bills from Xero', error);
      throw error;
    }
  },

  getInvoices: async (accessToken: string, tenantId: string) => {
    try {
      const { data } = await axios.get('https://api.xero.com/api.xro/2.0/Invoices', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Xero-tenant-id': tenantId,
          Accept: 'application/json',
        },
        params: {
          where: 'Type=="ACCREC"', // sales invoices are Type ACCREC
        },
      });

      return data;
    } catch (error) {
      logger.error('Error fetching invoices from Xero', error);
      throw error;
    }
  },

  revokeToken: async (refreshToken: string): Promise<void> => {
    try {
      const body = new URLSearchParams({ token: refreshToken });

      await axios.post('https://identity.xero.com/connect/revocation', body.toString(), {
        headers: {
          Authorization: basicAuthHeader(),
          'Content-Type': 'application/x-www-form-urlencoded',
        },
      });
    } catch (error) {
      logger.error('Error revoking Xero refresh token', error);
      throw error;
    }
  },
};

export default xeroService;
