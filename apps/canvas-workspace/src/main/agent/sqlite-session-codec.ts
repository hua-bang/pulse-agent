import { createHash, randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import type { ConversationSnapshot, EntityRecord, JsonObject } from '@pulse-coder/storage';
import { StorageError } from '@pulse-coder/storage';
import type { CanvasAgentMessage, CanvasAgentSession } from './types';
import { sessionPreview } from './session-preview';
import { sessionUpdatedAt, type AgentSessionListEntry } from './session-file-summary';

type IdentifiedMessage = CanvasAgentMessage & { id?: string };

export function sessionJson(value: unknown): JsonObject {
  try {
    const parsed: unknown = JSON.parse(JSON.stringify(value, (_key, item: unknown) => {
      if (typeof item === 'bigint' || typeof item === 'function' || typeof item === 'symbol'
        || (typeof item === 'number' && !Number.isFinite(item))) throw new Error('Invalid JSON value');
      return item;
    }));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Expected an object');
    return parsed as JsonObject;
  } catch {
    throw new StorageError('invalid_argument', 'Session data must be a JSON object');
  }
}

function messageBody(value: EntityRecord): JsonObject {
  const { id: _id, ...body } = value;
  return body;
}

export function encodeSessionMessages(
  scopeId: string,
  sessionId: string,
  messages: CanvasAgentMessage[],
  options: { migration?: boolean; previous?: EntityRecord[] } = {},
): EntityRecord[] {
  const ids = new Set<string>();
  return messages.map((message, index) => {
    const encoded = sessionJson(message);
    let id = (message as IdentifiedMessage).id;
    if (id === undefined) {
      const previous = options.previous?.[index];
      if (previous && isDeepStrictEqual(messageBody(previous), encoded)) id = previous.id;
      else id = options.migration
        ? `legacy-${createHash('sha256').update(JSON.stringify([scopeId, sessionId, index])).digest('hex').slice(0, 32)}`
        : `message-${randomUUID()}`;
      (message as IdentifiedMessage).id = id;
    }
    if (typeof id !== 'string' || !id || ids.has(id)) {
      throw new StorageError('invalid_argument', 'Session messages must have unique string identities');
    }
    ids.add(id);
    return { ...encoded, id };
  });
}

export function encodeSessionMetadata(
  session: CanvasAgentSession,
  previous: JsonObject = {},
  display: JsonObject = {},
  sortKey = 0,
): JsonObject {
  const { messages, sessionId: _sessionId, ...header } = session;
  const firstUser = messages.find(message => message.role === 'user');
  return sessionJson({
    ...previous,
    ...display,
    session: header,
    messageCount: messages.length,
    preview: firstUser ? sessionPreview(firstUser.content) : '',
    date: session.startedAt.slice(0, 10),
    updatedAt: sessionUpdatedAt(session, sortKey),
    ...(sortKey ? { sortKey } : {}),
  });
}

export function decodeSession(snapshot: ConversationSnapshot): CanvasAgentSession {
  const header = snapshot.metadata.session;
  if (!header || typeof header !== 'object' || Array.isArray(header)
    || typeof header.startedAt !== 'string' || typeof header.workspaceId !== 'string') {
    throw new StorageError('corrupt_data', `Invalid stored session metadata: ${snapshot.sessionId}`);
  }
  return {
    ...header,
    sessionId: snapshot.sessionId,
    workspaceId: header.workspaceId,
    startedAt: header.startedAt,
    messages: snapshot.messages.map(message => sessionJson(message) as unknown as CanvasAgentMessage),
  };
}

export function sessionListEntry(
  snapshot: Omit<ConversationSnapshot, 'messages'>,
  currentSessionId: string | null,
): AgentSessionListEntry {
  const metadata = snapshot.metadata;
  return {
    sessionId: snapshot.sessionId,
    date: typeof metadata.date === 'string' ? metadata.date : '',
    updatedAt: typeof metadata.updatedAt === 'number' ? metadata.updatedAt : 0,
    messageCount: typeof metadata.messageCount === 'number' ? metadata.messageCount : 0,
    preview: typeof metadata.preview === 'string' ? metadata.preview : '',
    ...(typeof metadata.title === 'string' ? { title: metadata.title } : {}),
    pinned: metadata.pinned === true,
    isCurrent: snapshot.sessionId === currentSessionId,
  };
}

/** A legacy file whose content cannot be read as a session; unsupported schemas are not this. */
export class UnreadableSessionFileError extends Error {
  constructor(readonly path: string, message: string) {
    super(message);
    this.name = 'UnreadableSessionFileError';
  }
}

export function validateLegacySession(value: unknown, path: string): CanvasAgentSession {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UnreadableSessionFileError(path, `Invalid session at ${path}`);
  const session = value as CanvasAgentSession & { schemaVersion?: unknown };
  if (session.schemaVersion !== undefined && session.schemaVersion !== 1) throw new Error(`Unsupported session schema at ${path}`);
  if (typeof session.sessionId !== 'string' || !session.sessionId || typeof session.workspaceId !== 'string'
    || typeof session.startedAt !== 'string' || !Number.isFinite(Date.parse(session.startedAt)) || !Array.isArray(session.messages)) {
    throw new UnreadableSessionFileError(path, `Invalid session header at ${path}`);
  }
  for (const message of session.messages) {
    if (!message || (message.role !== 'user' && message.role !== 'assistant') || typeof message.content !== 'string'
      || !Number.isFinite(message.timestamp)) throw new UnreadableSessionFileError(path, `Invalid message in session at ${path}`);
  }
  return session;
}

export function readLegacySessionDisplayMetadata(value: unknown, path: string): Record<string, JsonObject> {
  if (value === undefined) return {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new UnreadableSessionFileError(path, `Invalid session metadata: ${path}`);
  const document = value as Record<string, unknown>;
  if (document.version !== undefined && document.version !== 2) throw new Error(`Unsupported session metadata schema: ${path}`);
  const entries = document.version === 2 ? document.sessions : document;
  if (!entries || typeof entries !== 'object' || Array.isArray(entries)) throw new UnreadableSessionFileError(path, `Invalid session metadata entries: ${path}`);
  for (const metadata of Object.values(entries)) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) throw new UnreadableSessionFileError(path, `Invalid session display metadata: ${path}`);
    const entry = metadata as Record<string, unknown>;
    if ((entry.title !== undefined && typeof entry.title !== 'string') || (entry.pinned !== undefined && typeof entry.pinned !== 'boolean')) {
      throw new UnreadableSessionFileError(path, `Invalid session title or pin: ${path}`);
    }
  }
  return entries as Record<string, JsonObject>;
}
