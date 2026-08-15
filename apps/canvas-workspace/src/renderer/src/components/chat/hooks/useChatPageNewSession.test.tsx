// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useChatPageNewSession } from './useChatPageNewSession';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useChatPageNewSession', () => {
  it('starts the primary New chat as an unassigned draft even from a workspace', async () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const handleNewSession = vi.fn(async () => ({ ok: true }));
    const onCreateNewSessionInScope = vi.fn(async () => ({
      ok: true as const,
      activeSessionId: 'global-draft',
    }));

    const Harness = () => {
      const newSession = useChatPageNewSession({
        agentScope: { kind: 'workspace', workspaceId: 'workspace-a' },
        sessionStoreId: 'workspace-a',
        loading: false,
        sessionLoading: false,
        busyElsewhere: false,
        pendingSessionId: null,
        focusInput: vi.fn(),
        clearInput: vi.fn(),
        handleNewSession,
        onCreateNewSessionInScope,
      });
      return (
        <button type="button" onClick={(event) => newSession.handleNewSessionFromRail(event.currentTarget)}>
          New chat
        </button>
      );
    };

    await act(async () => root.render(<Harness />));
    await act(async () => {
      host.querySelector('button')?.click();
      await Promise.resolve();
    });

    expect(onCreateNewSessionInScope).toHaveBeenCalledWith({ kind: 'global' });
    expect(handleNewSession).not.toHaveBeenCalled();

    act(() => root.unmount());
    host.remove();
  });
});
