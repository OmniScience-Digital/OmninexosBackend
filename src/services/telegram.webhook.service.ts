// src/services/telegram.webhook.service.ts  (NEW FILE)
import logger from '../utils/logger';
import { parseGroupEvent } from '../helper/telegram/telegram.update';
import { upsertTelegramGroup } from '../repositories/dynamo.jobcardflow.repository';

/** Records a group when the bot joins (or leaves, or the group is renamed). Everything else Telegram sends is ignored. */
export async function handleTelegramUpdate(update: unknown): Promise<'saved' | 'ignored'> {
  const event = parseGroupEvent(update);
  if (!event) return 'ignored';
  await upsertTelegramGroup(event);
  logger.info(
    `Telegram group ${event.chatId} (${event.groupName ?? 'unnamed'}): ${
      event.active === undefined ? 'renamed' : event.active ? 'bot added' : 'bot removed'
    }`
  );
  return 'saved';
}
