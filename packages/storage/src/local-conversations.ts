import { randomUUID } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { ConversationSnapshot, EntityRecord, JsonObject, PulseStorage } from './contracts.js';
import {
  openLocalStorage, readLocalStorageStatus, withLegacyCanvasWrite, writeJsonAtomic,
  type LocalStorageOptions,
} from './local.js';
import { StorageError, isStorageError } from './errors.js';
import { openSqliteStorage, type SqliteStorage } from './sqlite/index.js';
import { encodeJson, validateId } from './sqlite/validation.js';

export interface LegacyConversationRecord {
  sessionId: string;
  metadata: JsonObject;
  messages: EntityRecord[];
}

export interface LegacyConversationScope {
  scopeId: string;
  currentSessionId: string | null;
  conversations: LegacyConversationRecord[];
}

export interface ActivateLocalConversationStorageOptions extends LocalStorageOptions {
  /** The host validates legacy files and assigns stable message identities. */
  loadLegacyScopes: () => Promise<LegacyConversationScope[]>;
}

export async function openLocalConversationStorage(options: LocalStorageOptions): Promise<SqliteStorage | null> {
  // Opening reconciles a stale marker with DB authority before any legacy reader
  // can run (including a crash after completing the second domain's import).
  const storage = await openLocalStorage(options);
  if (!storage) return null;
  try {
    if ((await storage.localActivation.read()).some(row => row.domain === 'conversations' && row.state === 'active')) return storage;
  } catch (error) {
    await storage.close();
    throw error;
  }
  await storage.close();
  return null;
}

function snapshotsOf(input: LegacyConversationScope[]): LegacyConversationScope[] {
  if (!Array.isArray(input)) throw new StorageError('invalid_argument', 'Legacy conversation scopes must be an array');
  const scopes = JSON.parse(encodeJson(input)) as LegacyConversationScope[];
  const scopeIds = new Set<string>();
  for (const scope of scopes) {
    if (!scope || typeof scope !== 'object' || !Array.isArray(scope.conversations)) {
      throw new StorageError('invalid_argument', 'Invalid legacy conversation scope');
    }
    validateId(scope.scopeId, 'scope id');
    if (scopeIds.has(scope.scopeId)) throw new StorageError('invalid_argument', `Duplicate legacy scope: ${scope.scopeId}`);
    scopeIds.add(scope.scopeId);
    const sessionIds = new Set<string>();
    for (const conversation of scope.conversations) {
      if (!conversation || typeof conversation !== 'object' || !Array.isArray(conversation.messages)
        || !conversation.metadata || typeof conversation.metadata !== 'object' || Array.isArray(conversation.metadata)) {
        throw new StorageError('invalid_argument', 'Invalid legacy conversation');
      }
      validateId(conversation.sessionId, 'session id');
      if (sessionIds.has(conversation.sessionId)) throw new StorageError('invalid_argument', `Duplicate legacy session: ${conversation.sessionId}`);
      sessionIds.add(conversation.sessionId);
    }
    if (scope.currentSessionId !== null) {
      validateId(scope.currentSessionId, 'current session id');
      if (!sessionIds.has(scope.currentSessionId)) throw new StorageError('invalid_argument', 'The legacy current conversation is missing');
    }
  }
  return scopes;
}

async function listConversations(storage: PulseStorage, scopeId: string): Promise<Array<Omit<ConversationSnapshot, 'messages'>>> {
  const result: Array<Omit<ConversationSnapshot, 'messages'>> = [];
  let cursor: string | undefined;
  do {
    const page = await storage.conversations.list(scopeId, { cursor, limit: 500 });
    result.push(...page.items);
    cursor = page.nextCursor;
  } while (cursor !== undefined);
  return result;
}

async function importScope(storage: PulseStorage, input: LegacyConversationScope): Promise<void> {
  const scope = await storage.conversationScopes.read(input.scopeId);
  const existing = await listConversations(storage, input.scopeId);
  const revisions = new Map(existing.map(conversation => [conversation.sessionId, conversation.revision]));
  const retained = new Set(input.conversations.map(conversation => conversation.sessionId));
  await storage.conversationScopes.commit({
    scopeId: input.scopeId,
    expectedRevision: scope?.revision ?? null,
    expectedGeneration: storage.generation,
    currentSessionId: input.currentSessionId,
    conversations: input.conversations.map(conversation => ({
      sessionId: conversation.sessionId,
      expectedRevision: revisions.get(conversation.sessionId) ?? null,
      metadata: conversation.metadata,
      replaceMessages: conversation.messages,
    })),
    removeConversations: existing.filter(conversation => !retained.has(conversation.sessionId)).map(conversation => ({
      sessionId: conversation.sessionId,
      expectedRevision: conversation.revision,
    })),
  });
}

/** Imports only conversations; previously activated Canvas records are preserved. */
export async function activateLocalConversationStorage(options: ActivateLocalConversationStorageOptions): Promise<PulseStorage> {
  const active = await openLocalConversationStorage(options);
  if (active) return active;
  const connection: { storage: SqliteStorage | null } = { storage: null };
  try {
    return await withLegacyCanvasWrite(options.root, async () => {
      const current = await openLocalConversationStorage(options);
      if (current) { connection.storage = current; return current; }
      const status = await readLocalStorageStatus(options.root, options);
      const scopes = snapshotsOf(await options.loadLegacyScopes());
      const backupDirectory = join(options.root, '__storage-backup__');
      await mkdir(backupDirectory, { recursive: true });
      await writeJsonAtomic(join(backupDirectory, `conversations-${randomUUID()}.json`), {
        schemaVersion: 1, domain: 'conversations', createdAt: new Date().toISOString(), scopes,
      });
      const storage = await openLocalStorage(options) ?? await openSqliteStorage({
        path: join(options.root, '__storage__.sqlite'),
        nativeBinding: options.nativeBinding ?? await options.resolveNativeBinding?.(),
      });
      connection.storage = storage;
      await storage.localActivation.begin('conversations');
      for (const scope of scopes) await importScope(storage, scope);
      const retained = new Set(scopes.map(scope => scope.scopeId));
      let cursor: string | undefined;
      do {
        const page = await storage.conversationScopes.list({ cursor, limit: 500 });
        for (const scope of page.items) {
          if (!retained.has(scope.scopeId)) await importScope(storage, { scopeId: scope.scopeId, currentSessionId: null, conversations: [] });
        }
        cursor = page.nextCursor;
      } while (cursor !== undefined);
      const integrity = await storage.checkIntegrity();
      if (!integrity.ok) throw new StorageError('corrupt_data', `Conversation import failed integrity checks: ${integrity.issues.join('; ')}`);
      if (encodeJson(snapshotsOf(await options.loadLegacyScopes())) !== encodeJson(scopes)) {
        throw new StorageError('revision_conflict', 'Legacy conversations changed during migration; retry from the latest files');
      }
      await storage.localActivation.complete('conversations');
      await writeJsonAtomic(join(options.root, '__storage__.json'), {
        schemaVersion: 1, backend: 'sqlite', domains: [...(status?.domains ?? []), 'conversations'],
      });
      return storage;
    }, { allowActive: true, nativeBinding: options.nativeBinding, resolveNativeBinding: options.resolveNativeBinding });
  } catch (error) {
    await connection.storage?.close().catch(() => undefined);
    if (isStorageError(error)) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new StorageError('storage_unavailable', `Local conversation migration failed: ${detail}`, { cause: error });
  }
}
