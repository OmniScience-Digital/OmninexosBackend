// src/services/jobcard.photos.service.ts
// Reads a result photo from the job card bucket so it can be forwarded to ClickUp and Telegram.
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
/** The photo is not in storage (never uploaded, or deleted): retrying will not help. */
export class PhotoMissingError extends Error {
}
const TYPES = {
    jpg: 'image/jpeg',
    jpeg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    heic: 'image/heic',
};
export async function loadJobCardPhoto(key, label) {
    const bucket = process.env.JOBCARD_BUCKET;
    if (!bucket)
        throw new Error('JOBCARD_BUCKET is not set');
    const s3 = new S3Client({
        region: process.env.AWS_REGION,
        credentials: {
            accessKeyId: process.env.AWS_ACCESS_KEY_ID,
            secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        },
    });
    try {
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        const data = Buffer.from(await res.Body.transformToByteArray());
        const ext = (key.split('.').pop() ?? 'jpg').toLowerCase();
        const contentType = res.ContentType && res.ContentType.startsWith('image/')
            ? res.ContentType
            : (TYPES[ext] ?? 'image/jpeg');
        const safe = label.replace(/[^A-Za-z0-9 _-]/g, '').trim() || 'photo';
        return { data, contentType, filename: `${safe}.${ext in TYPES ? ext : 'jpg'}` };
    }
    catch (e) {
        if (e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404)
            throw new PhotoMissingError(`Photo not found in storage: ${key}`);
        throw e;
    }
}
