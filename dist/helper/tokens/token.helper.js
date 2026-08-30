// import { randomUUID } from 'crypto';
// import { connection as redis } from '../../bull/bull.redis';
// import {
//   getXeroConfig,
//   updateXeroConfig,
//   XeroConfigConditionFailedError,
// } from '../../repositories/dynamo.xeroconfig.repository';
// import { XeroTokenResponse } from '../../schema/xero.schema';
// import { decrypt, encrypt } from '../../services/encryption.service';
// import logger from '../../utils/logger';
// const TENANT_ID = process.env.XERO_TENANT_ID!;
// // Distributed lock so only one process/caller can be redeeming the refresh
// // token at a time. Xero refresh tokens are single-use — two concurrent
// // redemptions of the same token is exactly what produces
// // "Refresh token was issued to a different client" for the loser.
// const LOCK_KEY = `xero:refresh-token-lock:${TENANT_ID}`;
// const LOCK_TTL_MS = 15_000; // must comfortably cover one Xero round trip
// const LOCK_WAIT_TIMEOUT_MS = 20_000; // how long a caller will wait for the lock
// const LOCK_POLL_INTERVAL_MS = 250;
// async function acquireLock(lockValue: string): Promise<boolean> {
//   const result = await redis.set(LOCK_KEY, lockValue, 'PX', LOCK_TTL_MS, 'NX');
//   return result === 'OK';
// }
// async function releaseLock(lockValue: string): Promise<void> {
//   // Only release if we still own it (avoid clobbering someone else's lock
//   // if ours already expired and was re-acquired by another caller).
//   const script = `
//     if redis.call("get", KEYS[1]) == ARGV[1] then
//       return redis.call("del", KEYS[1])
//     else
//       return 0
//     end
//   `;
//   try {
//     await redis.eval(script, 1, LOCK_KEY, lockValue);
//   } catch (err) {
//     logger.warn('[XeroToken] Failed to release refresh-token lock (will expire via TTL):', err);
//   }
// }
// async function withLock<T>(fn: () => Promise<T>): Promise<T> {
//   const lockValue = randomUUID();
//   const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;
//   while (!(await acquireLock(lockValue))) {
//     if (Date.now() >= deadline) {
//       throw new Error(
//         'Xero token refresh already in progress in another process — timed out waiting for lock'
//       );
//     }
//     await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
//   }
//   try {
//     return await fn();
//   } finally {
//     await releaseLock(lockValue);
//   }
// }
// async function refreshAccessTokenOnce(): Promise<string> {
//   const configdata = await getXeroConfig(TENANT_ID);
//   if (!configdata) {
//     throw new Error('No Xero config found in Database');
//   }
//   const encryptedToken = configdata.refreshTokenEncrypted;
//   if (!encryptedToken) {
//     throw new Error('No refresh token found in Database');
//   }
//   // decrypt token
//   let refreshToken: string;
//   try {
//     refreshToken = decrypt(encryptedToken);
//   } catch (err) {
//     console.error('Failed to decrypt refresh token:', err);
//     throw new Error('Decryption failed');
//   }
//   const params = new URLSearchParams();
//   params.append('grant_type', 'refresh_token');
//   params.append('refresh_token', refreshToken);
//   params.append('client_id', process.env.XERO_CLIENT_ID!);
//   params.append('client_secret', process.env.XERO_SECRET!);
//   const res = await fetch('https://identity.xero.com/connect/token', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//     body: params.toString(),
//   });
//   if (!res.ok) {
//     const text = await res.text();
//     console.error('Xero token request failed:', res.status, text);
//     throw new Error(`Failed to refresh Xero token: ${res.statusText}`);
//   }
//   const data = (await res.json()) as XeroTokenResponse;
//   // Save new refresh token — but only if nobody else changed
//   // refreshTokenEncrypted since we read it above. Under the lock this should
//   // never actually lose the race; if it ever does, that means the lock
//   // itself was bypassed somewhere (e.g. a caller running against a
//   // different Redis instance), and we want a loud, clear error rather than
//   // a silently dropped rotated token.
//   const encryptedNewToken = encrypt(data.refresh_token);
//   try {
//     await updateXeroConfig(
//       TENANT_ID,
//       { refreshTokenEncrypted: encryptedNewToken },
//       encryptedToken // compare-and-swap guard
//     );
//   } catch (err) {
//     if (err instanceof XeroConfigConditionFailedError) {
//       logger.error(
//         '[XeroToken] Rotated refresh token could NOT be persisted — DB value changed ' +
//           'since it was read, even though we held the lock. This should not happen; ' +
//           'investigate for a second lock holder (e.g. different Redis instance/env).'
//       );
//     }
//     throw err;
//   }
//   return data.access_token;
// }
// export async function getAccessToken(): Promise<string> {
//   return withLock(refreshAccessTokenOnce);
// }
import { randomUUID } from "crypto";
import { getXeroConfig, updateXeroConfig, acquireXeroLock, releaseXeroLock, XeroConfigConditionFailedError, } from "../../repositories/dynamo.xeroconfig.repository.js";
import { decrypt, encrypt } from "../../services/encryption.service.js";
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
async function refreshAccessTokenOnce() {
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
    return data.access_token;
}
export async function getAccessToken() {
    // Fast path: still-valid cached access token, no Xero call, no lock, no
    // refresh-token rotation at all.
    if (cachedAccessToken && Date.now() < cachedAccessTokenExpiresAt - EXPIRY_SAFETY_BUFFER_MS) {
        return cachedAccessToken;
    }
    return withLock(refreshAccessTokenOnce);
}
