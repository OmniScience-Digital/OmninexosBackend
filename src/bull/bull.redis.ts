import { Queue, Worker } from 'bullmq';
import IORedis from 'ioredis';

const redisUrl = process.env.redisUrl!;
export const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });

export function createQueue(name: string) {
  return new Queue(name, { connection });
}

export function createWorker(name: string, processor: any) {
  return new Worker(name, processor, { connection });
}
