// services/redis.service.ts
import { createClient } from 'redis';
const redisClient = createClient({
    url: process.env.redisUrl || 'redis://localhost:6379',
});
redisClient.on('error', (err) => console.error('Redis Client Error', err));
export const connectRedis = async () => {
    if (!redisClient.isOpen) {
        await redisClient.connect();
    }
};
export const redisService = {
    // Store task ID for session
    setTaskSession: async (sessionId, taskId, ttl = 600) => {
        await connectRedis();
        await redisClient.setEx(`vif:${sessionId}`, ttl, taskId);
    },
    // Get task ID for session
    getTaskSession: async (sessionId) => {
        await connectRedis();
        return await redisClient.get(`vif:${sessionId}`);
    },
    // Delete session
    deleteTaskSession: async (sessionId) => {
        await connectRedis();
        await redisClient.del(`vif:${sessionId}`);
    },
};
