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
}: {
  activeView: string;
  activeCanvasWorkspaceId: string;
  entryScope?: AgentScope;
  selectCanvasWorkspace: (workspaceId: string) => void;
}) => {
  latest = useChatDockWorkspace(
    activeView,
    activeCanvasWorkspaceId,
    entryScope,
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
});
