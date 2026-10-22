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

    // Prevent duplicate messages within 5 seconds
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

        // Don't retry if it's a client error (4xx) except 429 (rate limit)
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

  private async preparePhoto(data: Buffer): Promise<Buffer> {
    return sharp(data, { failOn: 'none' })
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
  }

  /** One photo, or an album for 2-10 photos. Returns true only when Telegram accepted them. */
  /** One photo, or an album for 2–10 photos. */
  async sendPhotos(chatId: string, photos: TelegramPhoto[]): Promise<boolean> {
    return (this.messageQueue = this.messageQueue.then(async () => {
      if (photos.length === 0) return true;

      try {
        // Normalize every image before sending it to Telegram.
        const prepared = await Promise.all(
          photos.map(async (p) => ({
            data: await this.preparePhoto(p.data),
            filename: p.filename.replace(/\.[^.]+$/, '') + '.jpg',
            contentType: 'image/jpeg',
            caption: p.caption,
          }))
        );

        const form = new FormData();
        form.append('chat_id', chatId);

        let method = 'sendPhoto';

        if (prepared.length === 1) {
          const p = prepared[0];

          form.append('photo', p.data, {
            filename: p.filename,
            contentType: p.contentType,
          });

          if (p.caption) form.append('caption', p.caption);
        } else {
          method = 'sendMediaGroup';

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

        return response.data.ok === true;
      } catch (error) {
        const axiosError = error as AxiosError;

        logger.error(
          'Telegram photo send failed:',
          axiosError.response?.data || axiosError.message
        );

        return false;
      }
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

    // Prevent duplicate files within 5 seconds
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

        // Don't retry if it's a client error (4xx) except 429 (rate limit)
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

// Singleton implementation
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
