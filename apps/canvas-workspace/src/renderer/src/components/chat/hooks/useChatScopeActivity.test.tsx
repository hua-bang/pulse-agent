// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentScope } from '../types';
import { useChatScopeActivity } from './useChatScopeActivity';
import { resetChatScopeActivityForTests } from './chatScopeActivityStore';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const scope = { kind: 'workspace', workspaceId: 'parallel-workspace' } as const;

function mockScopeRunStatus(active: boolean, conversationSessionId?: string) {
  return vi.spyOn(window.canvasWorkspace.agent, 'getScopeRunStatus').mockResolvedValue({
    ok: true,
    active,
    sessionId: active ? 'run-1' : undefined,
    conversationSessionId,
  });
}

function mount(getConversationSessionId: () => string | null | undefined) {
  const result = {
    busyElsewhere: false as boolean,
    claimScope: (() => false) as () => boolean,
    onRemoteRunState: vi.fn(),
    onExternalRunComplete: vi.fn(),
  };
  const Probe = () => {
    const hook = useChatScopeActivity({
      scope,
      scopeKey: 'workspace:parallel-workspace',
      getConversationSessionId,
      onExternalRunComplete: result.onExternalRunComplete,
      onRemoteRunState: result.onRemoteRunState,
    });
    result.busyElsewhere = hook.busyElsewhere;
    result.claimScope = hook.claimScope;
    return null;
  };
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => root?.render(<Probe />));
  return result;
}

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  resetChatScopeActivityForTests();
  vi.restoreAllMocks();
  delete (window as unknown as { canvasWorkspace?: unknown }).canvasWorkspace;
});

beforeEach(() => {
  (window as unknown as { canvasWorkspace: unknown }).canvasWorkspace = {
    agent: {
      getScopeRunStatus: vi.fn(),
      getHistory: vi.fn(async () => ({ ok: true, messages: [] })),
    },
  };
});

describe('useChatScopeActivity per-session busy', () => {
  it('stays not-busy when a DIFFERENT conversation in the same workspace streams', async () => {
    mockScopeRunStatus(true, 'conversation-a');
    const result = mount(() => 'conversation-b');

    // Allow the poll interval (400ms when active) to fire.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(result.busyElsewhere).toBe(false);
    expect(result.onRemoteRunState).not.toHaveBeenCalled();
  });

  it('reports busy when the CURRENT conversation streams elsewhere', async () => {
    mockScopeRunStatus(true, 'conversation-a');
    const result = mount(() => 'conversation-a');

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(result.busyElsewhere).toBe(true);
    expect(result.onRemoteRunState).toHaveBeenCalledWith(expect.objectContaining({
      active: true,
      conversationSessionId: 'conversation-a',
    }));
  });

  it('treats a legacy conversation-less run as busy for the current session', async () => {
    mockScopeRunStatus(true, undefined);
    const result = mount(() => 'conversation-b');

    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });

    expect(result.busyElsewhere).toBe(true);
  });

  it('clears busy once the run completes', async () => {
    const status = mockScopeRunStatus(true, 'conversation-a');
    const result = mount(() => 'conversation-a');
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(result.busyElsewhere).toBe(true);

    status.mockResolvedValue({
      ok: true,
      active: false,
      conversationSessionId: undefined,
    });
    // The next poll is scheduled 400ms out (the run was active); wait past it.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 450));
    });

    expect(result.busyElsewhere).toBe(false);
    expect(result.onRemoteRunState).toHaveBeenCalledWith({ active: false });
    expect(result.onExternalRunComplete).toHaveBeenCalledWith([]);
  });

  it('does not report a false completion while the run is still active', async () => {
    const status = mockScopeRunStatus(true, 'conversation-a');
    const result = mount(() => 'conversation-a');
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(result.busyElsewhere).toBe(true);
    result.onRemoteRunState.mockClear();

    // The run stays active across several polls. It must NOT report
    // active:false while result.active is still true — a premature false
    // would detach the re-attached stream on switch-back.
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 900));
    });

    expect(result.onRemoteRunState).not.toHaveBeenCalledWith({ active: false });
    // Still busy (this unit does not re-claim; the switch-back claim lives in
    // useChatStream.handleRemoteRunState).
    expect(result.busyElsewhere).toBe(true);
  });

  it('does not replace replayed messages when this surface reclaims a still-active run', async () => {
    mockScopeRunStatus(true, 'conversation-a');
    const result = mount(() => 'conversation-a');
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 50));
    });
    expect(result.busyElsewhere).toBe(true);

    act(() => {
      expect(result.claimScope()).toBe(true);
    });
    await act(async () => {
      await new Promise(resolve => setTimeout(resolve, 450));
    });

    expect(result.busyElsewhere).toBe(false);
    expect(result.onExternalRunComplete).not.toHaveBeenCalled();
  });
});
