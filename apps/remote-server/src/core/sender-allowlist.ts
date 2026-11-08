import { readFileSync, statSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import { parseFeishuPlatformKey } from '../adapters/feishu/platform-key.js';
import type { IncomingMessage } from './types.js';

/**
 * Who may talk to the bot.
 *
 * Two sources, merged:
 * - the list file, default `~/.pulse-coder/allowed-senders.json`
 *   (override with `REMOTE_ALLOWED_SENDERS_FILE`). It is re-read when it
 *   changes, so edits apply without a restart;
 * - `REMOTE_ALLOWED_SENDERS`, a comma-separated list.
 *
 * An entry matches a sender by memoryKey (`feishu:user:<open_id>`,
 * `discord:user:<user id>`) or a whole Feishu group (`feishu:chat:<chat_id>`).
 * When both sources are empty or missing, every sender is allowed (previous
 * behavior). A list file that exists but cannot be parsed allows nobody.
 * An allowed sender gets the full agent; there is no per-tool restriction.
 */
export const ALLOWED_SENDERS_ENV = 'REMOTE_ALLOWED_SENDERS';
export const ALLOWED_SENDERS_FILE_ENV = 'REMOTE_ALLOWED_SENDERS_FILE';

export type AllowlistEntry = string | { id: string; note?: string };

/** Accepts `["id", ...]` or `{ "senders": ["id" | { "id", "note" }, ...] }`. */
export function parseAllowlistFile(raw: string): string[] {
  const parsed = JSON.parse(raw) as unknown;
  const list = Array.isArray(parsed) ? parsed : (parsed as { senders?: unknown } | null)?.senders;
  if (!Array.isArray(list)) {
    throw new Error('expected an array or { "senders": [...] }');
  }
  return list.map((entry, index) => {
    const id = typeof entry === 'string' ? entry : (entry as { id?: unknown } | null)?.id;
    if (typeof id !== 'string' || !id.trim()) {
      throw new Error(`entry ${index} has no id`);
    }
    return id.trim();
  });
}

function parseEnvList(raw: string | undefined): string[] {
  return (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

export function resolveAllowlistFile(env: NodeJS.ProcessEnv = process.env): string {
  return env[ALLOWED_SENDERS_FILE_ENV]?.trim() || join(homedir(), '.pulse-coder', 'allowed-senders.json');
}

type FileState = { path: string; mtimeMs: number; ids: string[] | 'invalid' };
let fileCache: FileState | null = null;

function readAllowlistFile(path: string): string[] | 'invalid' | null {
  let mtimeMs: number;
  try {
    mtimeMs = statSync(path).mtimeMs;
  } catch {
    fileCache = null;
    return null;
  }
  if (fileCache && fileCache.path === path && fileCache.mtimeMs === mtimeMs) {
    return fileCache.ids;
  }
  let ids: string[] | 'invalid';
  try {
    ids = parseAllowlistFile(readFileSync(path, 'utf8'));
  } catch (err) {
    console.error(`[access] cannot parse ${path}; rejecting every sender until it is fixed:`, err);
    ids = 'invalid';
  }
  fileCache = { path, mtimeMs, ids };
  return ids;
}

/** Returns the allowed ids, null when no allowlist is configured, or 'invalid'. */
export function loadAllowedSenders(env: NodeJS.ProcessEnv = process.env): Set<string> | null | 'invalid' {
  const fromFile = readAllowlistFile(resolveAllowlistFile(env));
  if (fromFile === 'invalid') {
    return 'invalid';
  }
  const ids = [...(fromFile ?? []), ...parseEnvList(env[ALLOWED_SENDERS_ENV])];
  return ids.length > 0 ? new Set(ids) : null;
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
  const allowed = loadAllowedSenders(env);
  if (allowed === null) {
    return true;
  }
  if (allowed === 'invalid') {
    return false;
  }
  return senderKeys(incoming).some((key) => allowed.has(key));
}
