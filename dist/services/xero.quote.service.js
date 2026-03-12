import fetch from "node-fetch";
import { getAccessToken } from "../helper/tokens/token.helper.js";
import logger from "../utils/logger.js";
import { getXeroConfig, updateXeroConfig } from "../repositories/dynamo.xeroconfig.repository.js";
const TENANT_ID = process.env.XERO_TENANT_ID;
export async function pollQuotes() {
    try {
        const config = await getXeroConfig(TENANT_ID);
        let lastUpdatedDateUTC = config?.quotesLastSyncUTC?.S ?? null;
        const ACCESS_TOKEN = await getAccessToken();
        console.log("ACCESS_TOKEN ", ACCESS_TOKEN);
        const headers = {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "xero-tenant-id": TENANT_ID,
            Accept: "application/json",
        };
        if (lastUpdatedDateUTC) {
            headers["If-Modified-Since"] = new Date(lastUpdatedDateUTC).toUTCString();
        }
        let page = 1;
        let allQuotes = [];
        while (true) {
            const url = `https://api.xero.com/api.xro/2.0/Quotes?order=UpdatedDateUTC DESC&page=${page}&pageSize=100`;
            const res = await fetch(url, { method: "GET", headers });
            if (res.status === 304) {
                console.log("No new or updated quotes.");
                return;
            }
            if (!res.ok) {
                throw new Error(`Failed to fetch quotes: ${res.statusText}`);
            }
            const data = (await res.json());
            if (!data.Quotes || data.Quotes.length === 0) {
                break;
            }
            allQuotes = allQuotes.concat(data.Quotes);
            if (data.Quotes.length < 100) {
                break;
            }
            page++;
        }
        if (allQuotes.length === 0) {
            console.log("No quotes found.");
            return;
        }
        logger.info(`✅ Total Quotes Retrieved: ${allQuotes.length}`);
        logger.info("Last Sync Used:", lastUpdatedDateUTC);
        logger.info("--------------------------------------------");
        for (const quote of allQuotes) {
            const rawTimestamp = quote.UpdatedDateUTC.replace(/\/Date\((\d+)\)\//, "$1");
            const updatedISO = new Date(parseInt(rawTimestamp)).toISOString();
            if (!lastUpdatedDateUTC || new Date(updatedISO) > new Date(lastUpdatedDateUTC)) {
                // Log in SAST
                const updatedSAST = new Date(updatedISO);
                updatedSAST.setHours(updatedSAST.getHours() + 2);
                console.log("Quote Number:", quote.QuoteNumber);
                console.log("Status:", quote);
                console.log("Updated At (SAST):", updatedSAST.toISOString());
                console.log("--------------------------------------------");
            }
        }
        // Update lastUpdatedDateUTC to newest record (keep in UTC for comparison)
        const newest = allQuotes[0];
        const newestRaw = newest.UpdatedDateUTC.replace(/\/Date\((\d+)\)\//, "$1");
        const newestSync = new Date(parseInt(newestRaw)).toISOString();
        await updateXeroConfig(TENANT_ID, {
            quotesLastSyncUTC: newestSync
        });
        logger.info("\uD83D\uDD52New Quote Order SyncTimestamp Stored:", lastUpdatedDateUTC);
    }
    catch (err) {
        console.error("\u274C Error polling quotes:", err);
    }
}
