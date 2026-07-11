// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { KnowledgeChatPortal } from '../KnowledgeChatPortal';

vi.mock('../../WorkspaceNodes/useWorkspaceNodes', () => ({
  useAllWorkspaceNodeList: () => ({ nodes: [], tags: [] }),
}));

vi.mock('../../chat/lazy', () => ({
  ChatPanelLazy: ({ agentScope, knowledgeMode }: {
    agentScope: { kind: string };
    knowledgeMode?: boolean;
  }) => (
    <div
      data-testid="knowledge-chat"
      data-scope={agentScope.kind}
      data-knowledge-mode={String(knowledgeMode)}
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
});
