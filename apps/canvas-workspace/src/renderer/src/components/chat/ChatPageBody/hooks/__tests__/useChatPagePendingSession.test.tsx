// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useChatPagePendingSession } from '../useChatPagePendingSession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useChatPagePendingSession', () => {
  it('re-enters the parent transition when a selected session is retried', async () => {
    const onConsumed = vi.fn();
    const onJumpToSession = vi.fn();
    const retrySession = vi.fn(async () => undefined);
    let retry!: () => Promise<void>;
    const Probe = () => {
      retry = useChatPagePendingSession({
        handleLoadSession: vi.fn(async () => false),
        onJumpToSession,
        onSessionConsumed: onConsumed,
        pendingSessionId: 'session-a',
        pendingSessionIntentId: 7,
        retrySession,
        sessionStoreId: 'workspace-a',
      });
      return null;
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });
    expect(onConsumed).toHaveBeenCalledWith(7, false);

    await act(async () => { await retry(); });
    expect(onJumpToSession).toHaveBeenCalledWith({
      sessionId: 'session-a',
      workspaceId: 'workspace-a',
    });
    expect(retrySession).not.toHaveBeenCalled();
    act(() => root.unmount());
  });

  it('abandons the current surface turn before loading a switched-to session', async () => {
    const onConsumed = vi.fn();
    const onAbandon = vi.fn();
    const handleLoadSession = vi.fn(async () => true);
    const Probe = () => {
      useChatPagePendingSession({
        handleLoadSession,
        onAbandonCurrentTurn: onAbandon,
        onSessionConsumed: onConsumed,
        pendingSessionId: 'session-b',
        pendingSessionIntentId: 11,
        retrySession: vi.fn(async () => undefined),
        sessionStoreId: 'workspace-a',
      });
      return null;
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
    });

    // The lease is dropped (a streaming run keeps going main-side) and the
    // target thread is loaded so the new conversation can send immediately.
    expect(onAbandon).toHaveBeenCalledTimes(1);
    expect(handleLoadSession).toHaveBeenCalledWith('session-b');
    expect(onConsumed).toHaveBeenCalledWith(11, true);
    act(() => root.unmount());
  });

  it('does not restart one pending intent when its load callback changes during a render', async () => {
    let finishLoad!: (loaded: boolean) => void;
    const loadSession = vi.fn((_sessionId: string) => new Promise<boolean>((resolve) => {
      finishLoad = resolve;
    }));
    const onConsumed = vi.fn();
    const Probe = ({ revision }: { revision: number }) => {
      useChatPagePendingSession({
        // Mirrors a parent hook rebuilding its callback after loading state
        // changes. One intent must still own exactly one request.
        handleLoadSession: async (sessionId) => loadSession(sessionId),
        onSessionConsumed: onConsumed,
        pendingSessionId: 'session-b',
        pendingSessionIntentId: 12,
        retrySession: vi.fn(async () => undefined),
        sessionStoreId: 'workspace-a',
      });
      return <span>{revision}</span>;
    };
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => {
      root.render(<Probe revision={0} />);
      await Promise.resolve();
    });
    await act(async () => {
      root.render(<Probe revision={1} />);
      await Promise.resolve();
    });

    expect(loadSession).toHaveBeenCalledTimes(1);

    await act(async () => {
      finishLoad(true);
      await Promise.resolve();
    });
    expect(onConsumed).toHaveBeenCalledOnce();
    expect(onConsumed).toHaveBeenCalledWith(12, true);
    act(() => root.unmount());
  });
});
