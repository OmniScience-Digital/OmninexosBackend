// redisClient.ts
import { createClient } from 'redis';
import logger from '../utils/logger';
const redisUrl = process.env.redisUrl;
export const client = createClient({ url: redisUrl });

client.on('error', (err) => console.error('Redis Client Error:', err));
client.on('ready', () => console.log(`✅ Redis client ready at ${redisUrl}`));

(async () => {
  try {
    await client.connect();
    logger.info('✅ Connected to Redis successfully');
    //client.set('xero:refresh_token', "74QrFEMHuTA2evidcRVA-HMYGJwAr9S4PjWO513QBdw");
    //console.log(await client.get('xero:refresh_token'));
  } catch (err) {
    logger.error('❌ Failed to connect to Redis:', err);
  }
})();
