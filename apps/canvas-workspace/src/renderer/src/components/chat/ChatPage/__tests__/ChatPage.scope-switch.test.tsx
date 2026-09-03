// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ChatTarget } from '../../../../agent-chat/target';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockState = vi.hoisted(() => ({
  mountCount: 0,
  latestProps: null as null | Record<string, any>,
}));

vi.mock('../../ChatPageBody', async () => {
  const React = await import('react');
  return {
    ChatPageBody: (props: {
      agentScope: { kind: string; workspaceId?: string };
      contextSnapshot?: { label: string };
      executionPolicy?: 'auto' | 'ask' | 'scheduled';
      pendingSessionId: string | null;
      pendingSessionIntentId: number | null;
      onSessionConsumed: (intentId: number, loaded: boolean) => void;
      onCreateNewSessionInScope?: (scope: { kind: 'workspace'; workspaceId: string }) => Promise<{ ok: boolean }>;
      onJumpToSession?: (session: { sessionId: string; workspaceId: string }) => void;
      selectedSessionKey?: string | null;
      pendingSessionKey?: string | null;
      onSelectSession: (session: {
        sessionId: string;
        workspaceId: string;
        workspaceName: string;
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
            'data-pending-session': props.pendingSessionKey ?? '',
            'data-context-label': props.contextSnapshot?.label ?? '',
            'data-execution-policy': props.executionPolicy ?? '',
            'data-pending-intent': props.pendingSessionIntentId ?? '',
            onContextMenu: (event: { preventDefault: () => void }) => {
              event.preventDefault();
              props.onJumpToSession?.({
                sessionId: 'session-jump',
                workspaceId: props.agentScope.workspaceId ?? '__global_chat__',
              });
            },
            onClick: () => props.onSelectSession({
              sessionId: 'session-b',
              workspaceId: 'workspace-b',
              workspaceName: 'Workspace B',
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
        React.createElement('button', {
          'data-new-session-a': true,
          onClick: () => void props.onCreateNewSessionInScope?.({ kind: 'workspace', workspaceId: 'workspace-a' }),
        }, 'new A'),
        React.createElement('button', {
          'data-new-session-b': true,
          onClick: () => void props.onCreateNewSessionInScope?.({ kind: 'workspace', workspaceId: 'workspace-b' }),
        }, 'new B'),
      );
    },
  };
});

import { ChatPage } from '..';

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
    ['__global_chat__', 'global'],
    ['__scheduled__-task-1', 'scheduled'],
  ])('routes a %s session reference to its special scope', async (workspaceId, expectedScope) => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <ChatPage
          allWorkspaces={[]}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });

    act(() => mockState.latestProps?.onJumpToSession?.({
      sessionId: 'referenced-session',
      workspaceId,
    }));

    const body = host.querySelector<HTMLButtonElement>('[data-chat-body]');
    expect(body?.textContent).toBe(expectedScope);
    expect(body?.dataset.selectedSession).toBe('');
    expect(body?.dataset.pendingSession).toBe(`${workspaceId}:referenced-session`);

    const intentId = mockState.latestProps?.pendingSessionIntentId as number;
    act(() => mockState.latestProps?.onSessionConsumed(intentId, true));
    expect(host.querySelector<HTMLButtonElement>('[data-chat-body]')?.textContent)
      .toBe(expectedScope);
    expect(host.querySelector<HTMLButtonElement>('[data-chat-body]')?.dataset.selectedSession)
      .toBe(`${workspaceId}:referenced-session`);
  });

  it('keeps ChatPageBody mounted when selecting a session in another workspace', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <ChatPage
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
    expect(switchedBody?.dataset.selectedSession).toBe('');
    expect(switchedBody?.dataset.pendingSession).toBe('workspace-b:session-b');
    expect(mockState.mountCount).toBe(1);

    const intentId = mockState.latestProps?.pendingSessionIntentId as number;
    act(() => mockState.latestProps?.onSessionConsumed(intentId, true));
    expect(host.querySelector<HTMLButtonElement>('[data-chat-body]')?.dataset.selectedSession)
      .toBe('workspace-b:session-b');
  });

  it('reports the owning workspace when a cross-workspace session is selected', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const onWorkspaceScopeChange = vi.fn();

    await act(async () => {
      root?.render(
        <ChatPage
          allWorkspaces={[{ id: 'workspace-b', name: 'Workspace B' }]}
          onWorkspaceScopeChange={onWorkspaceScopeChange}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });

    expect(onWorkspaceScopeChange).toHaveBeenLastCalledWith(null);

    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[data-chat-body]')?.click();
    });

    expect(onWorkspaceScopeChange).toHaveBeenLastCalledWith('workspace-b');
  });

  it('rolls scope and rail selection back when a cross-scope session load fails', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <ChatPage
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

  it('restores the reported dock workspace when a cross-scope load fails', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const onWorkspaceScopeChange = vi.fn();
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
        <ChatPage
          allWorkspaces={[
            { id: 'workspace-a', name: 'Workspace A' },
            { id: 'workspace-b', name: 'Workspace B' },
          ]}
          initialTarget={initialTarget}
          onWorkspaceScopeChange={onWorkspaceScopeChange}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });

    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[data-chat-body]')?.click();
    });
    expect(onWorkspaceScopeChange).toHaveBeenLastCalledWith('workspace-b');

    await act(async () => {
      host?.querySelector<HTMLButtonElement>('[data-fail-session-load]')?.click();
    });
    expect(onWorkspaceScopeChange).toHaveBeenLastCalledWith('workspace-a');
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
        <ChatPage
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
    expect(restored?.dataset.selectedSession).toBe('workspace-a:session-a');
    expect(restored?.dataset.contextLabel).toBe('Workspace A');
    expect(restored?.dataset.executionPolicy).toBe('ask');
  });

  it('loads an exact scheduled session when the page target changes after mount', async () => {
    const initialTarget: ChatTarget = {
      surface: 'page',
      scope: { kind: 'global' },
      scopeId: '__global_chat__',
      sessionId: 'global-session',
      composerId: 'page:__global_chat__',
      contextSnapshot: { label: 'Global chat' },
      executionPolicy: 'auto',
    };
    const scheduledTarget: ChatTarget = {
      surface: 'page',
      scope: { kind: 'scheduled', taskId: 'daily-brief' },
      scopeId: '__scheduled__-daily-brief',
      sessionId: 'scheduled-run-session',
      composerId: 'page:__scheduled__-daily-brief',
      contextSnapshot: { label: 'Morning brief' },
      executionPolicy: 'scheduled',
    };
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <ChatPage
          allWorkspaces={[]}
          initialTarget={initialTarget}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });
    await act(async () => {
      root?.render(
        <ChatPage
          allWorkspaces={[]}
          initialTarget={scheduledTarget}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });

    const body = host.querySelector<HTMLButtonElement>('[data-chat-body]');
    expect(body?.textContent).toBe('scheduled');
    expect(body?.dataset.pendingSession).toBe('__scheduled__-daily-brief:scheduled-run-session');
    expect(body?.dataset.contextLabel).toBe('Morning brief');
    expect(body?.dataset.executionPolicy).toBe('scheduled');
  });

  it('clears stale rail selection when an external scheduled target opens', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <ChatPage
          allWorkspaces={[{ id: 'workspace-b', name: 'Workspace B' }]}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });
    await act(async () => {
      host?.querySelector('button')?.click();
    });
    act(() => mockState.latestProps?.onSessionConsumed(
      mockState.latestProps?.pendingSessionIntentId as number,
      true,
    ));
    expect(host.querySelector('button')?.dataset.selectedSession).toBe('workspace-b:session-b');

    await act(async () => {
      root?.render(
        <ChatPage
          allWorkspaces={[{ id: 'workspace-b', name: 'Workspace B' }]}
          openScheduledTaskId="daily-brief"
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });

    const body = host.querySelector('button');
    expect(body?.textContent).toBe('scheduled');
    expect(body?.dataset.selectedSession).toBe('');
    expect(body?.dataset.executionPolicy).toBe('scheduled');
  });

  it('ignores a stale completion after a newer parent session intent wins', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root?.render(
        <ChatPage
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
      workspaceId: 'workspace-b',
    }));
    const staleIntent = mockState.latestProps?.pendingSessionIntentId as number;
    act(() => mockState.latestProps?.onJumpToSession({
      sessionId: 'session-c',
      workspaceId: 'workspace-c',
    }));
    const newestIntent = mockState.latestProps?.pendingSessionIntentId as number;
    expect(newestIntent).toBeGreaterThan(staleIntent);

    act(() => mockState.latestProps?.onSessionConsumed(staleIntent, false));
    const body = host.querySelector<HTMLButtonElement>('[data-chat-body]');
    expect(body?.textContent).toBe('workspace-c');
    expect(body?.dataset.pendingIntent).toBe(String(newestIntent));
  });

  it('keeps the latest workspace draft when cross-scope creation resolves out of order', async () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const resolvers = new Map<string, (result: { ok: boolean; activeSessionId: string }) => void>();
    const previousCanvasWorkspace = window.canvasWorkspace;
    window.canvasWorkspace = {
      ...previousCanvasWorkspace,
      agent: {
        ...previousCanvasWorkspace?.agent,
        newSession: vi.fn(({ scope }: { scope: { workspaceId?: string } }) => (
          new Promise(resolve => resolvers.set(scope.workspaceId ?? '', resolve))
        )),
      },
    } as typeof window.canvasWorkspace;

    await act(async () => {
      root?.render(
        <ChatPage
          allWorkspaces={[
            { id: 'workspace-a', name: 'Workspace A' },
            { id: 'workspace-b', name: 'Workspace B' },
          ]}
          onExit={vi.fn()}
          onOpenAppSettings={vi.fn()}
        />,
      );
    });

    act(() => {
      host?.querySelector<HTMLButtonElement>('[data-new-session-a]')?.click();
      host?.querySelector<HTMLButtonElement>('[data-new-session-b]')?.click();
    });
    await act(async () => {
      resolvers.get('workspace-b')?.({ ok: true, activeSessionId: 'draft-b' });
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLButtonElement>('[data-chat-body]')?.textContent).toBe('workspace-b');

    await act(async () => {
      resolvers.get('workspace-a')?.({ ok: true, activeSessionId: 'draft-a' });
      await Promise.resolve();
    });
    expect(host.querySelector<HTMLButtonElement>('[data-chat-body]')?.textContent).toBe('workspace-b');
    const body = host.querySelector<HTMLButtonElement>('[data-chat-body]');
    expect(body?.dataset.selectedSession).toBe('');
    expect(body?.dataset.pendingSession).toBe('workspace-b:draft-b');
    act(() => mockState.latestProps?.onSessionConsumed(
      mockState.latestProps?.pendingSessionIntentId as number,
      true,
    ));
    expect(host.querySelector<HTMLButtonElement>('[data-chat-body]')?.dataset.selectedSession)
      .toBe('workspace-b:draft-b');

    window.canvasWorkspace = previousCanvasWorkspace;
  });
});
