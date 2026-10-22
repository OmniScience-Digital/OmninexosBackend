// src/services/group-lock.service.ts
import logger from '../utils/logger';

const KEY_PREFIX = 'telegram-group-lock:';
const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;

export interface GroupLock {
  acquire(groupId: string, ownerId: string, ttlMs: number): Promise<boolean>;
  release(groupId: string, ownerId: string): Promise<void>;
}

logger.info('[group-lock] module loaded');

let client: any = null;

/** Reads either `redisUrl` (your env var) or `REDIS_URL`. */
function getRedisUrl(): string | undefined {
  return process.env.redisUrl ?? process.env.REDIS_URL ?? undefined;
}

async function getClient(): Promise<any> {
  if (client) return client;
  const url = getRedisUrl();
  logger.info(`[group-lock] creating client, redisUrl=${url ? 'SET' : 'MISSING'}`);
  if (!url) throw new Error('redisUrl is not set');
  let Redis: any;
  try {
    // Dynamic import so a missing package does not crash the whole process.
    const mod: any = await import('ioredis');
    Redis = mod.default ?? mod;
  } catch (e) {
    logger.error('[group-lock] ioredis package not installed — run `npm i ioredis`', e);
    throw e;
  }
  client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  client.on('connect', () => logger.info('[group-lock] Redis connected'));
  client.on('ready', () => logger.info('[group-lock] Redis ready'));
  client.on('error', (e: unknown) => logger.error('[group-lock] Redis error:', e));
  client.on('end', () => logger.warn('[group-lock] Redis connection ended'));
  return client;
}

export class RedisGroupLock implements GroupLock {
  async acquire(groupId: string, ownerId: string, ttlMs: number): Promise<boolean> {
    const c = await getClient();
    const res = await c.set(KEY_PREFIX + groupId, ownerId, 'PX', ttlMs, 'NX');
    const ok = res === 'OK';
    logger.info(`[group-lock] acquire group=${groupId} owner=${ownerId} => ${ok}`);
    return ok;
  }
  async release(groupId: string, ownerId: string): Promise<void> {
    const c = await getClient();
    await c.eval(RELEASE_LUA, 1, KEY_PREFIX + groupId, ownerId);
    logger.info(`[group-lock] release group=${groupId} owner=${ownerId}`);
  }
}

let cachedLock: GroupLock | undefined;
export async function getDefaultGroupLock(): Promise<GroupLock> {
  if (cachedLock) return cachedLock;
  cachedLock = new RedisGroupLock();
  logger.info('[group-lock] RedisGroupLock created');
  return cachedLock;
}
