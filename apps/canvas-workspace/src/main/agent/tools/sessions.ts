/**
 * Chat-session history tools.
 *
 * These answer "what did we talk about" questions over the agent's own chat
 * sessions (current + archived, every workspace + global chat):
 *   - `session_search`  — keyword retrieval across stored sessions (会话检索)
 *   - `session_summary` — compact transcript excerpts of one session or a
 *     recent time window so the model can write the summary itself (会话总结)
 *
 * Both read the on-disk session store (`~/.pulse-coder/canvas/<id>/agent-sessions`)
 * via `SessionStore.readAllSessionsWithMeta()`; neither mutates anything.
 *
 * Both are `defer_loading` — they sit behind tool search when the engine has
 * the tool-search plugin, and are documented in the system prompts either way.
 */

import { z } from 'zod';
import { SessionStore, type SessionWithMeta } from '../session-store';
import type { CanvasAgentMessage } from '../types';
import type { CanvasTool } from './types';

// ─── Shared helpers ────────────────────────────────────────────────

function trimText(text: string, max = 240): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return '(empty)';
  return normalized.length > max ? `${normalized.slice(0, max)}...` : normalized;
}

/** Snippet centered on the first occurrence of `query` (already lowercased). */
function matchSnippet(text: string, query: string, radius = 80): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  const idx = normalized.toLowerCase().indexOf(query);
  if (idx < 0) return trimText(normalized, radius * 2);
  const start = Math.max(0, idx - radius);
  const end = Math.min(normalized.length, idx + query.length + radius);
  return `${start > 0 ? '...' : ''}${normalized.slice(start, end)}${end < normalized.length ? '...' : ''}`;
}

/** Millisecond timestamp of the session's last activity (for window filters). */
function lastActivityMs(entry: SessionWithMeta): number {
  const messages = entry.session.messages ?? [];
  for (let i = messages.length - 1; i >= 0; i--) {
    const ts = messages[i]?.timestamp;
    if (typeof ts === 'number' && Number.isFinite(ts)) return ts;
  }
  const started = Date.parse(entry.session.startedAt ?? '');
  return Number.isFinite(started) ? started : entry.sortKey;
}

function previewOf(messages: CanvasAgentMessage[]): string {
  const firstUser = messages.find((m) => m.role === 'user');
  return firstUser ? trimText(firstUser.content, 80) : '';
}

function sessionHeader(entry: SessionWithMeta): Record<string, unknown> {
  const { session } = entry;
  return {
    sessionId: session.sessionId,
    workspaceId: session.workspaceId,
    workspaceName: entry.workspaceName,
    date: session.startedAt?.slice(0, 10) ?? '',
    isCurrent: entry.isCurrent,
    messageCount: session.messages.length,
  };
}

async function loadSessions(workspaceId?: string): Promise<SessionWithMeta[]> {
  const all = await SessionStore.readAllSessionsWithMeta();
  if (!workspaceId) return all;
  return all.filter((entry) => entry.session.workspaceId === workspaceId);
}

// ─── Tools ─────────────────────────────────────────────────────────

