import fetch from "node-fetch";
import { getAccessToken } from "../helper/tokens/token.helper.js";
import logger from "../utils/logger.js";
import { getXeroConfig, updateXeroConfig } from "../repositories/dynamo.xeroconfig.repository.js";
const TENANT_ID = process.env.XERO_TENANT_ID;
export async function pollPurchases() {
    try {
        const config = await getXeroConfig(TENANT_ID);
        let lastUpdatedDateUTC = config?.purchasesLastSyncUTC?.S ?? null;
        const ACCESS_TOKEN = await getAccessToken();
        const headers = {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "xero-tenant-id": TENANT_ID,
            Accept: "application/json",
        };
        if (lastUpdatedDateUTC) {
            headers["If-Modified-Since"] = new Date(lastUpdatedDateUTC).toUTCString();
        }
        let page = 1;
        let allPurchases = [];
        while (true) {
            const url = `https://api.xero.com/api.xro/2.0/PurchaseOrders?order=UpdatedDateUTC DESC&page=${page}&pageSize=100`;
            const res = await fetch(url, { method: "GET", headers });
            if (res.status === 304) {
                console.log("No new or updated purchase orders.");
                return;
            }
            if (!res.ok) {
                throw new Error(`Failed to fetch purchase orders: ${res.statusText}`);
            }
            const data = (await res.json());
            if (!data.PurchaseOrders || data.PurchaseOrders.length === 0) {
                break;
            }
            allPurchases = allPurchases.concat(data.PurchaseOrders);
            if (data.PurchaseOrders.length < 100)
                break;
            page++;
        }
        if (allPurchases.length === 0) {
            console.log("No purchase orders found.");
            return;
        }
        logger.info(`✅ Total Purchase Orders Retrieved: ${allPurchases.length}`);
        logger.info("Last Sync Used:", lastUpdatedDateUTC);
        logger.info("--------------------------------------------");
        for (const purchase of allPurchases) {
            if (!purchase.UpdatedDateUTC)
                continue;
            const match = purchase.UpdatedDateUTC.match(/\/Date\((\d+)\+?\d*\)\//);
            if (!match) {
                console.error("\u274C INVALID DATE DETECTED:", purchase.UpdatedDateUTC);
                console.log("RAW PURCHASE OBJECT:", purchase);
                continue;
            }
            const updatedISO = new Date(parseInt(match[1])).toISOString();
            if (!lastUpdatedDateUTC || new Date(updatedISO) > new Date(lastUpdatedDateUTC)) {
                const updatedSAST = new Date(updatedISO);
                updatedSAST.setHours(updatedSAST.getHours() + 2);
                console.log("Purchase Order Number:", purchase.PurchaseOrderNumber);
                console.log("Status:", purchase);
                console.log("Updated At (SAST):", updatedSAST.toISOString());
                console.log("--------------------------------------------");
            }
        }
        const newest = allPurchases[0];
        const newestMatch = newest.UpdatedDateUTC.match(/\/Date\((\d+)\+?\d*\)\//);
        if (newestMatch) {
            const newestSync = new Date(parseInt(newestMatch[1])).toISOString();
            await updateXeroConfig(TENANT_ID, {
                purchasesLastSyncUTC: newestSync
            });
            logger.info(" New Purchase Order Sync Timestamp Stored:", lastUpdatedDateUTC);
        }
    }
    catch (err) {
        console.error("\u274C Error polling purchase orders:", err);
    }
}
