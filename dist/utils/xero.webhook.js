import crypto from 'crypto';
export const verifyXeroWebhookSignature = (payload, signature, webhookKey) => {
    try {
        const hmac = crypto.createHmac('sha256', webhookKey);
        hmac.update(payload);
        const computedSignature = hmac.digest('base64');
        // Use timing-safe comparison to prevent timing attacks
        return crypto.timingSafeEqual(Buffer.from(computedSignature), Buffer.from(signature));
    }
    catch (error) {
        return false;
    }
};
