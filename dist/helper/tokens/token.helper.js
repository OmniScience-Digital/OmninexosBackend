import { randomUUID } from "crypto";
import { getXeroConfig, updateXeroConfig, acquireXeroLock, releaseXeroLock, XeroConfigConditionFailedError, } from "../../repositories/dynamo.xeroconfig.repository.js";
import { decrypt, encrypt } from "../../services/encryption.service.js";
import { createEscalationTask } from "../../services/clickUpfetch.service.js";
import logger from "../../utils/logger.js";
const TENANT_ID = process.env.XERO_TENANT_ID;
// Distributed lock so only one process/environment can be redeeming the refresh
// token at a time. Xero refresh tokens are single-use - two concurrent
// redemptions of the same token is exactly what produces
// "Refresh token was issued to a different client" for the loser.
//
// This lock lives in DynamoDB (on the shared xeroConfig record), not Redis -
// dev/test/prod each have their own local Redis, so a Redis-based lock would
// only protect processes on the same Redis instance. All environments share
// this one DynamoDB record per tenantId, so this actually coordinates across
// environments, which is the scenario that matters here.
const LOCK_TTL_MS = 15000; // must comfortably cover one Xero round trip
const LOCK_WAIT_TIMEOUT_MS = 20000; // how long a caller will wait for the lock
const LOCK_POLL_INTERVAL_MS = 250;
async function withLock(fn) {
    const lockValue = randomUUID();
    const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
    while (!(await acquireXeroLock(TENANT_ID, lockValue, LOCK_TTL_MS))) {
        if (Date.now() >= deadline) {
            throw new Error("Xero token refresh already in progress in another process/environment \u2014 timed out waiting for lock");
        }
        await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
    }
    try {
        return await fn();
    }
    finally {
        await releaseXeroLock(TENANT_ID, lockValue);
    }
}
// In-memory cache for the current access token, per process. Xero access tokens
// are valid for `expires_in` seconds (normally 1800 = 30 min) and do NOT need to
// be re-redeemed on every call - only the refresh token is single-use. Without
// this cache, every poll cycle and every webhook call was rotating the refresh
// token from scratch, which multiplies how often something can go wrong (rate
// limits, races) for zero benefit, since the access token was still valid anyway.
let cachedAccessToken = null;
let cachedAccessTokenExpiresAt = 0; // epoch ms
// Refresh a bit before actual expiry so a slow request never gets caught using
// a token that expires mid-flight.
const EXPIRY_SAFETY_BUFFER_MS = 60000;
// Guards against flooding ClickUp with an escalation task on every single poll
// cycle while Xero stays down - only fire once per outage "streak", and reset
// as soon as a refresh succeeds again so the next real outage escalates too.
let escalationRaisedForCurrentOutage = false;
async function raiseTokenInvalidEscalation(reason) {
    if (escalationRaisedForCurrentOutage)
        return;
    escalationRaisedForCurrentOutage = true;
    await createEscalationTask("Xero refresh token is invalid - manual re-auth required", `The Xero refresh token could not be redeemed for tenant ${TENANT_ID} and needs manual ` +
        `re-authentication.\n\nReason: ${reason}\n\n` +
        `Re-connect via /api/v1/xero/connect once this is picked up.`);
}
async function refreshAccessTokenOnce() {
    // Double-check: another caller may have refreshed while we waited for the lock
    if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - EXPIRY_SAFETY_BUFFER_MS) {
        return cachedAccessToken;
    }
    try {
        const configdata = await getXeroConfig(TENANT_ID);
        if (!configdata) {
            throw new Error("No Xero config found in Database");
        }
        const encryptedToken = configdata.refreshTokenEncrypted;
        if (!encryptedToken) {
            throw new Error("No refresh token found in Database");
        }
        // decrypt token
        let refreshToken;
        try {
            refreshToken = decrypt(encryptedToken);
        }
        catch (err) {
            console.error("Failed to decrypt refresh token:", err);
            throw new Error("Decryption failed");
        }
        const params = new URLSearchParams();
        params.append("grant_type", "refresh_token");
        params.append("refresh_token", refreshToken);
        params.append("client_id", process.env.XERO_CLIENT_ID);
        params.append("client_secret", process.env.XERO_SECRET);
        const res = await fetch("https://identity.xero.com/connect/token", {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: params.toString(),
        });
        if (!res.ok) {
            const text = await res.text();
            console.error("Xero token request failed:", res.status, text);
            // Xero responds 400 invalid_grant when the refresh token is no longer valid
            // (expired, revoked, or already redeemed elsewhere) - this is the "token is
            // now invalid" case that needs a human to re-auth, so raise it in ClickUp.
            await raiseTokenInvalidEscalation(`Xero responded ${res.status} ${res.statusText}: ${text}`);
            throw new Error(`Failed to refresh Xero token: ${res.statusText}`);
        }
        const data = (await res.json());
        // Save new refresh token — but only if nobody else changed
        // refreshTokenEncrypted since we read it above. Under the lock this should
        // never actually lose the race; if it ever does, that means the lock
        // itself was bypassed somewhere (e.g. a caller running against a
        // different Redis instance), and we want a loud, clear error rather than
        // a silently dropped rotated token.
        const encryptedNewToken = encrypt(data.refresh_token);
        try {
            await updateXeroConfig(TENANT_ID, { refreshTokenEncrypted: encryptedNewToken }, encryptedToken // compare-and-swap guard
            );
        }
        catch (err) {
            if (err instanceof XeroConfigConditionFailedError) {
                logger.error("[XeroToken] Rotated refresh token could NOT be persisted \u2014 DB value changed " +
                    "since it was read, even though we held the lock. This should not happen; " +
                    "investigate for a second lock holder (e.g. an environment not going through this lock).");
            }
            throw err;
        }
        // Populate the in-memory cache so subsequent calls in this process reuse
        // this access token instead of redeeming the (now-rotated) refresh token again.
        cachedAccessToken = data.access_token;
        cachedAccessTokenExpiresAt = Date.now() + data.expires_in * 1000;
        // Refresh succeeded - clear the outage guard so a future failure escalates again.
        escalationRaisedForCurrentOutage = false;
        return data.access_token;
    }
    catch (err) {
        // Missing config / missing refresh token / decrypt failure all mean the same
        // thing operationally: the stored token is unusable and needs a human to
        // re-run Xero auth. The bad-response branch above already escalated with a
        // more specific reason, so only escalate here for these other unusable-token
        // cases (guarded the same way, so this never double-fires for one outage).
        if (err instanceof Error &&
            !(err instanceof XeroConfigConditionFailedError) &&
            /No Xero config found|No refresh token found|Decryption failed/.test(err.message)) {
            await raiseTokenInvalidEscalation(err.message);
        }
        throw err;
    }
}
export async function getAccessToken() {
    // Fast path: still-valid cached access token, no Xero call, no lock, no
    // refresh-token rotation at all.
    if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - EXPIRY_SAFETY_BUFFER_MS) {
        return cachedAccessToken;
    }
    return withLock(refreshAccessTokenOnce);
}
