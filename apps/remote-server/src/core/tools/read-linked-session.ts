import z from 'zod';
import type { Tool } from 'pulse-coder-engine';
import { sessionStore } from '../session-store.js';

const toolSchema = z.object({
  sessionId: z
    .string()
    .min(1)
    .describe('The linked session id to read. Must be one of the linked sessions listed in the system prompt.'),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe('Number of recent messages to return (newest last). Defaults to 20.'),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe('Skip the first N messages from the end. 0 means read the most recent messages.'),
  includeToolMessages: z
    .boolean()
    .default(false)
    .describe('Include tool call/result messages. Defaults to false (only user and assistant).'),
});

type ReadLinkedSessionInput = z.infer<typeof toolSchema>;

type MessageRole = 'system' | 'user' | 'assistant' | 'tool';

interface FormattedMessage {
  index: number;
  role: string;
  content: string;
}

interface ReadLinkedSessionResult {
  ok: boolean;
  sessionId: string;
  totalMessages: number;
  returnedMessages: number;
  offset: number;
  messages: FormattedMessage[];
  error?: string;
}

export const readLinkedSessionTool: Tool<ReadLinkedSessionInput, ReadLinkedSessionResult> = {
  name: 'read_linked_session',
  description:
    'Read messages from a linked session. Use when the user references linked context or when you need background from a linked session. Only works for sessions linked to the current session.',
  inputSchema: toolSchema,
  defer_loading: true,
  execute: async (input, context) => {
    const runContext = context?.runContext || {};
    const sessionId = typeof runContext.sessionId === 'string' ? runContext.sessionId : '';

    if (!sessionId) {
      return {
        ok: false,
        sessionId: input.sessionId,
        totalMessages: 0,
        returnedMessages: 0,
        offset: 0,
        messages: [],
        error: 'No current session in run context',
      };
    }

    // Verify the target is actually linked to the current session
    const linkedSessions = await sessionStore.getLinkedSessionsForSession(sessionId);
    const isLinked = linkedSessions.some((link) => link.sessionId === input.sessionId);

    if (!isLinked) {
      return {
        ok: false,
        sessionId: input.sessionId,
        totalMessages: 0,
        returnedMessages: 0,
        offset: 0,
        messages: [],
        error: `Session ${input.sessionId} is not linked to current session. Available linked sessions: ${linkedSessions.map((l) => l.sessionId).join(', ') || 'none'}`,
      };
    }

    // Read the target session using platformKey + ownerKey for access control
    const platformKey = typeof runContext.platformKey === 'string' ? runContext.platformKey : '';
    const ownerKey = typeof runContext.ownerKey === 'string' ? runContext.ownerKey : undefined;

    const detail = await sessionStore.getSessionDetail(platformKey, input.sessionId, ownerKey);
    if (!detail) {
      return {
        ok: false,
        sessionId: input.sessionId,
        totalMessages: 0,
        returnedMessages: 0,
        offset: 0,
        messages: [],
        error: `Session ${input.sessionId} not found or not accessible`,
      };
    }

    const allMessages = detail.messages as Array<{ role?: unknown; content?: unknown }>;

    // Filter messages by role
    const filtered = allMessages
      .map((msg, idx) => ({ msg, idx }))
      .filter(({ msg }) => {
        const role = typeof msg.role === 'string' ? msg.role : '';
        if (role === 'user' || role === 'assistant') return true;
        if (input.includeToolMessages && role === 'tool') return true;
        return false;
      });

    // Apply offset and limit (from the end)
    const start = Math.max(0, filtered.length - input.limit - input.offset);
    const end = Math.max(0, filtered.length - input.offset);
    const sliced = filtered.slice(start, end);

    const messages: FormattedMessage[] = sliced.map(({ msg, idx }) => ({
      index: idx,
      role: String(msg.role ?? 'unknown'),
      content: contentToText(msg.content),
    }));

    return {
      ok: true,
      sessionId: input.sessionId,
      totalMessages: allMessages.length,
      returnedMessages: messages.length,
      offset: input.offset,
      messages,
    };
  },
};

function contentToText(content: unknown): string {
  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    const parts = content
      .map((item) => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'text' in item) {
          const text = (item as { text?: unknown }).text;
          return typeof text === 'string' ? text : '';
        }
        return '';
      })
      .filter((part) => part.trim().length > 0);
    return parts.join(' ');
  }

  if (content && typeof content === 'object') {
    try {
      return JSON.stringify(content);
    } catch {
      return String(content);
    }
  }

  return String(content ?? '');
}
