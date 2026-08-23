import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConversationRuntimeService, type ConversationStoreAdapter } from './conversation-service';
import type { CanvasAgentMessage, CanvasAgentSession } from '../types';
import { conversationKey } from '../../../shared/conversation-runtime';

/**
 * Service-level proof of the conversation-runtime path: the workspace's shared
 * agent stays one engine; each conversation key owns an independent runtime.
 * Two conversations in one workspace run in PARALLEL, abort is per-conversation,
 * and a second turn against the SAME conversation is serialized.
 */

const sessions = new Map<string, CanvasAgentSession>();

const makeSession = (id: string, messages: CanvasAgentMessage[]): CanvasAgentSession => ({
  sessionId: id,
  workspaceId: 'ws-a',
  scope: { kind: 'workspace', workspaceId: 'ws-a' },
  startedAt: new Date().toISOString(),
  messages,
});

const mockAgent = vi.hoisted(() => {
  const agent = {
    initialize: vi.fn(async () => undefined),
    chat: vi.fn(async (message: string, ..._args: any[]): Promise<{
      response: string;
      sessionChanged?: { activeSessionId: string | null; error: string };
    }> => ({ response: `echo:${message}` })),
    readSessionById: vi.fn(async (id: string) => sessions.get(id) ?? null),
    replaceSessionMessagesById: vi.fn(async () => undefined),
    getCurrentSessionId: vi.fn(() => 'session-a'),
  };
  return { agent };
});

vi.mock('../canvas-agent', () => ({
  CanvasAgent: vi.fn().mockImplementation(() => mockAgent.agent),
}));

const scope = { kind: 'workspace', workspaceId: 'ws-a' } as const;

/** In-memory store adapter so the service's persistence is observable. */
function makeStoreAdapter(): ConversationStoreAdapter & { writes: Array<[string, CanvasAgentMessage[]]> } {
  const writes: Array<[string, CanvasAgentMessage[]]> = [];
  const stored = new Map<string, CanvasAgentMessage[]>();
  for (const [id, session] of sessions) stored.set(id, [...session.messages]);
  return {
    writes,
    loadMessages: async (sessionId) => stored.get(sessionId) ?? [],
    persist: async (sessionId, messages) => {
      stored.set(sessionId, [...messages]);
      writes.push([sessionId, [...messages]]);
    },
  };
}

