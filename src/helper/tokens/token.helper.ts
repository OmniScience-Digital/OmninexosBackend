import { randomUUID } from 'crypto';
import { connection as redis } from '../../bull/bull.redis';
import {
  getXeroConfig,
  updateXeroConfig,
  XeroConfigConditionFailedError,
} from '../../repositories/dynamo.xeroconfig.repository';
import { XeroTokenResponse } from '../../schema/xero.schema';
import { decrypt, encrypt } from '../../services/encryption.service';
import logger from '../../utils/logger';

const TENANT_ID = process.env.XERO_TENANT_ID!;

// Distributed lock so only one process/caller can be redeeming the refresh
// token at a time. Xero refresh tokens are single-use — two concurrent
// redemptions of the same token is exactly what produces
// "Refresh token was issued to a different client" for the loser.
const LOCK_KEY = `xero:refresh-token-lock:${TENANT_ID}`;
const LOCK_TTL_MS = 15_000; // must comfortably cover one Xero round trip
const LOCK_WAIT_TIMEOUT_MS = 20_000; // how long a caller will wait for the lock
const LOCK_POLL_INTERVAL_MS = 250;

async function acquireLock(lockValue: string): Promise<boolean> {
  const result = await redis.set(LOCK_KEY, lockValue, 'PX', LOCK_TTL_MS, 'NX');
  return result === 'OK';
}

async function releaseLock(lockValue: string): Promise<void> {
  // Only release if we still own it (avoid clobbering someone else's lock
  // if ours already expired and was re-acquired by another caller).
  const script = `
    if redis.call("get", KEYS[1]) == ARGV[1] then
      return redis.call("del", KEYS[1])
    else
      return 0
    end
  `;
  try {
    await redis.eval(script, 1, LOCK_KEY, lockValue);
  } catch (err) {
    logger.warn('[XeroToken] Failed to release refresh-token lock (will expire via TTL):', err);
  }
}

async function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const lockValue = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_TIMEOUT_MS;

  while (!(await acquireLock(lockValue))) {
    if (Date.now() >= deadline) {
      throw new Error(
        'Xero token refresh already in progress in another process — timed out waiting for lock'
      );
    }
    await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_INTERVAL_MS));
  }

  try {
    return await fn();
  } finally {
    await releaseLock(lockValue);
  }
}

async function refreshAccessTokenOnce(): Promise<string> {
  const configdata = await getXeroConfig(TENANT_ID);

  if (!configdata) {
    throw new Error('No Xero config found in Database');
  }

  const encryptedToken = configdata.refreshTokenEncrypted;

  if (!encryptedToken) {
    throw new Error('No refresh token found in Database');
  }

  // decrypt token
  let refreshToken: string;
  try {
    refreshToken = decrypt(encryptedToken);
  } catch (err) {
    console.error('Failed to decrypt refresh token:', err);
    throw new Error('Decryption failed');
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

  if (!res.ok) {
    const text = await res.text();
    console.error('Xero token request failed:', res.status, text);
    throw new Error(`Failed to refresh Xero token: ${res.statusText}`);
  }

  const data = (await res.json()) as XeroTokenResponse;

  // Save new refresh token — but only if nobody else changed
  // refreshTokenEncrypted since we read it above. Under the lock this should
  // never actually lose the race; if it ever does, that means the lock
  // itself was bypassed somewhere (e.g. a caller running against a
  // different Redis instance), and we want a loud, clear error rather than
  // a silently dropped rotated token.
  const encryptedNewToken = encrypt(data.refresh_token);
  try {
    await updateXeroConfig(
      TENANT_ID,
      { refreshTokenEncrypted: encryptedNewToken },
      encryptedToken // compare-and-swap guard
    );
  } catch (err) {
    if (err instanceof XeroConfigConditionFailedError) {
      logger.error(
        '[XeroToken] Rotated refresh token could NOT be persisted — DB value changed ' +
          'since it was read, even though we held the lock. This should not happen; ' +
          'investigate for a second lock holder (e.g. different Redis instance/env).'
      );
    }
    throw err;
  }

  return data.access_token;
}

export async function getAccessToken(): Promise<string> {
  return withLock(refreshAccessTokenOnce);
}
