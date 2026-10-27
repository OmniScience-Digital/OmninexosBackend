// src/services/telegram.service.ts
import 'dotenv/config';
import axios, { AxiosError } from 'axios';
import FormData from 'form-data';
import logger from '../utils/logger';
import crypto from 'crypto';
import sharp from 'sharp';

interface TelegramConfig {
  botToken: string;
  apiUrl?: string;
}

interface SendFileOptions {
  maxRetries?: number;
  retryDelay?: number;
  filename?: string;
  caption?: string;
}

export interface TelegramPhoto {
  data: Buffer;
  filename: string;
  contentType: string;
  caption?: string;
}

export class TelegramService {
  private readonly botToken: string;
  private readonly apiUrl: string;
  private messageQueue: Promise<boolean> = Promise.resolve(true);
  private lastSentMessages = new Map<string, number>();

  constructor(config: TelegramConfig) {
    if (!config.botToken) {
      throw new Error('Bot token and chat ID are required');
    }
    this.botToken = config.botToken;
    this.apiUrl = config.apiUrl || 'https://api.telegram.org/bot';
  }

  async sendMessage(
    message: string,
    chatId: string,
    options?: { maxRetries?: number; retryDelay?: number }
  ): Promise<boolean> {
    return (this.messageQueue = this.messageQueue.then(async () => {
      return this._sendMessageInternal(message, chatId, options);
    }));
  }

