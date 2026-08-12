// @vitest-environment happy-dom
import { act, useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  activeChatTargetFromRegisteredTarget,
  type ActiveChatTarget,
  type ChatTarget,
} from '../ChatTargetContext';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockState = vi.hoisted(() => ({
  mountCount: 0,
  latestProps: null as null | Record<string, any>,
}));

vi.mock('../ChatPageBody', async () => {
  const React = await import('react');
  return {
    ChatPageBody: (props: {
      agentScope: { kind: string; workspaceId?: string };
      contextSnapshot?: { label: string };
      executionPolicy?: 'auto' | 'ask' | 'scheduled';
      pendingSessionId: string | null;
      pendingSessionIntentId: number | null;
      onSessionConsumed: (intentId: number, loaded: boolean) => void;
      onJumpToSession?: (session: { sessionId: string; scope: { kind: string; workspaceId?: string; taskId?: string } }) => void;
      selectedSessionKey?: string | null;
      onSelectSession: (session: {
        sessionId: string;
        scope: { kind: string; workspaceId?: string };
        scopeName: string;
        date: string;
        messageCount: number;
      }) => void;
    }) => {
      mockState.latestProps = props;
      const [mountId] = React.useState(() => ++mockState.mountCount);
      return React.createElement('div', null,
        React.createElement(
          'button',
          {
            'data-chat-body': true,
            'data-mount-id': mountId,
            'data-selected-session': props.selectedSessionKey ?? '',
            'data-context-label': props.contextSnapshot?.label ?? '',
            'data-execution-policy': props.executionPolicy ?? '',
            'data-pending-intent': props.pendingSessionIntentId ?? '',
            onContextMenu: (event: { preventDefault: () => void }) => {
              event.preventDefault();
              props.onJumpToSession?.({
                sessionId: 'session-jump',
                scope: props.agentScope,
              });
            },
            onClick: () => props.onSelectSession({
              sessionId: 'session-b',
              scope: { kind: 'workspace', workspaceId: 'workspace-b' },
              scopeName: 'Workspace B',
              date: '2026-07-29',
              messageCount: 1,
            }),
          },
          props.agentScope.kind === 'workspace'
            ? props.agentScope.workspaceId
            : props.agentScope.kind,
        ),
        React.createElement('button', {
          'data-fail-session-load': true,
          onClick: () => props.onSessionConsumed(props.pendingSessionIntentId ?? -1, false),
        }, 'fail'),
      );
    },
  };
});

import { ChatPage } from '../ChatPage';

const TestChatPage = ({
  initialTarget,
  onTargetChange,
  ...props
}: Omit<React.ComponentProps<typeof ChatPage>, 'activeChatTarget' | 'setActiveChatTarget'> & {
  initialTarget?: ChatTarget | null;
  onTargetChange?: (target: ActiveChatTarget) => void;
}) => {
  const [activeChatTarget, setActiveChatTarget] = useState(
    () => activeChatTargetFromRegisteredTarget(initialTarget ?? null),
  );
  useEffect(() => onTargetChange?.(activeChatTarget), [activeChatTarget, onTargetChange]);
  return (
    <ChatPage
      {...props}
      activeChatTarget={activeChatTarget}
      setActiveChatTarget={setActiveChatTarget}
    />
  );
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  mockState.mountCount = 0;
  mockState.latestProps = null;
});

