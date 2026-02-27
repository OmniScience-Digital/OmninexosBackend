import fetch from "node-fetch";
import { getAccessToken } from "../helper/tokens/token.helper.js";
import logger from "../utils/logger.js";
let lastUpdatedDateUTC = null;
const TENANT_ID = process.env.XERO_TENANT_ID;
export async function pollQuotes() {
    try {
        const ACCESS_TOKEN = await getAccessToken();
        const headers = {
            Authorization: `Bearer ${ACCESS_TOKEN}`,
            "xero-tenant-id": TENANT_ID,
            Accept: "application/json",
        };
        // if (lastUpdatedDateUTC) {
        //   // Convert lastUpdatedDateUTC to SAST (UTC+2) for logging, header still in HTTP date format
        //   const lastUpdatedSAST = new Date(lastUpdatedDateUTC);
        //   lastUpdatedSAST.setHours(lastUpdatedSAST.getHours() + 2);
        //   headers['If-Modified-Since'] = lastUpdatedSAST.toUTCString();
        // }
        if (lastUpdatedDateUTC) {
            // Use UTC only for header; do NOT convert to SAST
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
        lastUpdatedDateUTC = new Date(parseInt(newestRaw)).toISOString();
        logger.info("\uD83D\uDD52New Quote Order SyncTimestamp Stored:", lastUpdatedDateUTC);
    }
    catch (err) {
        console.error("\u274C Error polling quotes:", err);
    }
}
