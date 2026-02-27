import fetch from "node-fetch";
import { getAccessToken } from "../helper/tokens/token.helper.js";
const TENANT_ID = process.env.XERO_TENANT_ID;
// Create a quote in Xero
export async function createXeroQuote(data) {
    const ACCESS_TOKEN = await getAccessToken();
    const body = {
        Type: "ACCREC",
        Contact: { ContactID: data.contactId },
        Reference: data.reference,
        Date: data.date,
        ExpiryDate: data.expiryDate,
        LineItems: data.lineItems,
    };
    const res = await fetch("https://api.xero.com/api.xro/2.0/Quotes", {
        method: "POST",
        headers: {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "xero-tenant-id": TENANT_ID,
            "Content-Type": "application/json",
            Accept: "application/json",
        },
        body: JSON.stringify(body),
    });
    const result = await res.json();
    console.log("Quote creation response:", JSON.stringify(result, null, 2));
    return result;
}
