// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useScopeRunningSessions } from './useScopeRunningSessions';
import { conversationKey } from '../../../../../shared/conversation-runtime';
import {
  resetConversationStoreForTests,
  setConversationLoading,
  setConversationMessages,
} from '../runtime/conversationStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: Set<string> = new Set();

const Probe = ({ scope, scopeKey }: { scope: unknown; scopeKey: string }) => {
  latest = useScopeRunningSessions(scope as never, scopeKey, 50);
  return null;
};

beforeEach(() => {
  resetConversationStoreForTests();
  (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
    agent: {
      getScopeRunningSessions: vi.fn(async () => ({ ok: true, conversationSessionIds: [] })),
    },
  };
});

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  vi.restoreAllMocks();
  resetConversationStoreForTests();
});

describe('useScopeRunningSessions', () => {
  it('reports a locally running conversation before the main polling round-trip', async () => {
    const key = conversationKey({ kind: 'workspace', workspaceId: 'ws' }, 'conv-local');
    setConversationMessages(key, [{ role: 'user', content: 'hello', timestamp: 1 }]);
    setConversationLoading(key, true);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe scope={{ kind: 'workspace', workspaceId: 'ws' }} scopeKey="ws" />);
    });

    expect(latest).toEqual(new Set(['conv-local']));
    act(() => root?.unmount());
  });

  it('does not relight a locally completed run from a stale in-flight poll', async () => {
    const scope = { kind: 'workspace' as const, workspaceId: 'ws' };
    const key = conversationKey(scope, 'conv-local');
    setConversationMessages(key, [{ role: 'user', content: 'hello', timestamp: 1 }]);
    setConversationLoading(key, true);
    let resolvePoll!: (result: { ok: true; conversationSessionIds: string[] }) => void;
    vi.spyOn(window.canvasWorkspace.agent, 'getScopeRunningSessions').mockImplementation(
      () => new Promise(resolve => {
        resolvePoll = resolve;
      }),
    );
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe scope={scope} scopeKey="ws" />);
    });
    expect(latest).toEqual(new Set(['conv-local']));

    act(() => setConversationLoading(key, false));
    expect(latest.size).toBe(0);

    await act(async () => {
      resolvePoll({ ok: true, conversationSessionIds: ['conv-local'] });
      await Promise.resolve();
    });
    expect(latest.size).toBe(0);
  });

  it('does not relight a run that starts and completes during an in-flight poll', async () => {
    const scope = { kind: 'workspace' as const, workspaceId: 'ws' };
    const key = conversationKey(scope, 'conv-local');
    setConversationMessages(key, [{ role: 'user', content: 'previous', timestamp: 1 }]);
    let resolvePoll!: (result: { ok: true; conversationSessionIds: string[] }) => void;
    vi.spyOn(window.canvasWorkspace.agent, 'getScopeRunningSessions').mockImplementation(
      () => new Promise(resolve => {
        resolvePoll = resolve;
      }),
    );
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe scope={scope} scopeKey="ws" />);
    });
    expect(latest.size).toBe(0);

    act(() => setConversationLoading(key, true));
    expect(latest).toEqual(new Set(['conv-local']));
    act(() => setConversationLoading(key, false));
    expect(latest.size).toBe(0);

    await act(async () => {
      resolvePoll({ ok: true, conversationSessionIds: ['conv-local'] });
      await Promise.resolve();
    });
    expect(latest.size).toBe(0);
  });

  it('shows a new remote run even when an idle local snapshot already exists', async () => {
    const scope = { kind: 'workspace' as const, workspaceId: 'ws' };
    const key = conversationKey(scope, 'conv-remote');
    setConversationMessages(key, [{ role: 'user', content: 'previous', timestamp: 1 }]);
    vi.spyOn(window.canvasWorkspace.agent, 'getScopeRunningSessions').mockResolvedValue({
      ok: true,
      conversationSessionIds: ['conv-remote'],
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe scope={scope} scopeKey="ws" />);
      await Promise.resolve();
    });

    expect(latest).toEqual(new Set(['conv-remote']));
  });

  it('reports the conversation session ids with an active run', async () => {
    const spy = vi
      .spyOn(window.canvasWorkspace.agent, 'getScopeRunningSessions')
      .mockResolvedValue({ ok: true, conversationSessionIds: ['conv-a', 'conv-b'] });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe scope={{ kind: 'workspace', workspaceId: 'ws' }} scopeKey="ws" />);
      await new Promise(resolve => setTimeout(resolve, 60));
    });

    expect(spy).toHaveBeenCalled();
    expect(latest).toEqual(new Set(['conv-a', 'conv-b']));
    act(() => root?.unmount());
  });

  it('empties the set when a run completes', async () => {
    const spy = vi
      .spyOn(window.canvasWorkspace.agent, 'getScopeRunningSessions')
      .mockResolvedValue({ ok: true, conversationSessionIds: ['conv-a'] });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(<Probe scope={{ kind: 'workspace', workspaceId: 'ws' }} scopeKey="ws" />);
      await new Promise(resolve => setTimeout(resolve, 60));
    });
    expect(latest).toEqual(new Set(['conv-a']));

    spy.mockResolvedValue({ ok: true, conversationSessionIds: [] });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 60));
    });
    expect(latest.size).toBe(0);
    act(() => root?.unmount());
  });
});
