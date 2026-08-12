// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { useChatPageJumpNavigation } from './useChatPageJumpNavigation';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useChatPageJumpNavigation', () => {
  it('routes a same-scope jump through the parent session transition', async () => {
    const handleLoadSession = vi.fn(async () => true);
    const onJumpToSession = vi.fn();
    let jump!: (sessionId: string, scopeId: string) => Promise<void>;
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        agent: {
          getCurrentSession: vi.fn(async () => ({ ok: true, sessionId: 'current' })),
        },
      },
    });
    const Probe = () => {
      jump = useChatPageJumpNavigation({
        agentScope: { kind: 'workspace', workspaceId: 'workspace-a' },
        allWorkspaces: [],
        messages: [],
        scopeId: 'workspace:workspace-a',
        handleLoadSession,
        onJumpToSession,
        onSelectSession: vi.fn(),
      }).onSessionJump;
      return null;
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<Probe />));
    await act(async () => { await jump('target', 'workspace-a'); });

    expect(onJumpToSession).toHaveBeenCalledWith({
      sessionId: 'target',
      scope: { kind: 'workspace', workspaceId: 'workspace-a' },
    });
    expect(handleLoadSession).not.toHaveBeenCalled();
    act(() => root.unmount());
  });
});
