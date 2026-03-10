// redisClient.ts
import { createClient } from "redis";
import logger from "../utils/logger.js";
const redisUrl = process.env.redisUrl;
export const client = createClient({ url: redisUrl });
client.on("error", (err) => console.error("Redis Client Error:", err));
client.on("ready", () => console.log(`✅ Redis client ready at ${redisUrl}`));
(async () => {
    try {
        await client.connect();
        logger.info("\u2705 Connected to Redis successfully");
        //client.set('xero:refresh_token', "74QrFEMHuTA2evidcRVA-HMYGJwAr9S4PjWO513QBdw");
        //console.log(await client.get('xero:refresh_token'));
    }
    catch (err) {
        logger.error("\u274C Failed to connect to Redis:", err);
    }
})();
// k46srXVu35JEo41pim8SlSFUq89wV1gih66GDA7D2Wk
// sudo docker exec -it 7dd4deb72f43 redis-cli
// SET 'xero:refresh_token' "k46srXVu35JEo41pim8SlSFUq89wV1gih66GDA7D2Wk"
// # Verify value
// GET openTime
// curl -v https://wq3qo9l3de.execute-api.us-east-1.amazonaws.com/api/v1/xeroBillwebhook
//https://wq3qo9l3de.execute-api.us-east-1.amazonaws.com/api/v1/xeroBillwebhook
//http://172.31.81.3:5001/api/v1/xeroBillwebhook
