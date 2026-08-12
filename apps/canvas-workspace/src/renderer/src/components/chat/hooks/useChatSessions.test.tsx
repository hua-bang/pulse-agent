// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentChatMessage, AgentSessionInfo } from '../../../types';
import type { AgentScope } from '../types';
import { I18nProvider } from '../../../i18n';
import { resetChatSessionsCacheForTests, useChatSessions } from './useChatSessions';
import { useChatPageSessionRail } from './useChatPageSessionRail';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useChatSessions>;

/** Shared shape of the three IPC calls that replace the message thread. */
type ThreadResult = {
  ok: boolean;
  messages?: AgentChatMessage[];
  activeSessionId?: string | null;
  code?: string;
  error?: string;
};

function makeAgentMocks() {
  return {
    getHistory: vi.fn<[unknown], Promise<ThreadResult>>(async () => ({ ok: true, messages: [] })),
    loadSession: vi.fn<[unknown, string], Promise<ThreadResult>>(async () => ({ ok: true, messages: [] })),
    loadCrossWorkspaceSession: vi.fn<[string, string, string], Promise<ThreadResult>>(
      async () => ({ ok: true, messages: [] }),
    ),
    newSession: vi.fn<[unknown], Promise<{ ok: boolean }>>(async () => ({ ok: true })),
    renameSession: vi.fn(async () => ({ ok: true, activeSessionId: 'session-current' })),
    setSessionPinned: vi.fn(async () => ({ ok: true, activeSessionId: 'session-current' })),
    deleteSession: vi.fn(async () => ({
      ok: true,
      activeSessionId: 'session-next',
      messages: [],
    })),
    listSessions: vi.fn<[], Promise<{ ok: boolean; sessions: AgentSessionInfo[] }>>(
      async () => ({ ok: true, sessions: [] }),
    ),
    listAllSessions: vi.fn(async (): Promise<{ ok: boolean; groups: any[] }> => ({ ok: true, groups: [] })),
  };
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => { resolve = res; });
  return { promise, resolve };
}

