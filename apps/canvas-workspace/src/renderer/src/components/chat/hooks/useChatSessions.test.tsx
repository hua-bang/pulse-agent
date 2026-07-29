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

  it('drops a superseded load instead of overwriting the newer session', async () => {
    await mount();
    const slowFirst = deferred<ThreadResult>();
    const fastSecond = deferred<ThreadResult>();
    agent.loadSession
      .mockReturnValueOnce(slowFirst.promise)
      .mockReturnValueOnce(fastSecond.promise);

    let first!: Promise<void>;
    let second!: Promise<void>;
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

  it('retires an in-flight load when a new chat is started', async () => {
    await mount();
    const load = deferred<ThreadResult>();
    agent.loadSession.mockReturnValue(load.promise);

    let pending!: Promise<void>;
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
