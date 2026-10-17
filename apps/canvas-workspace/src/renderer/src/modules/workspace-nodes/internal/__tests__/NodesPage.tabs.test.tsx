// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceEntry } from '../../../../shared/workspaces';
import type { WorkspaceNodeListItem } from '../../../../types';
import { I18nProvider } from '../../../../i18n';
import { RightDockProvider, useRightDockState } from '../../../dock/internal/RightDock';
import { OPEN_NODE_PAGE_EVENT, type OpenNodeDetail } from '../../../../utils/openNodeBridge';

const NODE: WorkspaceNodeListItem = {
  id: 'node-1',
  type: 'file',
  title: 'Search & RSS',
  displayTitle: 'Search & RSS',
  summary: 'A note about feeds.',
  tags: [],
  hasData: true,
  linkCount: 0,
  workspaceId: 'workspace-1',
  workspaceName: 'Research',
};

vi.mock('../useWorkspaceNodes', () => ({
  useAllWorkspaceNodeList: () => ({
    nodes: [NODE],
    tags: [],
    loading: false,
    error: null,
    reload: vi.fn(),
  }),
}));

import { NodesPage } from '../NodesPage';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

const DockProbe = () => {
  const state = useRightDockState();
  const nodeTabs = state.tabs.filter((tab) => tab.kind === 'node-detail');
  return (
    <output
      data-testid="dock-probe"
      data-count={nodeTabs.length}
      data-active={state.activeTabId}
      data-expanded={state.expanded}
    />
  );
};

describe('NodesPage card open', () => {
  it('opens the node detail page from a card without a dock tab or inline drawer', () => {
    const workspaces: WorkspaceEntry[] = [{ id: 'workspace-1', name: 'Research' } as WorkspaceEntry];
    const opened: OpenNodeDetail[] = [];
    const onOpenPage = (event: Event) => opened.push((event as CustomEvent<OpenNodeDetail>).detail);
    window.addEventListener(OPEN_NODE_PAGE_EVENT, onOpenPage);
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root?.render(
      <I18nProvider>
        <RightDockProvider>
          <NodesPage workspaces={workspaces} />
          <DockProbe />
        </RightDockProvider>
      </I18nProvider>,
    ));

    const open = host.querySelector<HTMLButtonElement>('.knowledge-node-card__button');
    if (!open) throw new Error('Expected a node card action');
    act(() => open.click());
    window.removeEventListener(OPEN_NODE_PAGE_EVENT, onOpenPage);

    expect(opened).toEqual([{ workspaceId: 'workspace-1', nodeId: 'node-1' }]);
    const probe = host.querySelector<HTMLOutputElement>('[data-testid="dock-probe"]');
    expect(probe?.dataset.count).toBe('0');
    expect(host.querySelector('.node-detail-drawer')).toBeNull();
  });
});
