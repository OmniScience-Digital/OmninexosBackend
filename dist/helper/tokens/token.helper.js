import { client } from "../../services/redis.service.js";
// Get a fresh access token using the refresh token
export async function getAccessToken() {
    // Get refresh token from Redis
    const refreshToken = await client.get("xero:refresh_token");
    if (!refreshToken) {
        throw new Error("No refresh token found in Redis");
    }
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken);
    params.append("client_id", process.env.XERO_CLIENT_ID);
    params.append("client_secret", process.env.XERO_SECRET);
    const res = await fetch("https://identity.xero.com/connect/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });
    if (!res.ok)
        throw new Error(`Failed to refresh Xero token: ${res.statusText}`);
    const data = (await res.json());
    // Store the new refresh token in Redis
    await client.set("xero:refresh_token", data.refresh_token);
    return data.access_token;
}
