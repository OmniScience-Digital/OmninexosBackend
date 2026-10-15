// src/services/telegram.webhook.service.ts  (NEW FILE)
import logger from "../utils/logger.js";
import { parseGroupEvent } from "../helper/telegram/telegram.update.js";
import { upsertTelegramGroup } from "../repositories/dynamo.jobcardflow.repository.js";
/** Records a group when the bot joins (or leaves, or the group is renamed). Everything else Telegram sends is ignored. */
export async function handleTelegramUpdate(update) {
    const event = parseGroupEvent(update);
    if (!event)
        return "ignored";
    await upsertTelegramGroup(event);
    logger.info(`Telegram group ${event.chatId} (${event.groupName ?? "unnamed"}): ${event.active === undefined ? "renamed" : event.active ? "bot added" : "bot removed"}`);
    return "saved";
}
