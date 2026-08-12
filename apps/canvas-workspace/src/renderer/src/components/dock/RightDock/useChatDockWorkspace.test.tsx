// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActiveChatTarget } from '../../chat/ChatTargetContext';
import { GLOBAL_DOCK_SCOPE_KEY } from './dock-workspace';
import { useChatDockWorkspace } from './useChatDockWorkspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: ReturnType<typeof useChatDockWorkspace> | null = null;

const Harness = ({
  activeView,
  activeCanvasWorkspaceId,
  activeChatTarget,
  selectCanvasWorkspace,
}: {
  activeView: string;
  activeCanvasWorkspaceId: string;
  activeChatTarget: ActiveChatTarget;
  selectCanvasWorkspace: (workspaceId: string) => void;
}) => {
  latest = useChatDockWorkspace(
    activeView,
    activeCanvasWorkspaceId,
    activeChatTarget,
    selectCanvasWorkspace,
  );
  return null;
};

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  latest = null;
});

describe('useChatDockWorkspace', () => {
  it('keeps the Chat canvas target stable while permitting an internal dock-owner override', async () => {
    host = document.createElement('div');
    root = createRoot(host);
    const selectCanvasWorkspace = vi.fn();

    await act(async () => {
      root?.render(
        <Harness
          activeView="chat"
          activeCanvasWorkspaceId="canvas-a"
          activeChatTarget={{
            scope: { kind: 'workspace', workspaceId: 'chat-b' },
            sessionId: 'session-b',
            executionPolicy: 'auto',
          }}
          selectCanvasWorkspace={selectCanvasWorkspace}
        />,
      );
    });
    expect(latest?.dockWorkspaceId).toBe('chat-b');

    act(() => latest?.activateDockWorkspace('tab-d'));
    expect(latest?.dockWorkspaceId).toBe('chat-b');
    expect(latest?.dockScopeKey).toBe('tab-d');
    expect(selectCanvasWorkspace).not.toHaveBeenCalled();

    act(() => root?.render(
      <Harness
        activeView="chat"
        activeCanvasWorkspaceId="canvas-a"
        activeChatTarget={{
          scope: { kind: 'workspace', workspaceId: 'chat-c' },
          sessionId: 'session-c',
          executionPolicy: 'auto',
        }}
        selectCanvasWorkspace={selectCanvasWorkspace}
      />,
    ));
    expect(latest?.dockScopeKey).toBe('chat-c');
  });

  it('binds global Chat to the workspace-independent Dock session', async () => {
    host = document.createElement('div');
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <Harness
          activeView="chat"
          activeCanvasWorkspaceId="canvas-a"
          activeChatTarget={{
            scope: { kind: 'global' },
            sessionId: null,
            executionPolicy: 'auto',
          }}
          selectCanvasWorkspace={vi.fn()}
        />,
      );
    });

    expect(latest?.dockWorkspaceId).toBeNull();
    expect(latest?.dockScopeKey).toBe(GLOBAL_DOCK_SCOPE_KEY);

    act(() => latest?.activateDockWorkspace('tab-d'));
    expect(latest?.dockWorkspaceId).toBeNull();
    expect(latest?.dockScopeKey).toBe('tab-d');
  });

  it('binds scheduled Chat to the same workspace-independent Dock session', async () => {
    host = document.createElement('div');
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <Harness
          activeView="scheduled-task"
          activeCanvasWorkspaceId="canvas-a"
          activeChatTarget={{
            scope: { kind: 'scheduled', taskId: 'task-1' },
            sessionId: null,
            executionPolicy: 'scheduled',
          }}
          selectCanvasWorkspace={vi.fn()}
        />,
      );
    });

    expect(latest?.dockWorkspaceId).toBeNull();
    expect(latest?.dockScopeKey).toBe(GLOBAL_DOCK_SCOPE_KEY);
  });
});
