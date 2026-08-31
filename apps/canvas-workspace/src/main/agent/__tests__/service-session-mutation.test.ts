import { beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { CanvasAgentMessage, CanvasAgentSession } from '../types';

const agentState = vi.hoisted(() => ({
  currentSessionId: 'session-current' as string | null,
  nextSessionId: 'session-new',
  loadCalls: [] as string[],
  loadErrors: new Map<string, Error>(),
  loadGates: new Map<string, Promise<void>>(),
  chatGate: null as Promise<void> | null,
  chatCalls: 0,
  sessions: new Map<string, CanvasAgentSession>(),
  pinned: new Map<string, boolean>(),
  titles: new Map<string, string>(),
}));

vi.mock('../canvas-agent', () => ({
  CanvasAgent: vi.fn().mockImplementation(() => ({
    initialize: vi.fn(async () => undefined),
    chat: async (
      _message: string,
      _onText?: (delta: string) => void,
      _onToolCall?: unknown,
      _onToolResult?: unknown,
      _mentionedWorkspaceIds?: string[],
      _onClarificationRequest?: unknown,
      requestContext?: { expectedConversationSessionId?: string },
    ) => {
      agentState.chatCalls += 1;
      const expected = requestContext?.expectedConversationSessionId;
      if (expected && !agentState.sessions.has(expected)) {
        return {
          response: '',
          sessionChanged: {
            activeSessionId: agentState.currentSessionId,
            error: 'This conversation no longer exists. The latest thread was restored.',
          },
        };
      }
      await agentState.chatGate;
      return { response: 'done' };
    },
    getCurrentSessionId: () => agentState.currentSessionId,
    newSession: async () => {
      agentState.currentSessionId = agentState.nextSessionId;
      agentState.sessions.set(agentState.nextSessionId, makeSession(agentState.nextSessionId, ''));
      return agentState.nextSessionId;
    },
    branchSession: async (fromIndex: number) => {
      const sourceSessionId = agentState.currentSessionId;
      const source = sourceSessionId ? agentState.sessions.get(sourceSessionId) : undefined;
      if (!sourceSessionId || !source) return null;
      const session = {
        ...makeSession(agentState.nextSessionId, ''),
        messages: source.messages.slice(0, fromIndex),
      };
      agentState.sessions.set(session.sessionId, session);
      agentState.currentSessionId = session.sessionId;
      return { sourceSessionId, session };
    },
    renameSession: async (sessionId: string, title: string) => {
      if (!agentState.sessions.has(sessionId)) return false;
      agentState.titles.set(sessionId, title);
      return true;
    },
    setSessionPinned: async (sessionId: string, pinned: boolean) => {
      if (!agentState.sessions.has(sessionId)) return false;
      agentState.pinned.set(sessionId, pinned);
      return true;
    },
    deleteSession: async (sessionId: string) => {
      const deleted = agentState.sessions.get(sessionId);
      if (!deleted) return null;
      const deletedCurrent = agentState.currentSessionId === sessionId;
      agentState.sessions.delete(sessionId);
      if (deletedCurrent) {
        const activeSession = makeSession(agentState.nextSessionId, '');
        activeSession.messages = [];
        agentState.sessions.set(activeSession.sessionId, activeSession);
        agentState.currentSessionId = activeSession.sessionId;
        return { deletedCurrent, activeSession };
      }
      const activeSession = agentState.currentSessionId
        ? agentState.sessions.get(agentState.currentSessionId)
        : undefined;
      return activeSession ? { deletedCurrent, activeSession } : null;
    },
    loadSession: async (sessionId: string) => {
      agentState.loadCalls.push(sessionId);
      await agentState.loadGates.get(sessionId);
      const error = agentState.loadErrors.get(sessionId);
      if (error) throw error;
      const session = agentState.sessions.get(sessionId) ?? null;
      if (session) agentState.currentSessionId = sessionId;
      return session;
    },
    loadCrossWorkspaceSession: async (messages: CanvasAgentMessage[]) => {
      const imported = makeSession(agentState.nextSessionId, '');
      imported.messages = messages;
      agentState.sessions.set(imported.sessionId, imported);
      agentState.currentSessionId = imported.sessionId;
    },
    appendToSession: async (sessionId: string, messages: CanvasAgentMessage[]) => {
      const existing = agentState.sessions.get(sessionId);
      const session = existing ?? makeSession(sessionId, '');
      session.messages = [...session.messages, ...messages];
      agentState.sessions.set(sessionId, session);
    },
  })),
}));

import { CanvasAgentService } from '../service';
import { SessionStore } from '../session-store';

const makeSession = (sessionId: string, content: string): CanvasAgentSession => ({
  sessionId,
  workspaceId: 'ws-session-mutation',
  startedAt: '2026-07-31T00:00:00.000Z',
  messages: [{
    role: 'user',
    content,
    timestamp: 1,
  } satisfies CanvasAgentMessage],
});

describe('CanvasAgentService session mutations', () => {
  beforeEach(() => {
    agentState.currentSessionId = 'session-current';
    agentState.nextSessionId = 'session-new';
    agentState.loadCalls.length = 0;
    agentState.loadErrors.clear();
    agentState.loadGates.clear();
    agentState.chatGate = null;
    agentState.chatCalls = 0;
    agentState.sessions.clear();
    agentState.pinned.clear();
    agentState.titles.clear();
  });

  it('applies concurrent loads for one scope in intent order so the latest intent stays active', async () => {
    let releaseSlowLoad: (() => void) | undefined;
    agentState.loadGates.set('session-a', new Promise<void>((resolve) => {
      releaseSlowLoad = resolve;
    }));
    agentState.sessions.set('session-a', makeSession('session-a', 'A'));
    agentState.sessions.set('session-b', makeSession('session-b', 'B'));

    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;
    const slowLoad = service.loadSessionForScope(scope, 'session-a');
    await vi.waitFor(() => {
      expect(agentState.loadCalls).toEqual(['session-a']);
    });

    const latestLoad = service.loadSessionForScope(scope, 'session-b');
    await Promise.resolve();
    releaseSlowLoad?.();
    const [slowResult, latestResult] = await Promise.all([slowLoad, latestLoad]);

    expect(agentState.loadCalls).toEqual(['session-a', 'session-b']);
    expect(slowResult.activeSessionId).toBe('session-a');
    expect(latestResult.activeSessionId).toBe('session-b');
    expect(service.getCurrentSessionIdForScope(scope)).toBe('session-b');
  });

  it('orders new-session after an earlier slow load for the same scope', async () => {
    let releaseSlowLoad: (() => void) | undefined;
    agentState.loadGates.set('session-a', new Promise<void>((resolve) => {
      releaseSlowLoad = resolve;
    }));
    agentState.sessions.set('session-a', makeSession('session-a', 'A'));

    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;
    const slowLoad = service.loadSessionForScope(scope, 'session-a');
    await vi.waitFor(() => {
      expect(agentState.loadCalls).toEqual(['session-a']);
    });

    const latestNewSession = service.newSessionForScope(scope);
    releaseSlowLoad?.();
    await Promise.all([slowLoad, latestNewSession]);

    expect(service.getCurrentSessionIdForScope(scope)).toBe('session-new');
  });

  it('waits for an earlier session mutation before starting a chat run', async () => {
    let releaseSlowLoad: (() => void) | undefined;
    agentState.loadGates.set('session-a', new Promise<void>((resolve) => {
      releaseSlowLoad = resolve;
    }));
    agentState.sessions.set('session-a', makeSession('session-a', 'A'));
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const slowLoad = service.loadSessionForScope(scope, 'session-a');
    await vi.waitFor(() => expect(agentState.loadCalls).toEqual(['session-a']));
    const chat = service.chatWithScope(scope, 'follow up');
    await Promise.resolve();
    expect(agentState.chatCalls).toBe(0);

    releaseSlowLoad?.();
    await Promise.all([slowLoad, chat]);
    expect(agentState.chatCalls).toBe(1);
  });

  it('anchors a chat to the renderer-visible session even when the pointer moved first', async () => {
    let releaseSlowLoad: (() => void) | undefined;
    agentState.loadGates.set('session-a', new Promise<void>((resolve) => {
      releaseSlowLoad = resolve;
    }));
    agentState.sessions.set('session-a', makeSession('session-a', 'A'));
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const slowLoad = service.loadSessionForScope(scope, 'session-a');
    await vi.waitFor(() => expect(agentState.loadCalls).toEqual(['session-a']));
    const chat = service.chatWithScope(
      scope,
      'follow up for the session that was on screen',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { expectedConversationSessionId: 'session-current' },
    );
    releaseSlowLoad?.();

    await slowLoad;
    await chat;
    // The run targets session-current (what the renderer showed), not the
    // pointer that an unrelated load moved to session-a.
    expect(agentState.chatCalls).toBe(1);
  });

  it('allows pointer mutations for other sessions while a chat run owns the scope', async () => {
    let releaseChat: (() => void) | undefined;
    agentState.chatGate = new Promise<void>((resolve) => {
      releaseChat = resolve;
    });
    agentState.sessions.set('session-a', makeSession('session-a', 'A'));
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const chat = service.chatWithScope(scope, 'keep this context');
    await vi.waitFor(() => expect(agentState.chatCalls).toBe(1));
    // Loading a different conversation while another one streams is the
    // parallel-conversations feature, not a conflict.
    const load = await service.loadSessionForScope(scope, 'session-a');

    expect(load.ok).toBe(true);
    expect(agentState.loadCalls).toEqual(['session-a']);
    releaseChat?.();
    await chat;
  });

  it('creates a new session while a run streams and lets the run keep writing its archived copy', async () => {
    let releaseChat: (() => void) | undefined;
    agentState.chatGate = new Promise<void>((resolve) => {
      releaseChat = resolve;
    });
    agentState.sessions.set('session-current', makeSession('session-current', ''));
    agentState.sessions.set('session-a', makeSession('session-a', 'A'));
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const chat = service.chatWithScope(
      scope,
      'keep this context',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { expectedConversationSessionId: 'session-current' },
    );
    await vi.waitFor(() => expect(agentState.chatCalls).toBe(1));
    // newSession archives the running session and points at a fresh one; the
    // run (session-anchored) is NOT rejected because it keeps writing to its
    // archived copy.
    const fresh = await service.newSessionForScope(scope);
    // deleteSession of a different (unrunning) session is still allowed.
    const deleted = await service.deleteSessionForScope(scope, 'session-a');

    expect(fresh).toMatchObject({ ok: true, activeSessionId: 'session-new' });
    expect(deleted.ok).toBe(true);
    releaseChat?.();
    await chat;
  });

  it('rejects a second direct chat run for the same scope', async () => {
    let releaseChat: (() => void) | undefined;
    agentState.chatGate = new Promise<void>((resolve) => {
      releaseChat = resolve;
    });
    const service = new CanvasAgentService();
    const scope = { kind: 'scheduled', taskId: 'daily-brief' } as const;

    const first = service.chatWithScope(scope, 'first run');
    await vi.waitFor(() => expect(agentState.chatCalls).toBe(1));
    const second = await service.chatWithScope(scope, 'second run');

    expect(second).toEqual({
      ok: false,
      code: 'CHAT_SCOPE_BUSY',
      error: 'Another reply is already running for this chat scope.',
    });
    expect(agentState.chatCalls).toBe(1);
    releaseChat?.();
    await first;
  });

  it('rejects a chat whose anchored conversation was deleted in flight', async () => {
    agentState.sessions.set('session-current', makeSession('session-current', ''));
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const result = await service.chatWithScope(
      scope,
      'follow up to a deleted thread',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { expectedConversationSessionId: 'session-gone' },
    );

    expect(result).toMatchObject({
      ok: false,
      code: 'CHAT_SESSION_CHANGED',
      activeSessionId: 'session-current',
      error: 'This conversation no longer exists. The latest thread was restored.',
    });
    expect(agentState.chatCalls).toBe(1);
  });

  it('runs two chat turns concurrently for different conversations in one scope', async () => {
    let releaseFirst: (() => void) | undefined;
    let releaseSecond: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const secondGate = new Promise<void>((resolve) => {
      releaseSecond = resolve;
    });
    agentState.chatGate = firstGate;
    agentState.sessions.set('session-a', makeSession('session-a', 'A'));
    agentState.sessions.set('session-b', makeSession('session-b', 'B'));
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const first = service.chatWithScope(
      scope,
      'first run',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { expectedConversationSessionId: 'session-a' },
    );
    await vi.waitFor(() => expect(agentState.chatCalls).toBe(1));
    agentState.chatGate = secondGate;
    const second = service.chatWithScope(
      scope,
      'second run',
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      { expectedConversationSessionId: 'session-b' },
    );
    // Both conversations are in flight at the same time.
    await vi.waitFor(() => expect(agentState.chatCalls).toBe(2));
    releaseFirst?.();
    releaseSecond?.();
    await Promise.all([first, second]);
    expect((await first).ok).toBe(true);
    expect((await second).ok).toBe(true);
  });

  it('acknowledges a cold new session without activating Agent', async () => {
    const sessionRoot = await fs.mkdtemp(join(tmpdir(), 'cold-new-session-'));
    const previousStoreRoot = process.env.PULSE_CANVAS_SESSION_STORE_DIR;
    process.env.PULSE_CANVAS_SESSION_STORE_DIR = sessionRoot;
    const service = new CanvasAgentService();
    const scope = { kind: 'global' } as const;
    const store = new SessionStore('__global_chat__', scope);
    await store.startSession();
    const previousSessionId = store.getCurrentSession()!.sessionId;
    await store.appendToSession(previousSessionId, [
      { role: 'user', content: 'archive before starting a new chat', timestamp: 1 },
    ]);

    try {
      const result = await service.newSessionForScope(scope);

      expect(result).toMatchObject({ ok: true });
      expect(result.activeSessionId).not.toBe(previousSessionId);
      expect(service.getAgentForScope(scope)).toBeUndefined();
      await expect(SessionStore.readCurrentSessionId('__global_chat__'))
        .resolves.toBe(result.activeSessionId);
    } finally {
      if (previousStoreRoot === undefined) delete process.env.PULSE_CANVAS_SESSION_STORE_DIR;
      else process.env.PULSE_CANVAS_SESSION_STORE_DIR = previousStoreRoot;
      await fs.rm(sessionRoot, { recursive: true, force: true });
    }
  });

  it('branches the current conversation and acknowledges both session ids', async () => {
    const source = makeSession('session-current', 'first');
    source.messages.push({
      role: 'assistant',
      content: 'second',
      timestamp: 2,
    });
    agentState.sessions.set(source.sessionId, source);
    agentState.nextSessionId = 'session-branch';
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const result = await service.branchSessionForScope(scope, 1);

    expect(result).toEqual({
      ok: true,
      sourceSessionId: 'session-current',
      activeSessionId: 'session-branch',
      messages: [source.messages[0]],
    });
  });

  it('acknowledges a loaded session with its messages and active session id', async () => {
    const session = makeSession('session-a', 'loaded A');
    agentState.sessions.set(session.sessionId, session);
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const result = await service.loadSessionForScope(scope, session.sessionId);

    expect(result).toEqual({
      ok: true,
      activeSessionId: 'session-a',
      messages: session.messages,
    });
  });

  it('returns a typed not-found failure without changing the active session', async () => {
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const result = await service.loadSessionForScope(scope, 'missing-session');

    expect(result).toEqual({
      ok: false,
      activeSessionId: 'session-current',
      code: 'SESSION_NOT_FOUND',
      error: 'Session not found',
    });
    expect(service.getCurrentSessionIdForScope(scope)).toBe('session-current');
  });

  it('includes the still-active session id when a load fails', async () => {
    agentState.loadErrors.set('session-broken', new Error('archive unreadable'));
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const result = await service.loadSessionForScope(scope, 'session-broken');

    expect(result).toEqual({
      ok: false,
      activeSessionId: 'session-current',
      code: 'SESSION_MUTATION_FAILED',
      error: 'Error: archive unreadable',
    });
  });

  it('renames an existing session and acknowledges the unchanged active session', async () => {
    agentState.sessions.set(
      'session-current',
      makeSession('session-current', 'current'),
    );
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const result = await service.renameSessionForScope(
      scope,
      'session-current',
      'Decision log',
    );

    expect(result).toEqual({
      ok: true,
      activeSessionId: 'session-current',
    });
    expect(agentState.titles.get('session-current')).toBe('Decision log');
  });

  it('pins an existing session and acknowledges the unchanged active session', async () => {
    agentState.sessions.set(
      'session-current',
      makeSession('session-current', 'current'),
    );
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const result = await service.setSessionPinnedForScope(
      scope,
      'session-current',
      true,
    );

    expect(result).toEqual({
      ok: true,
      activeSessionId: 'session-current',
    });
    expect(agentState.pinned.get('session-current')).toBe(true);
  });

  it('deletes the current session and acknowledges the replacement session', async () => {
    agentState.sessions.set(
      'session-current',
      makeSession('session-current', 'delete me'),
    );
    agentState.nextSessionId = 'session-after-delete';
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const result = await service.deleteSessionForScope(scope, 'session-current');

    expect(result).toEqual({
      ok: true,
      deletedCurrent: true,
      activeSessionId: 'session-after-delete',
      messages: [],
    });
  });

  it('returns typed not-found for metadata changes without changing active session', async () => {
    const service = new CanvasAgentService();
    const scope = { kind: 'workspace', workspaceId: 'ws-session-mutation' } as const;

    const result = await service.renameSessionForScope(scope, 'missing', 'Ghost');

    expect(result).toEqual({
      ok: false,
      activeSessionId: 'session-current',
      code: 'SESSION_NOT_FOUND',
      error: 'Session not found',
    });
  });
});