  private async _sendMessageInternal(
    message: string,
    chatId: string,
    options?: { maxRetries?: number; retryDelay?: number }
  ): Promise<boolean> {
    const maxRetries = options?.maxRetries ?? 2;
    const retryDelay = options?.retryDelay ?? 2000;
    const messageHash = crypto.createHash('md5').update(message).digest('hex');
    const now = Date.now();

    if (this.lastSentMessages.has(messageHash)) {
      const lastSentTime = this.lastSentMessages.get(messageHash) || 0;
      if (now - lastSentTime < 5000) {
        logger.debug('Duplicate message detected within 5 seconds, skipping');
        return true;
      }
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await axios.post(
          `${this.apiUrl}${this.botToken}/sendMessage`,
          {
            chat_id: chatId,
            text: message,
            parse_mode: 'Markdown',
            disable_web_page_preview: true,
          },
          { timeout: 5000 }
        );

        if (response.data.ok === true) {
          this.lastSentMessages.set(messageHash, now);
          logger.info('Message sent successfully');
          return true;
        }
      } catch (error) {
        const axiosError = error as AxiosError;

        if (attempt === maxRetries) {
          logger.error(
            `Failed after ${maxRetries} attempts. Error:`,
            axiosError.response?.data || axiosError.message
          );
          return false;
        }

        if (
          axiosError.response?.status &&
          axiosError.response.status >= 400 &&
          axiosError.response.status < 500 &&
          axiosError.response.status !== 429
        ) {
          logger.error('Non-retryable error:', axiosError.response.data);
          return false;
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay * Math.pow(2, attempt - 1)));
      }
    }
    return false;
  }

  /**
   * Resize a photo for Telegram and GUARANTEE valid dimensions.
   *
   * Telegram rejects photos with width/height 0, sum(width,height) > 10000, or aspect ratio > 20:1 with
   * PHOTO_INVALID_DIMENSIONS. Sharp's `fit: 'inside'` on a truncated or unusually shaped image can produce
   * exactly that (e.g. 2000x8 from a partially uploaded file). This method checks the output dimensions and,
   * if the result is not Telegram-safe, falls back to a padded 1000x1000 canvas — always valid.
   */
  private async preparePhoto(data: Buffer): Promise<Buffer> {
    const first = await sharp(data, { failOn: 'none' })
      .rotate()
      .resize({
        width: 2560,
        height: 2560,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 85 })
      .toBuffer();

    const meta = await sharp(first).metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    const minDim = Math.min(w, h);
    const maxDim = Math.max(w, h);
    const aspect = minDim > 0 ? maxDim / minDim : 0;

    if (w >= 100 && h >= 100 && w + h <= 10000 && aspect <= 20) {
      return first;
    }

    logger.warn(
      `[telegram] preparePhoto: bad dims ${w}x${h} (aspect ${aspect.toFixed(1)}), ` +
        `falling back to padded 1000x1000`
    );

    // Pad to exactly 1000x1000. `fit: 'contain'` scales the image to fit inside 1000x1000 preserving
    // aspect ratio, then pads with white to fill. Output dimensions are guaranteed 1000x1000, which is
    // always valid for Telegram.
    return sharp(data, { failOn: 'none' })
      .rotate()
      .flatten({ background: '#ffffff' })
      .resize({
        width: 1000,
        height: 1000,
        fit: 'contain',
        background: '#ffffff',
        withoutEnlargement: false,
      })
      .jpeg({ quality: 85 })
      .toBuffer();
  }

  async sendPhotos(
    chatId: string,
    photos: TelegramPhoto[],
    options?: { maxRetries?: number; retryDelay?: number }
  ): Promise<boolean> {
    return (this.messageQueue = this.messageQueue.then(async () => {
      if (photos.length === 0) return true;

      const maxRetries = options?.maxRetries ?? 3;
      const retryDelay = options?.retryDelay ?? 2000;

      let prepared: {
        data: Buffer;
        filename: string;
        contentType: string;
        caption?: string;
      }[];
      try {
        prepared = await Promise.all(
          photos.map(async (p) => ({
            data: await this.preparePhoto(p.data),
            filename: p.filename.replace(/\.[^.]+$/, '') + '.jpg',
            contentType: 'image/jpeg',
            caption: p.caption,
          }))
        );
      } catch (e) {
        const message = `Telegram photo prepare failed: ${(e as Error).message}`;
        logger.error(`[telegram] ${message}`);
        throw new Error(message);
      }

      const method = prepared.length === 1 ? 'sendPhoto' : 'sendMediaGroup';
      const totalBytes = prepared.reduce((n, p) => n + p.data.length, 0);
      logger.info(
        `[telegram] ${method} chatId=${chatId} photos=${prepared.length} totalBytes=${totalBytes} ` +
          `sizes=[${prepared.map((p) => p.data.length).join(',')}]`
      );

      let lastError = 'unknown error';
      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const form = new FormData();
          form.append('chat_id', chatId);

          if (prepared.length === 1) {
            const p = prepared[0];
            form.append('photo', p.data, {
              filename: p.filename,
              contentType: p.contentType,
            });
            if (p.caption) form.append('caption', p.caption);
          } else {
            const group = prepared.slice(0, 10);
            form.append(
              'media',
              JSON.stringify(
                group.map((p, i) => ({
                  type: 'photo',
                  media: `attach://photo${i}`,
                  ...(p.caption ? { caption: p.caption } : {}),
                }))
              )
            );
            group.forEach((p, i) => {
              form.append(`photo${i}`, p.data, {
                filename: p.filename,
                contentType: p.contentType,
              });
            });
          }

          const response = await axios.post(`${this.apiUrl}${this.botToken}/${method}`, form, {
            headers: form.getHeaders(),
            timeout: 60000,
            maxBodyLength: Infinity,
          });

          if (response.data.ok === true) {
            logger.info(`[telegram] ${method} OK after attempt ${attempt}`);
            return true;
          }

          const description = String(response.data.description ?? 'unknown error from Telegram');
          const errorCode = Number(response.data.error_code ?? 0);
          lastError = `${errorCode} ${description}`;
          logger.error(
            `[telegram] ${method} attempt ${attempt}/${maxRetries} — response not ok: ${lastError}`
          );
          if (errorCode >= 400 && errorCode < 500 && errorCode !== 429) {
            throw new Error(`Telegram ${method} rejected: ${lastError}`);
          }
        } catch (error) {
          if (error instanceof Error && error.message.startsWith('Telegram ')) {
            throw error;
          }

          const axiosError = error as AxiosError;
          const status = axiosError.response?.status;
          const data = axiosError.response?.data as
            { description?: string; error_code?: number } | undefined;
          const description = data?.description ?? axiosError.message;
          lastError = `${status ?? 'n/a'} ${description}`;
          logger.error(
            `[telegram] ${method} attempt ${attempt}/${maxRetries} failed: ${lastError}`
          );

          if (status && status >= 400 && status < 500 && status !== 429) {
            throw new Error(`Telegram ${method} rejected: ${lastError}`);
          }
          if (attempt === maxRetries) break;

          await new Promise((r) => setTimeout(r, retryDelay * Math.pow(2, attempt - 1)));
        }
      }
      throw new Error(`Telegram ${method} failed after ${maxRetries} attempts: ${lastError}`);
    }));
  }

  async sendPdf(pdfBuffer: Buffer, chatId: string, options?: SendFileOptions): Promise<boolean> {
    return (this.messageQueue = this.messageQueue.then(async () => {
      return this._sendPdfInternal(pdfBuffer, chatId, options);
    }));
  }

  private async _sendPdfInternal(
    pdfBuffer: Buffer,
    chatId: string,
    options?: SendFileOptions
  ): Promise<boolean> {
    const maxRetries = options?.maxRetries ?? 2;
    const retryDelay = options?.retryDelay ?? 2000;
    const filename = options?.filename || 'document.pdf';
    const caption = options?.caption || '';
    const fileHash = crypto.createHash('md5').update(pdfBuffer).digest('hex');
    const now = Date.now();

    if (this.lastSentMessages.has(fileHash)) {
      const lastSentTime = this.lastSentMessages.get(fileHash) || 0;
      if (now - lastSentTime < 5000) {
        logger.debug('Duplicate file detected within 5 seconds, skipping');
        return true;
      }
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const formData = new FormData();
        formData.append('chat_id', chatId);
        formData.append('document', pdfBuffer, {
          filename,
          contentType: 'application/pdf',
        });
        if (caption) {
          formData.append('caption', caption);
        }

        const response = await axios.post(`${this.apiUrl}${this.botToken}/sendDocument`, formData, {
          headers: formData.getHeaders(),
          timeout: 10000,
        });

        if (response.data.ok === true) {
          this.lastSentMessages.set(fileHash, now);
          logger.info('PDF sent successfully');
          return true;
        }
      } catch (error) {
        const axiosError = error as AxiosError;

        if (attempt === maxRetries) {
          logger.error(
            `Failed after ${maxRetries} attempts. Error:`,
            axiosError.response?.data || axiosError.message
          );
          return false;
        }

        if (
          axiosError.response?.status &&
          axiosError.response.status >= 400 &&
          axiosError.response.status < 500 &&
          axiosError.response.status !== 429
        ) {
          logger.error('Non-retryable error:', axiosError.response.data);
          return false;
        }

        await new Promise((resolve) => setTimeout(resolve, retryDelay * Math.pow(2, attempt - 1)));
      }
    }
    return false;
  }
}

let telegramServiceInstance: TelegramService;

export function getTelegramService(): TelegramService {
  if (!telegramServiceInstance) {
    telegramServiceInstance = new TelegramService({
      botToken: process.env.omninexos_bot || '',
    });

    if (!process.env.omninexos_bot || !process.env.chartIDTest) {
      throw new Error('Missing Telegram configuration in environment variables');
    }
  }
  return telegramServiceInstance;
}

export default getTelegramService();
