import { parseFeishuPlatformKey } from '../adapters/feishu/platform-key.js';
import type { IncomingMessage } from './types.js';

/**
 * Who may talk to the bot.
 *
 * `REMOTE_ALLOWED_SENDERS` is a comma-separated list. An entry matches:
 * - a sender: its memoryKey, `feishu:user:<open_id>` or `discord:user:<user id>`;
 * - a whole Feishu group: `feishu:chat:<chat_id>`.
 *
 * Unset or empty means every sender is allowed (previous behavior). An allowed
 * sender gets the full agent; there is no per-tool restriction.
 */
export const ALLOWED_SENDERS_ENV = 'REMOTE_ALLOWED_SENDERS';

export function parseAllowedSenders(raw: string | undefined): Set<string> | null {
  const entries = (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return entries.length > 0 ? new Set(entries) : null;
}

/** Keys that identify this message's sender and, for Feishu groups, its chat. */
export function senderKeys(incoming: Pick<IncomingMessage, 'platformKey' | 'memoryKey'>): string[] {
  const keys = [incoming.memoryKey ?? incoming.platformKey];
  const feishu = parseFeishuPlatformKey(incoming.platformKey);
  if (feishu?.kind === 'group') {
    keys.push(`feishu:chat:${feishu.chatId}`);
  }
  return keys;
}

export function isSenderAllowed(
  incoming: Pick<IncomingMessage, 'platformKey' | 'memoryKey'>,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const allowed = parseAllowedSenders(env[ALLOWED_SENDERS_ENV]);
  if (!allowed) {
    return true;
  }
  return senderKeys(incoming).some((key) => allowed.has(key));
}
