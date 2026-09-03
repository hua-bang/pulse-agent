// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { AppShellProvider } from '../../../shell/AppShellProvider';
import type { AgentContextTabRef } from '../../../../types';
import { NodeDetailDockTab } from '../NodeDetailDockTab';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

vi.mock('../../../../modules/workspace-nodes/detail', () => ({
  NodeDetailPanel: () => <div data-testid="node-detail" />,
}));

vi.mock('../../../../modules/workspace-nodes', () => ({
  getNodeTitle: (node: { title?: string }, fallback: string) => node.title ?? fallback,
  useWorkspaceNode: () => ({
    node: { id: 'node-1', type: 'text', title: 'Research note', data: {}, updatedAt: 1 },
    loading: false,
    error: null,
    missing: false,
    setNode: vi.fn(),
    reload: vi.fn(),
  }),
  useKnowledgeTags: () => ({ tags: [], reload: vi.fn() }),
  useWorkspaceNodeList: () => ({ nodes: [], tags: [], reload: vi.fn() }),
}));

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('NodeDetailDockTab', () => {
  it('offers the whole node-detail tab to the current AI conversation', async () => {
    const tabRef: AgentContextTabRef = {
      id: 'node:workspace-1:node-1',
      kind: 'node-detail',
      title: 'Research note',
      workspaceId: 'workspace-1',
      dockWorkspaceId: 'workspace-1',
      nodeId: 'node-1',
    };
    const onAddTabToChat = vi.fn(async () => ({
      status: 'delivered' as const,
      target: {
        surface: 'dock' as const,
        scope: { kind: 'workspace' as const, workspaceId: 'workspace-1' },
        scopeId: 'workspace-1',
        sessionId: null,
        composerId: 'dock:workspace-1',
        contextSnapshot: { label: 'Research' },
        executionPolicy: 'auto' as const,
      },
    }));
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => root?.render(
      <I18nProvider>
        <AppShellProvider>
          <NodeDetailDockTab
            workspaceId="workspace-1"
            nodeId="node-1"
            tabRef={tabRef}
            targetWorkspaceId="workspace-1"
            onAddTabToChat={onAddTabToChat}
            onTitleChange={() => undefined}
            onOpenPage={() => undefined}
            onClose={() => undefined}
          />
        </AppShellProvider>
      </I18nProvider>,
    ));

    const button = host.querySelector<HTMLButtonElement>('[aria-label="Add Research note to the current conversation"]');
    expect(button).not.toBeNull();
    await act(async () => button?.click());

    expect(onAddTabToChat).toHaveBeenCalledWith('workspace-1', tabRef);
    expect(document.body.textContent).toContain('Added to Research');
  });
});
