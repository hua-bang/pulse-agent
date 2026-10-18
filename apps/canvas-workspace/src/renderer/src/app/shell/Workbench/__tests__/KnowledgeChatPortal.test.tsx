// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeChatPortal } from '../KnowledgeChatPortal';

const mockNodes = vi.hoisted(() => ({ list: [] as Array<Record<string, unknown>> }));

vi.mock('../../../../modules/workspace-nodes', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useAllWorkspaceNodeList: () => ({ nodes: mockNodes.list, tags: [] }),
}));

vi.mock('../../../../modules/chat/lazy', () => ({
  ChatPanelLazy: ({ agentScope, knowledgeMode, contextNodes, contextTags, contextCanvases, onRemoveContext }: {
    agentScope: { kind: string };
    onRemoveContext?: (key: string) => void;
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
      onClick={() => onRemoveContext?.('node:workspace-a:node-1')}
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
          knowledgeMode
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
          knowledgeMode
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

  it('removes the opened node chip until another node is opened', () => {
    mockNodes.list = [
      { id: 'node-1', type: 'text', title: 'One', workspaceId: 'workspace-a', tags: [], hasData: true, linkCount: 0 },
      { id: 'node-2', type: 'text', title: 'Two', workspaceId: 'workspace-a', tags: [], hasData: true, linkCount: 0 },
    ];
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    const render = (nodeId: string) => act(() => {
      root?.render(
        <KnowledgeChatPortal
          knowledgeMode
          selectedNode={{ workspaceId: 'workspace-a', nodeId }}
          workspaces={[]}
          onClose={() => undefined}
          onOpenAppSettings={() => undefined}
          onTurnComplete={() => undefined}
        />,
      );
    });
    const count = () => host?.querySelector('[data-testid="knowledge-chat"]')?.getAttribute('data-node-context-count');

    render('node-1');
    expect(count()).toBe('1');
    act(() => host?.querySelector<HTMLElement>('[data-testid="knowledge-chat"]')?.click());
    expect(count()).toBe('0');

    render('node-2');
    expect(count()).toBe('1');
    mockNodes.list = [];
  });
});
