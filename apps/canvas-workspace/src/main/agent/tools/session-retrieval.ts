/**
 * Session-granularity conversation retrieval (verbatim, read-only).
 *
 *   - canvas_session_list : discover past sessions in the current scope
 *   - canvas_session_read : read the verbatim messages of a session by id
 *
 * This reads SessionStore directly and NEVER touches the memory plugin. It is
 * the complement to canvas_memory_recall: that searches distilled memory; this
 * returns "what we actually said" in an earlier conversation.
 */

import { z } from 'zod';
import type { CanvasTool } from './types';
import type { AgentScope, CanvasAgentMessage } from '../types';
import { GLOBAL_CHAT_SESSION_STORE_ID, SessionStore } from '../session-store';

export interface SessionRetrievalDeps {
  scope: AgentScope;
}

const LIST_SCHEMA = z.object({
  limit: z.number().int().min(1).max(50).optional().describe('Max sessions to return (default 20).'),
  query: z
    .string()
    .optional()
    .describe('Optional keyword to filter sessions by their first-message preview.'),
});

const READ_SCHEMA = z.object({
  sessionId: z
    .string()
    .min(1)
    .describe('Session id from canvas_session_list or a memory recall hit. Never invent one.'),
  maxMessages: z.number().int().min(1).max(500).optional().describe('Cap messages (newest first; default 200).'),
  includeToolCalls: z.boolean().optional().describe('Append tool-call names per message. Defaults to false.'),
});

const DEFAULT_LIST_LIMIT = 20;
const DEFAULT_MAX_MESSAGES = 200;

function storeIdForScope(scope: AgentScope): string {
  return scope.kind === 'workspace' ? scope.workspaceId : GLOBAL_CHAT_SESSION_STORE_ID;
}

function trimText(text: string, max = 240): string {
  const normalized = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '(empty)';
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

/** Format a session's tail into role-prefixed excerpt lines. Pure (testable). */
export function formatSessionExcerpt(
  messages: CanvasAgentMessage[],
  maxMessages: number,
  includeToolCalls: boolean,
): string[] {
  return messages.slice(-Math.max(1, maxMessages)).map((message) => {
    let line = `${message.role}: ${trimText(message.content)}`;
    if (includeToolCalls && message.toolCalls && message.toolCalls.length > 0) {
      const names = message.toolCalls.map((call) => call.name).join(', ');
      line += `\n  [tools: ${names}]`;
    }
    return line;
  });
}

export function createSessionRetrievalTools(deps: SessionRetrievalDeps): Record<string, CanvasTool> {
  const storeId = storeIdForScope(deps.scope);

  const list: CanvasTool = {
    name: 'canvas_session_list',
    description:
      'List past chat sessions in the current scope (most recent first) so you can find an earlier conversation to open with canvas_session_read. Read-only.',
    inputSchema: LIST_SCHEMA,
    execute: async (input) => {
      const all = await SessionStore.listAllWorkspaceSessions();
      const mine = all.find((entry) => entry.workspaceId === storeId);
      let sessions = mine?.sessions ?? [];
      const query = String(input.query ?? '').trim().toLowerCase();
      if (query) {
        sessions = sessions.filter((session) => session.preview.toLowerCase().includes(query));
      }
      const limit = Math.min(50, Math.max(1, input.limit ?? DEFAULT_LIST_LIMIT));
      sessions = sessions.slice(0, limit);
      return JSON.stringify({ ok: true, count: sessions.length, sessions });
    },
  };

  const read: CanvasTool = {
    name: 'canvas_session_read',
    description:
      'Read the verbatim messages of a past session by id (from canvas_session_list, or the sessionId on a canvas_memory_recall hit). Read-only; never writes memory.',
    inputSchema: READ_SCHEMA,
    execute: async (input) => {
      const sessionId = String(input.sessionId ?? '').trim();
      if (!sessionId) return JSON.stringify({ ok: false, error: 'sessionId is required' });
      const session = await SessionStore.readSessionFromWorkspace(storeId, sessionId);
      if (!session) return JSON.stringify({ ok: false, error: `session not found: ${sessionId}` });
      const maxMessages = Math.min(500, Math.max(1, input.maxMessages ?? DEFAULT_MAX_MESSAGES));
      const excerpt = formatSessionExcerpt(session.messages, maxMessages, input.includeToolCalls ?? false);
      return JSON.stringify({
        ok: true,
        sessionId: session.sessionId,
        startedAt: session.startedAt,
        messageCount: session.messages.length,
        excerpt,
      });
    },
  };

  return { canvas_session_list: list, canvas_session_read: read };
}