beforeEach(() => {
  sessions.clear();
  sessions.set('session-a', makeSession('session-a', []));
  sessions.set('session-b', makeSession('session-b', []));
  mockAgent.agent.chat.mockClear();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ConversationRuntimeService.chat', () => {
  it('runs two conversations in one workspace in parallel (independent runtimes)', async () => {
    const service = new ConversationRuntimeService(
      () => mockAgent.agent as never,
      () => makeStoreAdapter(),
    );

    let releaseA!: () => void;
    let releaseB!: () => void;
    const gateA = new Promise<void>(r => { releaseA = r; });
    const gateB = new Promise<void>(r => { releaseB = r; });
    mockAgent.agent.chat.mockImplementation(async (message: string) => {
      if (message === 'A') await gateA;
      if (message === 'B') await gateB;
      return { response: `echo:${message}` };
    });

    const runA = service.chat(scope, 'session-a', 'A');
    const runB = service.chat(scope, 'session-b', 'B');

    await new Promise(r => setTimeout(r, 10));
    expect(mockAgent.agent.chat).toHaveBeenCalledTimes(2);

    releaseA();
    releaseB();

    const [resA, resB] = await Promise.all([runA, runB]);
    expect(resA.ok).toBe(true);
    expect(resB.ok).toBe(true);
  });

  it('isolates state between conversations (no cross-talk)', async () => {
    const adapter = makeStoreAdapter();
    const service = new ConversationRuntimeService(
      () => mockAgent.agent as never,
      () => adapter,
    );
    const keyA = conversationKey(scope, 'session-a');
    const keyB = conversationKey(scope, 'session-b');

    await service.chat(scope, 'session-a', 'hello-A');
    await service.chat(scope, 'session-b', 'hello-B');

    const writeA = adapter.writes.find(([id]) => id === 'session-a');
    const writeB = adapter.writes.find(([id]) => id === 'session-b');
    expect(writeA?.[1].map(m => m.content)).toEqual(['hello-A', 'echo:hello-A']);
    expect(writeB?.[1].map(m => m.content)).toEqual(['hello-B', 'echo:hello-B']);
    expect(keyA.sessionId).not.toBe(keyB.sessionId);
  });

  it('serializes a second turn against the same conversation (queue, not interleave)', async () => {
    const service = new ConversationRuntimeService(
      () => mockAgent.agent as never,
      () => makeStoreAdapter(),
    );
    let resolveFirst!: () => void;
    const gate = new Promise<void>(r => { resolveFirst = r; });
    let first = true;
    mockAgent.agent.chat.mockImplementation(async (message: string) => {
      if (first) {
        first = false;
        await gate;
      }
      return { response: `echo:${message}` };
    });

    const run1 = service.chat(scope, 'session-a', 'first');
    const run2 = service.chat(scope, 'session-a', 'second');

    await new Promise(r => setTimeout(r, 10));
    expect(mockAgent.agent.chat).toHaveBeenCalledTimes(1);

    resolveFirst();
    const [res1, res2] = await Promise.all([run1, run2]);
    expect(res1.ok).toBe(true);
    expect(res2.ok).toBe(true);
    expect(mockAgent.agent.chat).toHaveBeenCalledTimes(2);
    expect(res2.response).toBe('echo:second');
  });

  it('streams text deltas to the caller while running', async () => {
    const service = new ConversationRuntimeService(
      () => mockAgent.agent as never,
      () => makeStoreAdapter(),
    );
    const deltas: string[] = [];
    mockAgent.agent.chat.mockImplementation(async (_message: string, onText?: (d: string) => void) => {
      onText?.('hel');
      onText?.('lo');
      return { response: 'hello' };
    });

    const result = await service.chat(scope, 'session-a', 'hi', {
      onText: (d) => deltas.push(d),
    });
    expect(result.ok).toBe(true);
    expect(deltas).toEqual(['hel', 'lo']);
  });

  it('forwards turn context, attachments, mentions, and role progress to the engine', async () => {
    const service = new ConversationRuntimeService(
      () => mockAgent.agent as never,
      () => makeStoreAdapter(),
    );
    const roleStarts: unknown[] = [];
    const roleEnds: unknown[] = [];
    const startEvent = { index: 0, total: 1, speakerRole: null, queue: [null] };
    const endEvent = { index: 0, total: 1, response: 'done', speakerRole: null };
    mockAgent.agent.chat.mockImplementationOnce(async (message: string, ...args: unknown[]) => {
      (args[10] as (event: unknown) => void)(startEvent);
      (args[11] as (event: unknown) => void)(endEvent);
      return { response: `echo:${message}` };
    });

    const attachment = { id: 'image-1', path: '/tmp/image.png', mimeType: 'image/png' };
    const requestContext = { executionMode: 'ask' as const, quickAction: 'review' };
    const result = await service.chat(scope, 'session-a', 'hello', {
      onRoleTurnStart: event => roleStarts.push(event),
      onRoleTurnEnd: event => roleEnds.push(event),
    }, {
      mentionedWorkspaceIds: ['ws-b'],
      requestContext,
      attachments: [attachment],
    });

    expect(result.ok).toBe(true);
    const call = mockAgent.agent.chat.mock.calls[0];
    expect(call[4]).toEqual(['ws-b']);
    expect(call[6]).toMatchObject({
      ...requestContext,
      expectedConversationSessionId: 'session-a',
    });
    expect(call[7]).toEqual([attachment]);
    expect(roleStarts).toEqual([startEvent]);
    expect(roleEnds).toEqual([endEvent]);
  });

  it('returns a failed chat result when the engine turn throws', async () => {
    const service = new ConversationRuntimeService(
      () => mockAgent.agent as never,
      () => makeStoreAdapter(),
    );
    mockAgent.agent.chat.mockRejectedValueOnce(new Error('provider unavailable'));

    const result = await service.chat(scope, 'session-a', 'hello');

    expect(result).toMatchObject({
      ok: false,
      error: 'provider unavailable',
    });
  });

  it('preserves a changed-session failure from the engine', async () => {
    const service = new ConversationRuntimeService(
      () => mockAgent.agent as never,
      () => makeStoreAdapter(),
    );
    mockAgent.agent.chat.mockResolvedValueOnce({
      response: '',
      sessionChanged: {
        activeSessionId: 'session-b',
        error: 'Conversation changed while the turn was starting.',
      },
    });

    const result = await service.chat(scope, 'session-a', 'hello');

    expect(result).toMatchObject({
      ok: false,
      code: 'CHAT_SESSION_CHANGED',
      error: 'Conversation changed while the turn was starting.',
    });
  });

  it('returns a failed chat result when conversation persistence fails', async () => {
    const adapter = makeStoreAdapter();
    adapter.persist = vi.fn().mockRejectedValue(new Error('disk full'));
    const service = new ConversationRuntimeService(
      () => mockAgent.agent as never,
      () => adapter,
    );

    const result = await service.chat(scope, 'session-a', 'hello');

    expect(result).toMatchObject({
      ok: false,
      error: 'disk full',
    });
  });
});
