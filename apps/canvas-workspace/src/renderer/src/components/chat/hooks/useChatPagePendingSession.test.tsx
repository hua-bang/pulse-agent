// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useChatPagePendingSession } from './useChatPagePendingSession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useChatPagePendingSession', () => {
  it('re-enters the parent transition when a selected session is retried', async () => {
    const onConsumed = vi.fn();
    const onJumpToSession = vi.fn();
    const retrySession = vi.fn(async () => undefined);
    let retry!: () => Promise<void>;
    const Probe = () => {
      retry = useChatPagePendingSession({
        busyElsewhere: false,
        handleLoadSession: vi.fn(async () => false),
        onJumpToSession,
        onSessionConsumed: onConsumed,
        pendingSessionId: 'session-a',
        pendingSessionIntentId: 7,
        retrySession,
        sessionScope: { kind: 'workspace', workspaceId: 'workspace-a' },
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
      scope: { kind: 'workspace', workspaceId: 'workspace-a' },
    });
    expect(retrySession).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
