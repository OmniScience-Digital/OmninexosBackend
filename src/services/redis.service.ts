// services/redis.service.ts
import { createClient } from 'redis';

const redisClient = createClient({
  url: process.env.REDIS_URL || 'redis://localhost:6379'
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));

export const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
};

export const redisService = {
  // Store task ID for session
  setTaskSession: async (sessionId: string, taskId: string, ttl: number = 600) => {
    await connectRedis();
    await redisClient.setEx(`vif:${sessionId}`, ttl, taskId);
  },

  // Get task ID for session
  getTaskSession: async (sessionId: string): Promise<string | null> => {
    await connectRedis();
    return await redisClient.get(`vif:${sessionId}`);
  },

  // Delete session
  deleteTaskSession: async (sessionId: string) => {
    await connectRedis();
    await redisClient.del(`vif:${sessionId}`);
  }
};