function message(content: string): AgentChatMessage {
  return { role: 'user', content, timestamp: 1 };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: Hook | null = null;
let latestRailWorkspaceIds: string[] = [];
let onMessagesLoaded: ReturnType<typeof vi.fn>;
let agent: ReturnType<typeof makeAgentMocks>;

const Probe = ({
  skipInitialHistory,
  agentScope = { kind: 'global' },
}: {
  skipInitialHistory?: boolean;
  agentScope?: AgentScope;
}) => {
  latest = useChatSessions({
    agentScope,
    onMessagesLoaded,
    skipInitialHistory,
  });
  return null;
};

async function mount(skipInitialHistory?: boolean): Promise<void> {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  await act(async () => {
    root?.render(<I18nProvider><Probe skipInitialHistory={skipInitialHistory} /></I18nProvider>);
  });
}

async function rerender(
  skipInitialHistory?: boolean,
  agentScope: AgentScope = { kind: 'global' },
): Promise<void> {
  await act(async () => {
    root?.render(
      <I18nProvider>
        <Probe skipInitialHistory={skipInitialHistory} agentScope={agentScope} />
      </I18nProvider>,
    );
  });
}

beforeEach(() => {
  resetChatSessionsCacheForTests();
  onMessagesLoaded = vi.fn();
  agent = makeAgentMocks();
  (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = { agent };
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
  latestRailWorkspaceIds = [];
  vi.restoreAllMocks();
});

describe('useChatSessions — session detail loading', () => {
  it('imports a global session into a workspace through the storage adapter boundary', async () => {
    await mount(true);
    await rerender(true, { kind: 'workspace', workspaceId: 'workspace-a' });

    await act(async () => {
      await latest!.handleLoadSession('global-session', { kind: 'global' });
    });

    expect(agent.loadCrossWorkspaceSession).toHaveBeenCalledWith(
      'workspace-a',
      '__global_chat__',
      'global-session',
    );
    expect(agent.loadSession).not.toHaveBeenCalled();
  });

  it('keeps the unified rail grouped by its committed scopes during a cross-scope thread load', async () => {
    const workspace = { id: 'workspace-a', name: 'Workspace A' };
    const thread = deferred<ThreadResult>();
    agent.listSessions.mockResolvedValue({
      ok: true,
      sessions: [{
        sessionId: 'global-session',
        date: '2026-08-08',
        messageCount: 1,
        preview: 'Global session',
        isCurrent: true,
      }],
    });
    agent.listAllSessions.mockResolvedValue({
      ok: true,
      groups: [
        {
          scope: { kind: 'global' },
          scopeName: 'Global Chat',
          sessions: [{
            sessionId: 'global-session',
            date: '2026-08-08',
            messageCount: 1,
            preview: 'Global session',
            isCurrent: true,
          }],
        },
        {
          scope: { kind: 'workspace', workspaceId: workspace.id },
          scopeName: workspace.name,
          sessions: [{
            sessionId: 'workspace-session',
            date: '2026-08-07',
            messageCount: 1,
            preview: 'Workspace session',
            isCurrent: false,
          }],
        },
      ],
    });
    agent.loadSession.mockReturnValue(thread.promise);
    const workspaces = [workspace];
    const focusInput = vi.fn();
    const onSelectSession = vi.fn();

    const RailProbe = ({ scope, pending }: { scope: AgentScope; pending: boolean }) => {
      const state = useChatSessions({
        agentScope: scope,
        allWorkspaces: workspaces,
        onMessagesLoaded,
        eagerLoad: true,
        skipInitialHistory: pending,
      });
      latest = state;
      const rail = useChatPageSessionRail({
        agentScope: scope,
        allWorkspaces: workspaces,
        currentScopeName: state.currentScopeName,
        sessionsLoading: state.sessionsLoading,
        otherSessions: state.otherSessions,
        selectedSessionKey: pending ? `workspace:${workspace.id}:workspace-session` : 'global:global-session',
        sessions: state.sessions,
        sessionsScope: state.sessionsScope,
        disabled: false,
        focusInput,
        handleNewSession: state.handleNewSession,
        onSelectSession,
        renameSession: state.renameSession,
        deleteSession: state.deleteSession,
        toggleSessionPinned: state.toggleSessionPinned,
      });
      latestRailWorkspaceIds = [...new Set(rail.allSessions.map((session) => (
        session.scope.kind === 'workspace' ? session.scope.workspaceId : session.scope.kind
      )))];
      return null;
    };

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <I18nProvider>
          <RailProbe scope={{ kind: 'global' }} pending={false} />
        </I18nProvider>,
      );
    });
    expect(latestRailWorkspaceIds.sort()).toEqual(['global', workspace.id].sort());

    await act(async () => {
      root?.render(
        <I18nProvider>
          <RailProbe scope={{ kind: 'workspace', workspaceId: workspace.id }} pending />
        </I18nProvider>,
      );
    });
    act(() => { void latest!.handleLoadSession('workspace-session'); });

    expect(latestRailWorkspaceIds.sort()).toEqual(['global', workspace.id].sort());

    await act(async () => {
      thread.resolve({
        ok: true,
        activeSessionId: 'workspace-session',
        messages: [message('workspace thread')],
      });
      await thread.promise;
    });
  });
  it('is loading from the first paint until the mount history fetch settles', async () => {
    const history = deferred<ThreadResult>();
    agent.getHistory.mockReturnValue(history.promise);

    await mount();
    // Seeded true rather than flipped by the effect: the effect runs after
    // the first paint, so a false seed would flash the empty state.
    expect(latest?.sessionLoading).toBe(true);

    await act(async () => {
      history.resolve({ ok: true, messages: [message('hello')] });
      await history.promise;
    });

    expect(latest?.sessionLoading).toBe(false);
    expect(onMessagesLoaded).toHaveBeenCalledWith([message('hello')]);
  });

  it('stays loading when the caller owns the first fetch (skipInitialHistory)', async () => {
    await mount(true);

    expect(agent.getHistory).not.toHaveBeenCalled();
    // No empty-state gap between mount and the caller's handleLoadSession.
    expect(latest?.sessionLoading).toBe(true);
  });

  it('does not refetch history when an explicit session load clears its pending flag', async () => {
    await mount(true);
    await act(async () => {
      await latest!.handleLoadSession('session-a');
    });

    await rerender(false);

    expect(agent.getHistory).not.toHaveBeenCalled();
    expect(agent.loadSession).toHaveBeenCalledTimes(1);
    expect(latest?.sessionLoading).toBe(false);
  });

  it('covers an explicit session load and clears when it settles', async () => {
    await mount();
    const load = deferred<ThreadResult>();
    agent.loadSession.mockReturnValue(load.promise);

    let pending!: Promise<boolean | undefined>;
    await act(async () => { pending = latest!.handleLoadSession('session-a'); });
    expect(latest?.sessionLoading).toBe(true);

    await act(async () => {
      load.resolve({
        ok: true,
        activeSessionId: 'session-a',
        messages: [message('session a')],
      });
      await pending;
    });

    expect(latest?.sessionLoading).toBe(false);
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([message('session a')]);
  });

  it('keeps the current thread and exposes a typed error when a session no longer exists', async () => {
    await mount();
    agent.loadSession.mockResolvedValue({
      ok: false,
      code: 'SESSION_NOT_FOUND',
      error: 'Session not found',
      activeSessionId: 'session-current',
    });
    onMessagesLoaded.mockClear();

    await act(async () => {
      await latest!.handleLoadSession('missing-session');
    });

    expect(onMessagesLoaded).not.toHaveBeenCalled();
    expect(latest?.sessionError).toEqual({
      code: 'SESSION_NOT_FOUND',
      message: 'Session not found',
    });
    expect(latest?.activeSessionId).toBe('session-current');
  });

  it('clears the previous transcript before a cross-scope load can fail', async () => {
    agent.getHistory.mockResolvedValue({
      ok: true,
      activeSessionId: 'global-current',
      messages: [message('global transcript')],
    });
    await mount();
    onMessagesLoaded.mockClear();

    await rerender(true, { kind: 'workspace', workspaceId: 'workspace-b' });
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([]);

    agent.loadSession.mockResolvedValue({
      ok: false,
      code: 'SESSION_NOT_FOUND',
      error: 'Session not found',
    });
    let loaded: boolean | undefined;
    await act(async () => {
      loaded = await latest!.handleLoadSession('missing-session');
    });

    expect(loaded).toBe(false);
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([]);
    expect(latest?.sessionError?.code).toBe('SESSION_NOT_FOUND');
  });

  it('drops old-scope history that resolves during a scope transition', async () => {
    const oldHistory = deferred<ThreadResult>();
    const nextHistory = deferred<ThreadResult>();
    agent.getHistory
      .mockReturnValueOnce(oldHistory.promise)
      .mockReturnValueOnce(nextHistory.promise);
    await mount();

    onMessagesLoaded.mockClear();
    await rerender(false, { kind: 'workspace', workspaceId: 'workspace-b' });
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([]);

    await act(async () => {
      oldHistory.resolve({
        ok: true,
        activeSessionId: 'global-current',
        messages: [message('stale global transcript')],
      });
      await oldHistory.promise;
    });
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([]);

    await act(async () => {
      nextHistory.resolve({
        ok: true,
        activeSessionId: 'workspace-current',
        messages: [message('workspace transcript')],
      });
      await nextHistory.promise;
    });
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([message('workspace transcript')]);
  });

  it('retries the latest thread intent after a recoverable history failure', async () => {
    agent.getHistory.mockResolvedValueOnce({
      ok: false,
      code: 'SESSION_LOAD_FAILED',
      error: 'Storage temporarily unavailable',
    });
    await mount();

    expect(latest?.sessionError?.message).toBe('Storage temporarily unavailable');
    agent.getHistory.mockResolvedValueOnce({
      ok: true,
      activeSessionId: 'session-current',
      messages: [message('recovered')],
    });

    await act(async () => {
      await latest!.retrySession();
    });

    expect(agent.getHistory).toHaveBeenCalledTimes(2);
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([message('recovered')]);
    expect(latest?.sessionError).toBeNull();
  });

  it('persists rail metadata mutations and refreshes the session list', async () => {
    await mount();

    await act(async () => {
      await latest!.renameSession('session-a', 'Decision log');
      await latest!.toggleSessionPinned('session-a', true);
    });

    expect(agent.renameSession).toHaveBeenCalledWith(
      { scope: { kind: 'global' } },
      'session-a',
      'Decision log',
    );
    expect(agent.setSessionPinned).toHaveBeenCalledWith(
      { scope: { kind: 'global' } },
      'session-a',
      true,
    );
    expect(agent.listSessions).toHaveBeenCalledTimes(2);
  });

  it('uses the all-sessions response as the single list source for the full-page rail', async () => {
    const workspaces = [{ id: 'workspace-a', name: 'Workspace A' }];
    const scope = { kind: 'global' } as const;
    agent.listAllSessions.mockResolvedValue({
      ok: true,
      groups: [
        {
          scope: { kind: 'global' },
          scopeName: 'Global Chat',
          sessions: [{
            sessionId: 'global-current',
            date: '2026-08-08',
            messageCount: 1,
            preview: 'Global current',
            isCurrent: true,
          }],
        },
        {
          scope: { kind: 'workspace', workspaceId: 'workspace-a' },
          scopeName: 'Workspace A',
          sessions: [{
            sessionId: 'workspace-session',
            date: '2026-08-07',
            messageCount: 1,
            preview: 'Workspace session',
            isCurrent: false,
          }],
        },
      ],
    });

    const FullPageProbe = () => {
      latest = useChatSessions({
        agentScope: scope,
        allWorkspaces: workspaces,
        onMessagesLoaded,
        eagerLoad: true,
      });
      return null;
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<I18nProvider><FullPageProbe /></I18nProvider>);
    });

    expect(agent.listAllSessions).toHaveBeenCalledTimes(1);
    expect(agent.listSessions).not.toHaveBeenCalled();
    expect(latest?.sessions.map((session) => session.sessionId)).toEqual(['global-current']);
    expect(latest?.otherSessions.map((session) => session.sessionId)).toEqual(['workspace-session']);
  });

  it('adopts the replacement thread after deleting the active session', async () => {
    await mount();
    onMessagesLoaded.mockClear();
    agent.listSessions.mockResolvedValue({
      ok: true,
      sessions: [{
        sessionId: 'session-next',
        date: '2026-07-31',
        messageCount: 0,
        isCurrent: true,
      }],
    });

    await act(async () => {
      await latest!.deleteSession('session-current');
    });

    expect(agent.deleteSession).toHaveBeenCalledWith(
      { scope: { kind: 'global' } },
      'session-current',
    );
    expect(latest?.activeSessionId).toBe('session-next');
    expect(onMessagesLoaded).toHaveBeenCalledWith([]);
  });

  it('rejects a load whose active-session acknowledgement does not match the intent', async () => {
    await mount();
    agent.loadSession.mockResolvedValue({
      ok: true,
      activeSessionId: 'session-a',
      messages: [message('wrong thread')],
    });
    onMessagesLoaded.mockClear();

    await act(async () => {
      await latest!.handleLoadSession('session-b');
    });

    expect(onMessagesLoaded).not.toHaveBeenCalled();
    expect(latest?.sessionError).toEqual({
      code: 'SESSION_ACK_MISMATCH',
      message: 'The requested conversation did not become active.',
    });
  });

  it('drops a superseded load instead of overwriting the newer session', async () => {
    await mount();
    const slowFirst = deferred<ThreadResult>();
    const fastSecond = deferred<ThreadResult>();
    agent.loadSession
      .mockReturnValueOnce(slowFirst.promise)
      .mockReturnValueOnce(fastSecond.promise);

    let first!: Promise<boolean | undefined>;
    let second!: Promise<boolean | undefined>;
    await act(async () => { first = latest!.handleLoadSession('session-a'); });
    await act(async () => { second = latest!.handleLoadSession('session-b'); });

    await act(async () => {
      fastSecond.resolve({ ok: true, messages: [message('session b')] });
      await second;
    });
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([message('session b')]);
    expect(latest?.sessionLoading).toBe(false);

    // The first pick lands late — it must neither repaint the thread nor
    // re-open the loading state over the session now on screen.
    await act(async () => {
      slowFirst.resolve({ ok: true, messages: [message('session a')] });
      await first;
    });

    expect(onMessagesLoaded).toHaveBeenLastCalledWith([message('session b')]);
    expect(latest?.sessionLoading).toBe(false);
  });

  it('invalidates an older session-list response when the thread pointer moves', async () => {
    await mount();
    const staleList = deferred<{ ok: boolean; sessions: AgentSessionInfo[] }>();
    agent.listSessions.mockReturnValue(staleList.promise);
    let pendingList!: Promise<void>;
    act(() => { pendingList = latest!.loadSessions(); });
    expect(latest?.sessionsLoading).toBe(true);

    agent.loadSession.mockResolvedValue({
      ok: true,
      activeSessionId: 'session-newer',
      messages: [message('newer thread')],
    });
    await act(async () => {
      await latest!.handleLoadSession('session-newer');
    });
    expect(latest?.activeSessionId).toBe('session-newer');
    expect(latest?.sessionsLoading).toBe(false);

    await act(async () => {
      staleList.resolve({
        ok: true,
        sessions: [{
          sessionId: 'session-stale',
          date: '2026-07-30',
          messageCount: 1,
          isCurrent: true,
        }],
      });
      await pendingList;
    });

    expect(latest?.activeSessionId).toBe('session-newer');
    expect(latest?.sessions).toEqual([]);
  });

  it('retires an in-flight load when a new chat is started', async () => {
    await mount();
    const load = deferred<ThreadResult>();
    agent.loadSession.mockReturnValue(load.promise);

    let pending!: Promise<boolean | undefined>;
    await act(async () => { pending = latest!.handleLoadSession('session-a'); });
    await act(async () => { await latest!.handleNewSession(); });

    // A blank new chat is not "loading", and the abandoned session's
    // messages must not land in it.
    expect(latest?.sessionLoading).toBe(false);
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([]);

    await act(async () => {
      load.resolve({ ok: true, messages: [message('session a')] });
      await pending;
    });

    expect(onMessagesLoaded).toHaveBeenLastCalledWith([]);
    expect(latest?.sessionLoading).toBe(false);
  });

  it('blocks the thread until main acknowledges a new conversation', async () => {
    await mount();
    const transition = deferred<{ ok: boolean; activeSessionId?: string }>();
    agent.newSession.mockReturnValue(transition.promise);
    onMessagesLoaded.mockClear();

    let pending!: Promise<{ ok: boolean }>;
    await act(async () => {
      pending = latest!.handleNewSession();
    });

    expect(latest?.sessionLoading).toBe(true);
    expect(onMessagesLoaded).not.toHaveBeenCalled();

    await act(async () => {
      transition.resolve({ ok: true, activeSessionId: 'session-new' });
      await pending;
    });

    expect(latest?.sessionLoading).toBe(false);
    expect(latest?.activeSessionId).toBe('session-new');
    expect(onMessagesLoaded).toHaveBeenCalledWith([]);
  });

  it('commits the unified current and cross-workspace session response atomically', async () => {
    const allList = deferred<any>();
    const listWorkspaces = [{ id: 'workspace-a', name: 'Workspace A' }];
    const listScope = { kind: 'global' } as const;
    agent.listAllSessions.mockReturnValue(allList.promise);
    const ListProbe = () => {
      latest = useChatSessions({
        agentScope: listScope,
        allWorkspaces: listWorkspaces,
        onMessagesLoaded,
        eagerLoad: true,
      });
      return null;
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<I18nProvider><ListProbe /></I18nProvider>);
    });

    await Promise.resolve();
    expect(latest?.sessions).toEqual([]);
    expect(latest?.otherSessions).toEqual([]);

    await act(async () => {
      allList.resolve({
        ok: true,
        groups: [
          {
            scope: { kind: 'global' },
            scopeName: 'Global Chat',
            sessions: [{
              sessionId: 'global-a',
              date: '2026-07-29',
              messageCount: 1,
              preview: 'Global A',
              isCurrent: true,
            }],
          },
          {
            scope: { kind: 'workspace', workspaceId: 'workspace-a' },
            scopeName: 'Workspace A',
            sessions: [{
              sessionId: 'workspace-a-1',
              date: '2026-07-29',
              messageCount: 1,
              preview: 'Workspace A session',
            }],
          },
        ],
      });
      await allList.promise;
    });

    expect(latest?.sessions).toHaveLength(1);
    expect(latest?.otherSessions).toHaveLength(1);
    expect(latest?.sessionsLoading).toBe(false);
  });
});
