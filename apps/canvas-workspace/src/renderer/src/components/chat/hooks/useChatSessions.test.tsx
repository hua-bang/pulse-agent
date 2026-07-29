// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentChatMessage } from '../../../types';
import { useChatSessions } from './useChatSessions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type Hook = ReturnType<typeof useChatSessions>;

/** Shared shape of the three IPC calls that replace the message thread. */
type ThreadResult = { ok: boolean; messages?: AgentChatMessage[] };

function makeAgentMocks() {
  return {
    getHistory: vi.fn<[unknown], Promise<ThreadResult>>(async () => ({ ok: true, messages: [] })),
    loadSession: vi.fn<[unknown, string], Promise<ThreadResult>>(async () => ({ ok: true, messages: [] })),
    loadCrossWorkspaceSession: vi.fn<[string, string, string], Promise<ThreadResult>>(
      async () => ({ ok: true, messages: [] }),
    ),
    newSession: vi.fn<[unknown], Promise<{ ok: boolean }>>(async () => ({ ok: true })),
    listSessions: vi.fn(async () => ({ ok: true, sessions: [] })),
    listAllSessions: vi.fn(async () => ({ ok: true, groups: [] })),
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
let onMessagesLoaded: ReturnType<typeof vi.fn>;
let agent: ReturnType<typeof makeAgentMocks>;

const Probe = ({ skipInitialHistory }: { skipInitialHistory?: boolean }) => {
  latest = useChatSessions({
    agentScope: { kind: 'global' },
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
    root?.render(<Probe skipInitialHistory={skipInitialHistory} />);
  });
}

async function rerender(skipInitialHistory?: boolean): Promise<void> {
  await act(async () => {
    root?.render(<Probe skipInitialHistory={skipInitialHistory} />);
  });
}

beforeEach(() => {
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
  vi.restoreAllMocks();
});

describe('useChatSessions — session detail loading', () => {
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

    let pending!: Promise<void>;
    await act(async () => { pending = latest!.handleLoadSession('session-a'); });
    expect(latest?.sessionLoading).toBe(true);

    await act(async () => {
      load.resolve({ ok: true, messages: [message('session a')] });
      await pending;
    });

    expect(latest?.sessionLoading).toBe(false);
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([message('session a')]);
  });

  it('defers a second switch instead of overlapping or dropping it', async () => {
    await mount();
    const first = deferred<ThreadResult>();
    agent.loadSession.mockReturnValueOnce(first.promise);

    let pendingA!: Promise<void>;
    let pendingB!: Promise<void>;
    await act(async () => { pendingA = latest!.handleLoadSession('session-a'); });
    await act(async () => { pendingB = latest!.handleLoadSession('session-b'); });

    // loadSession archives the current session and promotes the requested one
    // main-side, so overlapping calls leave the agent pointing at whichever
    // finished last while the renderer paints whichever was clicked last.
    // Only ONE switch may be in flight, or the two can disagree.
    expect(agent.loadSession).toHaveBeenCalledTimes(1);

    agent.loadSession.mockResolvedValueOnce({ ok: true, messages: [message('session b')] });
    await act(async () => {
      first.resolve({ ok: true, messages: [message('session a')] });
      await pendingA;
      await pendingB;
    });

    // ...but the pick is DEFERRED, never dropped. Dropping it would strand the
    // rail on the session the user chose while the thread and the main-side
    // pointer stayed on the previous one.
    expect(agent.loadSession).toHaveBeenCalledTimes(2);
    expect(agent.loadSession).toHaveBeenLastCalledWith(expect.anything(), 'session-b');
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([message('session b')]);
    expect(latest?.sessionLoading).toBe(false);
  });

  it('runs only the newest of several switches queued behind one in flight', async () => {
    await mount();
    const first = deferred<ThreadResult>();
    agent.loadSession.mockReturnValueOnce(first.promise);

    const pending: Promise<void>[] = [];
    await act(async () => { pending.push(latest!.handleLoadSession('session-a')); });
    await act(async () => {
      pending.push(latest!.handleLoadSession('session-b'));
      pending.push(latest!.handleLoadSession('session-c'));
    });

    agent.loadSession.mockResolvedValueOnce({ ok: true, messages: [message('session c')] });
    await act(async () => {
      first.resolve({ ok: true, messages: [message('session a')] });
      await Promise.all(pending);
    });

    // 'session-b' was superseded before it ever started: promoting it would
    // point main-side at a conversation the user has already navigated past.
    expect(agent.loadSession).toHaveBeenCalledTimes(2);
    expect(agent.loadSession).toHaveBeenLastCalledWith(expect.anything(), 'session-c');
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([message('session c')]);
  });

  it('defers a new chat behind an in-flight switch', async () => {
    await mount();
    const first = deferred<ThreadResult>();
    agent.loadSession.mockReturnValueOnce(first.promise);

    let pending!: Promise<void>;
    let result: { ok: boolean } | undefined;
    let pendingNew!: Promise<{ ok: boolean }>;
    await act(async () => { pending = latest!.handleLoadSession('session-a'); });
    await act(async () => { pendingNew = latest!.handleNewSession(); });

    // newSession promotes a session too — same divergence, same rule.
    expect(agent.newSession).not.toHaveBeenCalled();

    await act(async () => {
      first.resolve({ ok: true, messages: [message('session a')] });
      await pending;
      result = await pendingNew;
    });

    expect(agent.newSession).toHaveBeenCalledTimes(1);
    expect(result?.ok).toBe(true);
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([]);
    expect(latest?.sessionLoading).toBe(false);
  });

  it('drops a superseded history fetch instead of overwriting the picked session', async () => {
    // The one overlap still allowed: getHistory only activates and reads (it
    // never promotes a session), so a pick may overlap the mount fetch. The
    // token is what decides who paints.
    const slowHistory = deferred<ThreadResult>();
    agent.getHistory.mockReturnValue(slowHistory.promise);
    await mount();

    const pick = deferred<ThreadResult>();
    agent.loadSession.mockReturnValue(pick.promise);

    let pending!: Promise<void>;
    await act(async () => { pending = latest!.handleLoadSession('session-b'); });
    await act(async () => {
      pick.resolve({ ok: true, messages: [message('session b')] });
      await pending;
    });
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([message('session b')]);

    // The mount fetch lands late — it must neither repaint the thread nor
    // re-open the loading state over the session now on screen.
    await act(async () => {
      slowHistory.resolve({ ok: true, messages: [message('stale history')] });
      await slowHistory.promise;
    });

    expect(onMessagesLoaded).toHaveBeenLastCalledWith([message('session b')]);
    expect(latest?.sessionLoading).toBe(false);
  });

  it('retires an in-flight history fetch when a new chat is started', async () => {
    // A new chat during the mount fetch IS allowed (getHistory promotes
    // nothing), so the token has to retire it — otherwise the old session's
    // messages land in the blank chat the user is now looking at.
    const slowHistory = deferred<ThreadResult>();
    agent.getHistory.mockReturnValue(slowHistory.promise);
    await mount();

    await act(async () => { await latest!.handleNewSession(); });

    expect(agent.newSession).toHaveBeenCalledTimes(1);
    expect(latest?.sessionLoading).toBe(false);
    expect(onMessagesLoaded).toHaveBeenLastCalledWith([]);

    await act(async () => {
      slowHistory.resolve({ ok: true, messages: [message('previous session')] });
      await slowHistory.promise;
    });

    expect(onMessagesLoaded).toHaveBeenLastCalledWith([]);
    expect(latest?.sessionLoading).toBe(false);
  });

  it('commits the current and cross-workspace session lists atomically', async () => {
    const currentList = deferred<any>();
    const allList = deferred<any>();
    const listWorkspaces = [{ id: 'workspace-a', name: 'Workspace A' }];
    const listScope = { kind: 'global' } as const;
    agent.listSessions.mockReturnValue(currentList.promise);
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
      root?.render(<ListProbe />);
    });

    currentList.resolve({
      ok: true,
      sessions: [{
        sessionId: 'global-a',
        date: '2026-07-29',
        messageCount: 1,
        preview: 'Global A',
        isCurrent: true,
      }],
    });
    await Promise.resolve();
    expect(latest?.sessions).toEqual([]);
    expect(latest?.otherSessions).toEqual([]);

    await act(async () => {
      allList.resolve({
        ok: true,
        groups: [{
          workspaceId: 'workspace-a',
          workspaceName: 'Workspace A',
          sessions: [{
            sessionId: 'workspace-a-1',
            date: '2026-07-29',
            messageCount: 1,
            preview: 'Workspace A session',
          }],
        }],
      });
      await Promise.all([currentList.promise, allList.promise]);
    });

    expect(latest?.sessions).toHaveLength(1);
    expect(latest?.otherSessions).toHaveLength(1);
    expect(latest?.sessionsLoading).toBe(false);
  });
});
