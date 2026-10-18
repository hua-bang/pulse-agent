// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AgentScope } from '../../../../types';
import { useChatDockWorkspace } from './useChatDockWorkspace';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let latest: ReturnType<typeof useChatDockWorkspace> | null = null;

const Harness = ({
  activeView,
  activeCanvasWorkspaceId,
  entryScope,
  selectCanvasWorkspace,
  collapseDock,
}: {
  activeView: string;
  activeCanvasWorkspaceId: string;
  entryScope?: AgentScope;
  selectCanvasWorkspace: (workspaceId: string) => void;
  collapseDock?: () => void;
}) => {
  latest = useChatDockWorkspace(
    activeView,
    activeCanvasWorkspaceId,
    entryScope,
    selectCanvasWorkspace,
    collapseDock,
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
  it('tracks the Chat scope without permitting a tab to override it', async () => {
    host = document.createElement('div');
    root = createRoot(host);
    const selectCanvasWorkspace = vi.fn();

    await act(async () => {
      root?.render(
        <Harness
          activeView="chat"
          activeCanvasWorkspaceId="canvas-a"
          entryScope={{ kind: 'workspace', workspaceId: 'chat-b' }}
          selectCanvasWorkspace={selectCanvasWorkspace}
        />,
      );
    });
    expect(latest?.dockWorkspaceId).toBe('chat-b');

    act(() => latest?.reportChatWorkspace('chat-c'));
    expect(latest?.dockWorkspaceId).toBe('chat-c');

    act(() => latest?.activateDockWorkspace('tab-d'));
    expect(latest?.dockWorkspaceId).toBe('chat-c');

    act(() => latest?.reportChatWorkspace(null));
    expect(latest?.dockWorkspaceId).toBe('__global_chat__');
    expect(selectCanvasWorkspace).not.toHaveBeenCalled();
  });

  it('collapses the incoming dock once when the Launcher starts a chat', async () => {
    host = document.createElement('div');
    root = createRoot(host);
    const selectCanvasWorkspace = vi.fn();
    const collapseDock = vi.fn();
    const render = (activeView: string, entryScope?: AgentScope) => root?.render(
      <Harness
        activeView={activeView}
        activeCanvasWorkspaceId="canvas-a"
        entryScope={entryScope}
        selectCanvasWorkspace={selectCanvasWorkspace}
        collapseDock={collapseDock}
      />,
    );

    await act(async () => render('home'));
    act(() => latest?.collapseDockOnEntry({ kind: 'global' }));
    expect(collapseDock).not.toHaveBeenCalled();

    await act(async () => render('chat', { kind: 'global' }));
    expect(latest?.dockWorkspaceId).toBe('__global_chat__');
    expect(collapseDock).toHaveBeenCalledTimes(1);

    // Later visits keep whatever the user chose for the dock.
    await act(async () => render('home'));
    await act(async () => render('chat', { kind: 'global' }));
    expect(collapseDock).toHaveBeenCalledTimes(1);
  });
});
