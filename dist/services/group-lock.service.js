// src/services/group-lock.service.ts
import logger from "../utils/logger.js";
const KEY_PREFIX = "telegram-group-lock:";
const RELEASE_LUA = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end
`;
logger.info("[group-lock] module loaded");
let client = null;
/** Reads either `redisUrl` (your env var) or `REDIS_URL`. */
function getRedisUrl() {
    return process.env.redisUrl ?? process.env.REDIS_URL ?? undefined;
}
async function getClient() {
    if (client)
        return client;
    const url = getRedisUrl();
    logger.info(`[group-lock] creating client, redisUrl=${url ? "SET" : "MISSING"}`);
    if (!url)
        throw new Error("redisUrl is not set");
    let Redis;
    try {
        // Dynamic import so a missing package does not crash the whole process.
        const mod = await import("ioredis");
        Redis = mod.default ?? mod;
    }
    catch (e) {
        logger.error("[group-lock] ioredis package not installed \u2014 run `npm i ioredis`", e);
        throw e;
    }
    client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
    client.on("connect", () => logger.info("[group-lock] Redis connected"));
    client.on("ready", () => logger.info("[group-lock] Redis ready"));
    client.on("error", (e) => logger.error("[group-lock] Redis error:", e));
    client.on("end", () => logger.warn("[group-lock] Redis connection ended"));
    return client;
}
export class RedisGroupLock {
    async acquire(groupId, ownerId, ttlMs) {
        const c = await getClient();
        const res = await c.set(KEY_PREFIX + groupId, ownerId, "PX", ttlMs, "NX");
        const ok = res === "OK";
        logger.info(`[group-lock] acquire group=${groupId} owner=${ownerId} => ${ok}`);
        return ok;
    }
    async release(groupId, ownerId) {
        const c = await getClient();
        await c.eval(RELEASE_LUA, 1, KEY_PREFIX + groupId, ownerId);
        logger.info(`[group-lock] release group=${groupId} owner=${ownerId}`);
    }
}
let cachedLock;
export async function getDefaultGroupLock() {
    if (cachedLock)
        return cachedLock;
    cachedLock = new RedisGroupLock();
    logger.info("[group-lock] RedisGroupLock created");
    return cachedLock;
}
