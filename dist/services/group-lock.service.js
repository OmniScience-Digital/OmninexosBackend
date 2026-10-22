// src/services/group-lock.service.ts
import Redis from "ioredis";
import logger from "../utils/logger.js";
const KEY_PREFIX = "telegram-group-lock:";
const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;
let client = null;
function getClient() {
    if (client)
        return client;
    const url = process.env.REDIS_URL;
    if (!url)
        throw new Error("REDIS_URL is not set");
    client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
    client.on("error", (e) => logger.error("Redis (group lock) error:", e));
    return client;
}
export class RedisGroupLock {
    async acquire(groupId, ownerId, ttlMs) {
        const res = await getClient().set(KEY_PREFIX + groupId, ownerId, "PX", ttlMs, "NX");
        return res === "OK";
    }
    async release(groupId, ownerId) {
        await getClient().eval(RELEASE_LUA, 1, KEY_PREFIX + groupId, ownerId);
    }
}
let cachedLock;
export async function getDefaultGroupLock() {
    if (cachedLock)
        return cachedLock;
    cachedLock = new RedisGroupLock();
    return cachedLock;
}
