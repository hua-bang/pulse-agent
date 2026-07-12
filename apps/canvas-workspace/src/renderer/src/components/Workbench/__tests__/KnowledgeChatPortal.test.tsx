// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeChatPortal } from '../KnowledgeChatPortal';

vi.mock('../../WorkspaceNodes/useWorkspaceNodes', () => ({
  useAllWorkspaceNodeList: () => ({ nodes: [], tags: [] }),
}));

vi.mock('../../chat/lazy', () => ({
  ChatPanelLazy: ({ agentScope, knowledgeMode, contextNodes, contextTags, contextCanvases }: {
    agentScope: { kind: string };
    knowledgeMode?: boolean;
    contextNodes?: Array<unknown>;
    contextTags?: Array<unknown>;
    contextCanvases?: Array<unknown>;
  }) => (
    <div
      data-testid="knowledge-chat"
      data-scope={agentScope.kind}
      data-knowledge-mode={String(knowledgeMode)}
      data-node-context-count={contextNodes?.length ?? 0}
      data-tag-context-count={contextTags?.length ?? 0}
      data-canvas-context-count={contextCanvases?.length ?? 0}
    />
  ),
}));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('KnowledgeChatPortal', () => {
  it('explicitly enables knowledge UI on its global ChatPanel', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <KnowledgeChatPortal
          selectedNode={null}
          workspaces={[]}
          onClose={() => undefined}
          onOpenAppSettings={() => undefined}
          onTurnComplete={() => undefined}
        />,
      );
    });

    const chat = host.querySelector('[data-testid="knowledge-chat"]');
    expect(chat?.getAttribute('data-scope')).toBe('global');
    expect(chat?.getAttribute('data-knowledge-mode')).toBe('true');
  });

  it('retains an explicit Workspace and Tag scope without falling back to a detail node', () => {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => {
      root?.render(
        <KnowledgeChatPortal
          selectedNode={{ workspaceId: 'workspace-a', nodeId: 'node-1' }}
          contextNodes={[]}
          contextTags={[{ name: 'Research', workspaceIds: ['workspace-a'] }]}
          contextCanvases={[{ id: 'workspace-a', name: 'Research canvas' }]}
          workspaces={[]}
          onClose={() => undefined}
          onOpenAppSettings={() => undefined}
          onTurnComplete={() => undefined}
        />,
      );
    });

    const chat = host.querySelector('[data-testid="knowledge-chat"]');
    expect(chat?.getAttribute('data-node-context-count')).toBe('0');
    expect(chat?.getAttribute('data-tag-context-count')).toBe('1');
    expect(chat?.getAttribute('data-canvas-context-count')).toBe('1');
  });
});
