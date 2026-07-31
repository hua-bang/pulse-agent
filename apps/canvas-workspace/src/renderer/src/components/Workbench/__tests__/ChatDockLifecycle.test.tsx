// @vitest-environment happy-dom
import { act, Component, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { RightDock, RightDockProvider } from '../../RightDock';
import {
  ChatTargetProvider,
  useActiveChatTarget,
  type ChatTarget,
} from '../../chat/ChatTargetContext';
import type { WorkbenchController } from '../useWorkbenchState';
import { Workbench } from '../index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../Canvas', () => ({
  Canvas: ({
    chatPanelOpen,
    onChatToggle,
  }: {
    chatPanelOpen?: boolean;
    onChatToggle?: () => void;
  }) => (
    <button
      type="button"
      data-testid="canvas-chat-toggle"
      aria-pressed={chatPanelOpen}
      onClick={onChatToggle}
    >
      Toggle AI chat
    </button>
  ),
}));

vi.mock('../../chat/lazy', async () => {
  const { useMemo: useReactMemo } = await import('react');
  const { useRegisterChatTarget: useRegister } = await import('../../chat/useRegisterChatTarget');

  return {
    ChatPanelLazy: ({
      workspaceId,
      nodes,
      selectedNodeIds,
      chatTargetActive,
    }: {
      workspaceId: string;
      nodes: Array<{ id: string }>;
      selectedNodeIds: string[];
      chatTargetActive?: boolean;
    }) => {
      // Match ChatPanel's target derivation: selected canvas context is part
      // of the target snapshot, so a new selection array means a new target.
      const target = useReactMemo<ChatTarget>(() => ({
        surface: 'dock',
        scope: { kind: 'workspace', workspaceId },
        scopeId: workspaceId,
        sessionId: null,
        composerId: `dock:${workspaceId}`,
        contextSnapshot: {
          label: workspaceId,
          contextLabels: [...nodes.map(node => node.id), ...selectedNodeIds],
        },
        executionPolicy: 'auto',
      }), [nodes, selectedNodeIds, workspaceId]);
      useRegister(chatTargetActive ? target : null, {});
      return <div data-testid="chat-panel-fixture" />;
    },
  };
});

vi.mock('../../RightDock/DockCreationControls', () => ({
  DockCreationControls: () => null,
}));

vi.mock('../../RightDock/useDockAgentBridge', () => ({
  useDockAgentBridge: () => undefined,
}));

vi.mock('../../../hooks/useConsumePendingLinks', () => ({
  useConsumePendingLinks: () => undefined,
}));

const workspace = { id: 'workspace-a', name: 'Workspace A' };
const noOp = () => undefined;
const controller = {
  // Deliberately no workspace keys. Both ChatPanel collection props must use
  // stable empty fallbacks across broker-driven root renders.
  allNodes: {},
  activeNodes: [],
  activeSelectedNode: undefined,
  selectedNodeIdsByWorkspace: {},
  focusRequest: undefined,
  deleteRequest: undefined,
  renameRequest: undefined,
  ensureWorkspaceNodesLoaded: noOp,
  getWorkspaceNodes: () => [],
  handleNodesChange: noOp,
  patchNodeSnapshot: () => undefined,
  handleSelectionChange: noOp,
  requestNodeFocus: noOp,
  requestActiveNodeFocus: noOp,
  requestActiveNodeDelete: noOp,
  requestActiveNodeRename: noOp,
  clearFocusRequest: noOp,
  clearDeleteRequest: noOp,
  clearRenameRequest: noOp,
} satisfies WorkbenchController;

const LifecycleHarness = () => {
  const activeTarget = useActiveChatTarget();
  const knowledgeChatContext = useMemo(
    () => ({ active: false, selectedNode: null }),
    [],
  );

  return (
    <>
      <output data-testid="active-chat-target">
        {activeTarget?.composerId ?? 'none'}
      </output>
      <Workbench
        activeWorkspaceId={workspace.id}
        workspaces={[workspace]}
        controller={controller}
        knowledgeChatContext={knowledgeChatContext}
        onSelectWorkspace={noOp}
        onActivateWorkspace={noOp}
        onOpenAppSettings={noOp}
        onOpenWorkspaceSettings={noOp}
        onSetActiveRootFolder={noOp}
      />
      <RightDock
        activeWorkspaceId={workspace.id}
        activeIdReady
        chatTabEnabled
        reserveSpace
        capWidth={false}
        workspaces={[workspace]}
        onOpenNodePage={noOp}
      />
    </>
  );
};

class TestErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    return this.state.error
      ? <output data-testid="render-error">{this.state.error.message}</output>
      : this.props.children;
  }
}

describe('Workbench chat dock lifecycle', () => {
  let host: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    window.localStorage.clear();
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        link: {
          onOpen: () => () => undefined,
        },
      },
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollIntoView', {
      configurable: true,
      value: vi.fn(),
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('opens and collapses chat without entering a target registration render loop', async () => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <ChatTargetProvider>
            <RightDockProvider>
              <TestErrorBoundary>
                <LifecycleHarness />
              </TestErrorBoundary>
            </RightDockProvider>
          </ChatTargetProvider>
        </I18nProvider>,
      );
    });

    expect(host.querySelector('[data-testid="active-chat-target"]')?.textContent).toBe('none');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="canvas-chat-toggle"]')?.click();
    });

    expect(host.querySelector('[data-testid="render-error"]')).toBeNull();
    expect(host.querySelector('.right-dock')?.getAttribute('data-expanded')).toBe('true');
    expect(host.querySelector('[data-testid="active-chat-target"]')?.textContent)
      .toBe('dock:workspace-a');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="canvas-chat-toggle"]')?.click();
    });

    expect(host.querySelector('.right-dock')?.getAttribute('data-expanded')).toBe('false');
    expect(host.querySelector('[data-testid="active-chat-target"]')?.textContent).toBe('none');
    expect(host.querySelector('[data-testid="canvas-chat-toggle"]')).not.toBeNull();

    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="canvas-chat-toggle"]')?.click();
    });

    expect(host.querySelector('.right-dock')?.getAttribute('data-expanded')).toBe('true');
    expect(host.querySelector('[data-testid="active-chat-target"]')?.textContent)
      .toBe('dock:workspace-a');
  });
});
