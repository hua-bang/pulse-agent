import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import type { ConversationScopeSnapshot, ConversationSnapshot, PulseStorage } from '@pulse-coder/storage';
import { openLocalConversationStorage } from '@pulse-coder/storage/local-conversations';
import { readLocalStorageStatus, withLegacyCanvasWrite } from '@pulse-coder/storage/local';
import { resolveStorageNativeBinding } from '../canvas/persistence/backend';

const connections = new Map<string, Promise<PulseStorage | null>>();

export const sessionStorageRoot = (): string => (
  process.env.PULSE_CANVAS_SESSION_STORE_DIR || join(homedir(), '.pulse-coder', 'canvas')
);

export async function getSqliteSessionStorage(root = sessionStorageRoot()): Promise<PulseStorage | null> {
  const key = resolve(root);
  const pending = connections.get(key);
  if (pending) return pending;
  if (!(await readLocalStorageStatus(key))?.domains.includes('conversations')) return null;
  const opening = openLocalConversationStorage({ root: key, nativeBinding: await resolveStorageNativeBinding() });
  connections.set(key, opening);
  try {
    const storage = await opening;
    if (!storage) connections.delete(key);
    return storage;
  }
  catch (error) { connections.delete(key); throw error; }
}

export async function closeSqliteSessionStorage(): Promise<void> {
  const pending = [...connections.values()];
  connections.clear();
  for (const result of await Promise.allSettled(pending)) {
    if (result.status === 'fulfilled') await result.value?.close();
  }
}

export function withLegacySessionWrite<T>(root: string, operation: () => Promise<T>): Promise<T> {
  return withLegacyCanvasWrite(root, operation, { domain: 'conversations' });
}

export async function listSqliteConversations(storage: PulseStorage, scopeId: string) {
  const result: Array<Omit<ConversationSnapshot, 'messages'>> = [];
  let cursor: string | undefined;
  do {
    const page = await storage.conversations.list(scopeId, { cursor, limit: 500 });
    result.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return result;
}

export async function listSqliteSessionScopes(storage: PulseStorage): Promise<ConversationScopeSnapshot[]> {
  const result: ConversationScopeSnapshot[] = [];
  let cursor: string | undefined;
  do {
    const page = await storage.conversationScopes.list({ cursor, limit: 500 });
    result.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return result;
}
