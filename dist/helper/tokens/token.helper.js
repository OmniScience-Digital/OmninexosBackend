import { getXeroConfig, updateXeroConfig } from "../../repositories/dynamo.xeroconfig.repository.js";
import { decrypt, encrypt } from "../../services/encryption.service.js";
const TENANT_ID = process.env.XERO_TENANT_ID;
// Get a fresh access token using the refresh token
// export async function getAccessToken(): Promise<string> {
//   const configdata = await getXeroConfig(TENANT_ID);
//   console.log('configdata ', configdata);
//   if (!configdata) {
//     throw new Error('No Xero config found in Database');
//   }
//   const encryptedToken = configdata.refreshTokenEncrypted?.S;
//   if (!encryptedToken) {
//     throw new Error('No refresh token found in Database');
//   }
//   // decrypt token
//  const refreshToken = decrypt(encryptedToken);
//   const params = new URLSearchParams();
//   params.append('grant_type', 'refresh_token');
//   params.append('refresh_token', refreshToken);
//   params.append('client_id', process.env.XERO_CLIENT_ID!);
//   params.append('client_secret', process.env.XERO_SECRET!);
//   const res = await fetch('https://identity.xero.com/connect/token', {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
//     body: params.toString(),
//   });
//   if (!res.ok) throw new Error(`Failed to refresh Xero token: ${res.statusText}`);
//   const data = (await res.json()) as XeroTokenResponse;
//   //  save NEW refresh token (Xero rotates them)
//   const encryptedNewToken = encrypt(data.refresh_token);
//   await updateXeroConfig(TENANT_ID, {
//     refreshTokenEncrypted: encryptedNewToken
//   });
//   return data.access_token;
// }
export async function getAccessToken() {
    const configdata = await getXeroConfig(TENANT_ID);
    console.log("configdata fetched from DB:", configdata);
    if (!configdata) {
        throw new Error("No Xero config found in Database");
    }
    const encryptedToken = configdata.refreshTokenEncrypted;
    console.log("encryptedToken:", encryptedToken);
    if (!encryptedToken) {
        throw new Error("No refresh token found in Database");
    }
    // decrypt token
    let refreshToken;
    try {
        refreshToken = decrypt(encryptedToken);
        console.log("decrypted refresh token:", refreshToken);
    }
    catch (err) {
        console.error("Failed to decrypt refresh token:", err);
        throw new Error("Decryption failed");
    }
    const params = new URLSearchParams();
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken);
    params.append("client_id", process.env.XERO_CLIENT_ID);
    params.append("client_secret", process.env.XERO_SECRET);
    console.log("Sending request to Xero with refresh token...");
    const res = await fetch("https://identity.xero.com/connect/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: params.toString(),
    });
    if (!res.ok) {
        const text = await res.text();
        console.error("Xero token request failed:", res.status, text);
        throw new Error(`Failed to refresh Xero token: ${res.statusText}`);
    }
    const data = (await res.json());
    console.log("Xero token response:", data);
    // save new refresh token
    const encryptedNewToken = encrypt(data.refresh_token);
    await updateXeroConfig(TENANT_ID, {
        refreshTokenEncrypted: encryptedNewToken,
    });
    console.log("Returning access token");
    return data.access_token;
}
