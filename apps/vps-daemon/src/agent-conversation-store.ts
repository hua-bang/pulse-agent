import { randomUUID } from 'node:crypto';
import type { PulseStorage } from '@pulse-coder/storage';

export interface StoredChatMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  senderName?: string;
  runId?: string;
  /** `stopped` / `failed` mark a reply that did not finish normally. */
  turnStatus?: 'stopped' | 'failed';
  toolCalls?: Array<{
    id: number;
    name: string;
    args?: Record<string, unknown>;
    toolCallId?: string;
    status: 'succeeded' | 'failed' | 'cancelled';
    result?: unknown;
    error?: string;
  }>;
}

const MAX_COMMIT_ATTEMPTS = 3;

export function extractStoredMessages(raw: unknown): StoredChatMessage[] {
  if (!raw || typeof raw !== 'object') return [];
  const obj = raw as { messages?: unknown[]; entries?: Array<{ data?: unknown }> };
  const list = Array.isArray(obj.messages)
    ? obj.messages
    : Array.isArray(obj.entries)
      ? obj.entries.map((e) => e?.data)
      : [];
  const out: StoredChatMessage[] = [];
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const rec = item as Record<string, unknown>;
    if ((rec.role === 'user' || rec.role === 'assistant') && typeof rec.content === 'string') {
      out.push({
        role: rec.role,
        content: rec.content,
        timestamp: typeof rec.timestamp === 'number' ? rec.timestamp : Date.now(),
        ...(typeof rec.senderName === 'string' ? { senderName: rec.senderName } : {}),
        ...(Array.isArray(rec.toolCalls) ? { toolCalls: rec.toolCalls as StoredChatMessage['toolCalls'] } : {}),
      });
    }
  }
  return out;
}

function isRevisionConflict(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return code === 'revision_conflict' || code === 'conflict';
}

/**
 * Append messages to a conversation and point the scope at it. Retries on a
 * revision conflict, so a desktop write that lands between read and commit
 * does not lose this turn.
 */
export async function appendConversationMessages(
  storage: PulseStorage,
  workspaceId: string,
  sessionId: string,
  newMessages: StoredChatMessage[],
  titleHint: string,
): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      await commitOnce(storage, workspaceId, sessionId, newMessages, titleHint);
      break;
    } catch (err) {
      if (attempt >= MAX_COMMIT_ATTEMPTS || !isRevisionConflict(err)) throw err;
    }
  }
  const scope = await storage.conversationScopes.read(workspaceId).catch(() => null);
  await storage.conversationScopes.commit({
    scopeId: workspaceId,
    expectedRevision: scope?.revision ?? null,
    currentSessionId: sessionId,
  }).catch(() => undefined);
}

async function commitOnce(
  storage: PulseStorage,
  workspaceId: string,
  sessionId: string,
  newMessages: StoredChatMessage[],
  titleHint: string,
): Promise<void> {
  const existing = await storage.conversations.read(workspaceId, sessionId).catch(() => null);
  const prevMeta = (existing?.metadata ?? {}) as Record<string, unknown>;
  const prevSession =
    prevMeta.session && typeof prevMeta.session === 'object' && !Array.isArray(prevMeta.session)
      ? (prevMeta.session as Record<string, unknown>)
      : {};
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  const title = typeof prevMeta.title === 'string' && prevMeta.title ? prevMeta.title : titleHint.slice(0, 60);
  const startedAt = typeof prevSession.startedAt === 'string' ? prevSession.startedAt : nowIso;
  const lastContent = newMessages[newMessages.length - 1]?.content ?? '';
  await storage.conversations.commit({
    scopeId: workspaceId,
    sessionId,
    expectedRevision: existing?.revision ?? null,
    metadata: {
      ...prevMeta,
      session: {
        ...prevSession,
        sessionId,
        workspaceId,
        startedAt,
        title,
      },
      title,
      date: typeof prevMeta.date === 'string' ? prevMeta.date : startedAt.slice(0, 10),
      updatedAt: now,
      messageCount: extractStoredMessages(existing).length + newMessages.length,
      preview: lastContent.slice(0, 120),
    },
    appendMessages: newMessages.map((msg) =>
      JSON.parse(
        JSON.stringify({
          id: `msg-${randomUUID().slice(0, 8)}`,
          ...msg,
        }),
      ),
    ),
  });
}