export function createSessionTools(currentWorkspaceId?: string): Record<string, CanvasTool> {
  const workspaceIdDescription = currentWorkspaceId
    ? 'Restrict to one workspace\'s sessions (the session-store id; use the current workspaceId for "this workspace"). Omit to search EVERY workspace plus global chat.'
    : 'Restrict to one workspace\'s sessions (the session-store id, from `canvas_list_workspaces`). Omit to search EVERY workspace plus global chat.';

  return {
    session_search: {
      name: 'session_search',
      defer_loading: true,
      description:
        'Search past AI chat sessions (会话检索) — current and archived, across every workspace and global chat — by case-insensitive keyword over the stored user/assistant messages. ' +
        'Returns matching sessions (newest first) with workspace name, date, message count, and snippets around each hit. ' +
        'Use this when the user asks "我们之前聊过 X 吗 / 找一下上次关于 X 的对话 / when did we discuss X". ' +
        'This searches chat history, NOT canvas nodes — use `canvas_search_nodes` for nodes. ' +
        'Follow up with `session_summary` (pass the sessionId) to read a session in more detail.',
      inputSchema: z.object({
        query: z.string().min(1).describe('Case-insensitive substring matched against message text.'),
        workspaceId: z.string().optional().describe(workspaceIdDescription),
        role: z.enum(['user', 'assistant']).optional().describe('Only match messages from this role. Omit to match both.'),
        limit: z.number().int().positive().max(100).optional().describe('Max sessions to return. Default 20.'),
        snippetsPerSession: z.number().int().positive().max(10).optional().describe('Max matched-message snippets per session. Default 3.'),
      }),
      execute: async (input) => {
        const query = String(input.query ?? '').trim().toLowerCase();
        if (!query) return 'Error: query must not be empty.';
        const limit = (input.limit as number | undefined) ?? 20;
        const snippetsPerSession = (input.snippetsPerSession as number | undefined) ?? 3;
        const roleFilter = input.role as 'user' | 'assistant' | undefined;

        const sessions = await loadSessions(input.workspaceId as string | undefined);

        const matches: Array<Record<string, unknown>> = [];
        let total = 0;
        for (const entry of sessions) {
          const snippets: Array<{ role: string; messageIndex: number; snippet: string }> = [];
          let matchCount = 0;
          for (let mi = 0; mi < entry.session.messages.length; mi++) {
            const message = entry.session.messages[mi];
            if (roleFilter && message.role !== roleFilter) continue;
            if (typeof message.content !== 'string') continue;
            if (!message.content.toLowerCase().includes(query)) continue;
            matchCount += 1;
            if (snippets.length < snippetsPerSession) {
              snippets.push({ role: message.role, messageIndex: mi, snippet: matchSnippet(message.content, query) });
            }
          }
          if (matchCount === 0) continue;

          total += 1;
          if (matches.length >= limit) continue;
          matches.push({
            ...sessionHeader(entry),
            matchCount,
            preview: previewOf(entry.session.messages),
            snippets,
          });
        }

        return JSON.stringify({
          ok: true,
          query: input.query,
          total,
          returned: matches.length,
          truncated: total > matches.length,
          sessions: matches,
        });
      },
    },

    session_summary: {
      name: 'session_summary',
      defer_loading: true,
      description:
        'Fetch compact transcript excerpts of past AI chat sessions (会话总结) so you can summarize them. ' +
        'Pass `sessionId` (e.g. from `session_search` or the user) to pull ONE session, or omit it to pull every session active in the last `days` days (default 3) across workspaces and global chat. ' +
        'Returns per-session "role: text" excerpt lines (each line trimmed); read them and write the summary yourself — the tool does not call an LLM. ' +
        'Use this when the user asks "总结一下今天/这周的会话 / what did we discuss in that session / recap our last conversation".',
      inputSchema: z.object({
        sessionId: z.string().optional().describe('Summarize this one session. Only use an id from session_search output or the user; never invent one.'),
        workspaceId: z.string().optional().describe(workspaceIdDescription),
        days: z.number().int().min(1).max(30).optional().describe('When no sessionId is given: include sessions active within the last N days. Default 3.'),
        offsetDays: z.number().int().min(0).max(365).optional().describe('Shift the time window back by N days from today (0 = window ends today).'),
        maxMessagesPerSession: z.number().int().min(5).max(500).optional().describe('Cap excerpt lines per session, keeping the newest. Default 100.'),
        includeUserMessages: z.boolean().optional().describe('Include user messages in the excerpt. Default true.'),
        includeAssistantMessages: z.boolean().optional().describe('Include assistant messages in the excerpt. Default true.'),
        includeToolCalls: z.boolean().optional().describe('Also report the unique tool names each session used. Default false.'),
      }),
      execute: async (input) => {
        const includeUser = input.includeUserMessages !== false;
        const includeAssistant = input.includeAssistantMessages !== false;
        const includeToolCalls = input.includeToolCalls === true;
        const maxMessages = (input.maxMessagesPerSession as number | undefined) ?? 100;

        const sessions = await loadSessions(input.workspaceId as string | undefined);

        let selected: SessionWithMeta[];
        let window: { since: string; until: string } | undefined;
        if (typeof input.sessionId === 'string' && input.sessionId.trim()) {
          const sessionId = input.sessionId.trim();
          selected = sessions.filter((entry) => entry.session.sessionId === sessionId);
          if (selected.length === 0) return `Error: session not found: ${sessionId}`;
        } else {
          const days = (input.days as number | undefined) ?? 3;
          const offsetDays = (input.offsetDays as number | undefined) ?? 0;
          const now = new Date();
          const todayUtc = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
          const untilMs = todayUtc - offsetDays * 86_400_000 + 86_400_000 - 1; // end of the window's last day
          const sinceMs = untilMs + 1 - days * 86_400_000;
          selected = sessions.filter((entry) => {
            const activity = lastActivityMs(entry);
            return activity >= sinceMs && activity <= untilMs;
          });
          window = {
            since: new Date(sinceMs).toISOString().slice(0, 10),
            until: new Date(untilMs).toISOString().slice(0, 10),
          };
        }

        const summaries = selected.map((entry) => {
          const filtered = entry.session.messages
            .filter((message) => (message.role === 'user' ? includeUser : includeAssistant))
            .slice(-maxMessages);
          const excerpt = filtered.map((message) => `${message.role}: ${trimText(message.content)}`);
          const summary: Record<string, unknown> = {
            ...sessionHeader(entry),
            excerptMessageCount: filtered.length,
            excerpt,
          };
          if (includeToolCalls) {
            const toolNames = new Set<string>();
            for (const message of entry.session.messages) {
              for (const call of message.toolCalls ?? []) {
                if (call.name) toolNames.add(call.name);
              }
            }
            summary.toolsUsed = Array.from(toolNames);
          }
          return summary;
        });

        return JSON.stringify({
          ok: true,
          ...(window ? window : {}),
          matchedSessions: summaries.length,
          sessions: summaries,
        });
      },
    },
  };
}
