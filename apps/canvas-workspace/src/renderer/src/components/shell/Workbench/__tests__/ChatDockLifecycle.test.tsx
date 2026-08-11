// @vitest-environment happy-dom
import { act, Component, useMemo, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { RightDock, RightDockProvider } from '../../../dock/RightDock';
import {
  ChatTargetProvider,
  useActiveChatTarget,
  type ChatTarget,
} from '../../../chat/ChatTargetContext';
import type { WorkbenchController } from '../useWorkbenchState';
import { Workbench } from '../index';
import { AppShellProvider } from '../../../shell/AppShellProvider';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../canvas/Canvas', () => ({
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

vi.mock('../../../chat/lazy', async () => {
  const { useMemo: useReactMemo } = await import('react');
  const { useRegisterChatTarget: useRegister } = await import('../../../chat/useRegisterChatTarget');

  return {
    ChatPanelLazy: ({
      workspaceId,
      agentScope,
      nodes,
      selectedNodeIds,
      contextNodes,
      chatTargetActive,
    }: {
      workspaceId?: string;
      agentScope?: { kind: 'global' };
      nodes?: Array<{ id: string }>;
      selectedNodeIds?: string[];
      contextNodes?: Array<unknown>;
      chatTargetActive?: boolean;
    }) => {
      // Match ChatPanel's target derivation: nodes and selection feed the
      // memo, so a new array identity for either yields a new target object —
      // which is exactly what an unstable `[]` fallback would produce on every
      // broker-driven root render.
      const scopeId = workspaceId ?? agentScope?.kind ?? 'unknown';
      const target = useReactMemo<ChatTarget>(() => ({
        surface: 'dock',
        scope: agentScope ?? { kind: 'workspace', workspaceId: workspaceId ?? '' },
        scopeId,
        sessionId: null,
        composerId: `dock:${scopeId}`,
        contextSnapshot: { label: scopeId },
        executionPolicy: 'auto',
      }), [agentScope, contextNodes, nodes, scopeId, selectedNodeIds, workspaceId]);
      useRegister(chatTargetActive !== false ? target : null, {});
      return <div data-testid="chat-panel-fixture" />;
    },
  };
});

vi.mock('../../../dock/RightDock/DockCreationControls', () => ({
  DockCreationControls: () => null,
}));

vi.mock('../../../dock/RightDock/useDockAgentBridge', () => ({
  useDockAgentBridge: () => undefined,
}));

vi.mock('../../../../hooks/useConsumePendingLinks', () => ({
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

const KnowledgeDetailLifecycleHarness = () => {
  const activeTarget = useActiveChatTarget();

  return (
    <>
      <output data-testid="active-chat-target">
        {activeTarget?.composerId ?? 'none'}
      </output>
      <Workbench
        activeWorkspaceId={workspace.id}
        workspaces={[workspace]}
        controller={controller}
        knowledgeChatContext={{
          active: true,
          selectedNode: { workspaceId: workspace.id, nodeId: 'node-1' },
        }}
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
          <AppShellProvider>
            <ChatTargetProvider>
              <RightDockProvider>
                <TestErrorBoundary>
                  <LifecycleHarness />
                </TestErrorBoundary>
              </RightDockProvider>
            </ChatTargetProvider>
          </AppShellProvider>
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

  it('keeps the knowledge-detail chat target stable across broker renders', async () => {
    await act(async () => {
      root.render(
        <I18nProvider>
          <AppShellProvider>
            <ChatTargetProvider>
              <RightDockProvider>
                <TestErrorBoundary>
                  <KnowledgeDetailLifecycleHarness />
                </TestErrorBoundary>
              </RightDockProvider>
            </ChatTargetProvider>
          </AppShellProvider>
        </I18nProvider>,
      );
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('[data-testid="canvas-chat-toggle"]')?.click();
    });
    await act(async () => {
      await import('../KnowledgeChatPortal');
    });

    expect(host.querySelector('[data-testid="render-error"]')).toBeNull();
    expect(host.querySelector('[data-testid="chat-panel-fixture"]')).not.toBeNull();
    expect(host.querySelector('[data-testid="active-chat-target"]')?.textContent)
      .toBe('dock:global');
  });
});
