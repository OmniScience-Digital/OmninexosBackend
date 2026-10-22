// src/services/group-lock.service.ts
import Redis from 'ioredis';
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

let client: Redis | null = null;

function getClient(): Redis {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL is not set');
  client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  client.on('error', (e) => logger.error('Redis (group lock) error:', e));
  return client;
}

export class RedisGroupLock implements GroupLock {
  async acquire(groupId: string, ownerId: string, ttlMs: number): Promise<boolean> {
    const res = await getClient().set(KEY_PREFIX + groupId, ownerId, 'PX', ttlMs, 'NX');
    return res === 'OK';
  }
  async release(groupId: string, ownerId: string): Promise<void> {
    await getClient().eval(RELEASE_LUA, 1, KEY_PREFIX + groupId, ownerId);
  }
}

let cachedLock: GroupLock | undefined;
export async function getDefaultGroupLock(): Promise<GroupLock> {
  if (cachedLock) return cachedLock;
  cachedLock = new RedisGroupLock();
  return cachedLock;
}