describe('ChatPage scope switching', () => {
  it.each([
    [{ kind: 'global' } as const, 'global', 'global'],
    [{ kind: 'scheduled', taskId: 'task-1' } as const, 'scheduled', 'scheduled:task-1'],
  ])('routes a $expectedScope session reference to its special scope', async (scope, expectedScope, expectedScopeKey) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <TestChatPage
          allWorkspaces={[]}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });

    act(() => mockState.latestProps?.onJumpToSession?.({
      sessionId: 'referenced-session',
      scope,
    }));

    const body = host.querySelector<HTMLButtonElement>('[data-chat-body]');
    expect(body?.textContent).toBe(expectedScope);
    expect(body?.dataset.selectedSession).toBe(`${expectedScopeKey}:referenced-session`);

    const intentId = mockState.latestProps?.pendingSessionIntentId as number;
    act(() => mockState.latestProps?.onSessionConsumed(intentId, true));
    expect(host.querySelector<HTMLButtonElement>('[data-chat-body]')?.textContent)
      .toBe(expectedScope);
    expect(host.querySelector<HTMLButtonElement>('[data-chat-body]')?.dataset.selectedSession)
      .toBe(`${expectedScopeKey}:referenced-session`);
  });

  it('keeps ChatPageBody mounted when selecting a session in another workspace', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <TestChatPage
          allWorkspaces={[{ id: 'workspace-b', name: 'Workspace B' }]}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });

    const body = host.querySelector('button');
    expect(body?.dataset.mountId).toBe('1');
    expect(body?.textContent).toBe('global');

    await act(async () => {
      body?.click();
    });

    const switchedBody = host.querySelector('button');
    expect(switchedBody?.textContent).toBe('workspace-b');
    expect(switchedBody?.dataset.mountId).toBe('1');
    expect(switchedBody?.dataset.selectedSession).toBe('workspace:workspace-b:session-b');
    expect(mockState.mountCount).toBe(1);
  });

  it('updates the active Chat target when a cross-workspace session is selected', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const onTargetChange = vi.fn();

    await act(async () => {
      root?.render(
        <TestChatPage
          allWorkspaces={[{ id: 'workspace-b', name: 'Workspace B' }]}
          onTargetChange={onTargetChange}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });

    expect(onTargetChange).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: { kind: 'global' },
    }));

    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[data-chat-body]')?.click();
    });

    expect(onTargetChange).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: { kind: 'workspace', workspaceId: 'workspace-b' },
      sessionId: 'session-b',
    }));
  });

  it('rolls scope and rail selection back when a cross-scope session load fails', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <TestChatPage
          allWorkspaces={[{ id: 'workspace-b', name: 'Workspace B' }]}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });

    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[data-chat-body]')?.click();
    });
    expect(host.querySelector<HTMLButtonElement>('[data-chat-body]')?.textContent).toBe('workspace-b');
    act(() => {
      host?.querySelector<HTMLButtonElement>('[data-chat-body]')
        ?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true }));
    });

    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[data-fail-session-load]')?.click();
    });
    const rolledBack = host.querySelector<HTMLButtonElement>('[data-chat-body]');
    expect(rolledBack?.textContent).toBe('global');
    expect(rolledBack?.dataset.selectedSession).toBe('');
  });

  it('restores the active Chat target when a cross-scope load fails', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const onTargetChange = vi.fn();
    const initialTarget: ChatTarget = {
      surface: 'dock',
      scope: { kind: 'workspace', workspaceId: 'workspace-a' },
      scopeId: 'workspace-a',
      sessionId: 'session-a',
      composerId: 'dock:workspace-a',
      contextSnapshot: { label: 'Workspace A' },
      executionPolicy: 'auto',
    };

    await act(async () => {
      root?.render(
        <TestChatPage
          allWorkspaces={[
            { id: 'workspace-a', name: 'Workspace A' },
            { id: 'workspace-b', name: 'Workspace B' },
          ]}
          initialTarget={initialTarget}
          onTargetChange={onTargetChange}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });

    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[data-chat-body]')?.click();
    });
    expect(onTargetChange).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: { kind: 'workspace', workspaceId: 'workspace-b' },
    }));

    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[data-fail-session-load]')?.click();
    });
    expect(onTargetChange).toHaveBeenLastCalledWith(expect.objectContaining({
      scope: { kind: 'workspace', workspaceId: 'workspace-a' },
      sessionId: 'session-a',
    }));
  });

  it('inherits the scope and context of the chat target that opened the page', async () => {
    const initialTarget: ChatTarget = {
      surface: 'dock',
      scope: { kind: 'workspace', workspaceId: 'workspace-a' },
      scopeId: 'workspace-a',
      sessionId: 'session-a',
      composerId: 'dock:workspace-a',
      contextSnapshot: { label: 'Workspace A' },
      executionPolicy: 'ask',
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <TestChatPage
          allWorkspaces={[{ id: 'workspace-a', name: 'Workspace A' }]}
          initialTarget={initialTarget}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });

    const body = host.querySelector('button');
    expect(body?.textContent).toBe('workspace-a');
    expect(body?.dataset.contextLabel).toBe('Workspace A');
    expect(body?.dataset.executionPolicy).toBe('ask');
    act(() => body?.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true })));
    expect(host.querySelector('button')?.dataset.contextLabel).toBe('');
    expect(host.querySelector('button')?.dataset.executionPolicy).toBe('auto');
    act(() => {
      host?.querySelector<HTMLButtonElement>('[data-fail-session-load]')?.click();
    });
    const restored = host.querySelector<HTMLButtonElement>('[data-chat-body]');
    expect(restored?.dataset.selectedSession).toBe('workspace:workspace-a:session-a');
    expect(restored?.dataset.contextLabel).toBe('Workspace A');
    expect(restored?.dataset.executionPolicy).toBe('ask');
  });

  it('ignores a stale completion after a newer parent session intent wins', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <TestChatPage
          allWorkspaces={[
            { id: 'workspace-b', name: 'Workspace B' },
            { id: 'workspace-c', name: 'Workspace C' },
          ]}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });
    act(() => mockState.latestProps?.onJumpToSession({
      sessionId: 'session-b',
      scope: { kind: 'workspace', workspaceId: 'workspace-b' },
    }));
    const staleIntent = mockState.latestProps?.pendingSessionIntentId as number;
    act(() => mockState.latestProps?.onJumpToSession({
      sessionId: 'session-c',
      scope: { kind: 'workspace', workspaceId: 'workspace-c' },
    }));
    const newestIntent = mockState.latestProps?.pendingSessionIntentId as number;
    expect(newestIntent).toBeGreaterThan(staleIntent);

    act(() => mockState.latestProps?.onSessionConsumed(staleIntent, false));
    const body = host.querySelector<HTMLButtonElement>('[data-chat-body]');
    expect(body?.textContent).toBe('workspace-c');
    expect(body?.dataset.pendingIntent).toBe(String(newestIntent));
  });
});
