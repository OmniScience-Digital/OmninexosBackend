import fetch from "node-fetch";
import logger from "../utils/logger.js";
const CLIENT_ID = process.env.XERO_CLIENT_ID;
const CLIENT_SECRET = process.env.XERO_SECRET;
const REDIRECT_URI = process.env.REDIRECT_URI;
const xeroService = {
    getAuthUrl: () => {
        const scope = "openid profile email accounting.transactions accounting.contacts offline_access";
        logger.info(`XERO CLIENT ID: ${CLIENT_ID}`);
        logger.info(`XERO REDIRECT URI: ${REDIRECT_URI}`);
        logger.info(`XERO SCOPES: ${scope}`);
        return `https://login.xero.com/identity/connect/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${REDIRECT_URI}&scope=openid profile email accounting.transactions accounting.contacts offline_access`;
    },
    exchangeCodeForToken: async (code) => {
        const body = new URLSearchParams({
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT_URI,
        }).toString();
        const response = await fetch("https://identity.xero.com/connect/token", {
            method: "POST",
            headers: {
                Authorization: "Basic " + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString("base64"),
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body,
        });
        if (!response.ok)
            throw new Error(`Token exchange failed: ${await response.text()}`);
        return response.json();
    },
    getTenants: async (accessToken) => {
        const response = await fetch("https://api.xero.com/connections", {
            headers: { Authorization: `Bearer ${accessToken}` },
        });
        if (!response.ok)
            throw new Error(`Fetching tenants failed: ${await response.text()}`);
        return response.json();
    },
    // <-- NEW: fetch bills
    getBills: async (accessToken, tenantId) => {
        const response = await fetch("https://api.xero.com/api.xro/2.0/Bills", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Xero-tenant-id": tenantId,
                Accept: "application/json",
            },
        });
        if (!response.ok)
            throw new Error(`Fetching bills failed: ${await response.text()}`);
        return response.json();
    },
    // <-- NEW: fetch invoices
    getInvoices: async (accessToken, tenantId) => {
        const response = await fetch("https://api.xero.com/api.xro/2.0/Invoices", {
            headers: {
                Authorization: `Bearer ${accessToken}`,
                "Xero-tenant-id": tenantId,
                Accept: "application/json",
            },
        });
        if (!response.ok)
            throw new Error(`Fetching invoices failed: ${await response.text()}`);
        return response.json();
    },
};
export default xeroService;
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
//       scope: 'openid profile email accounting.invoices accounting.contacts offline_access',
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
