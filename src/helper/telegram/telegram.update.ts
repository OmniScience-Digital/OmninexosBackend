// src/helper/telegram/telegram.update.ts  (NEW FILE)
// Reads a Telegram webhook update and says what, if anything, changed about a GROUP. Pure.

export interface GroupEvent {
  chatId: string;
  groupName?: string;
  /** true: the bot is in the group; false: it was removed; undefined: only the group's name changed. */
  active?: boolean;
}

interface TgChat {
  id?: number;
  type?: string;
  title?: string;
}

/** Row id for a Telegram group. Same rule as the web app (telegramGroupId), so both write the same row. */
export const telegramGroupRowId = (chatId: string): string => `tg${chatId}`;

export function parseGroupEvent(update: any): GroupEvent | null {
  if (!update || typeof update !== 'object') return null;

  // The bot was added to / removed from a chat
  const m = update.my_chat_member;
  if (m?.chat && isGroup(m.chat)) {
    const status: string | undefined = m.new_chat_member?.status;
    if (status === 'member' || status === 'administrator') return event(m.chat, true);
    if (status === 'left' || status === 'kicked') return event(m.chat, false);
    return null; // 'restricted' etc.: not a membership change we act on
  }

  // The group was renamed (a service message)
  const msg = update.message ?? update.edited_message;
  if (
    msg?.chat &&
    isGroup(msg.chat) &&
    typeof msg.new_chat_title === 'string' &&
    msg.new_chat_title.trim()
  ) {
    return { chatId: String(msg.chat.id), groupName: msg.new_chat_title.trim() };
  }
  return null;
}

const isGroup = (c: TgChat) =>
  typeof c.id === 'number' && (c.type === 'group' || c.type === 'supergroup');
const event = (c: TgChat, active: boolean): GroupEvent => ({
  chatId: String(c.id),
  groupName: c.title?.trim() || undefined,
  active,
});
