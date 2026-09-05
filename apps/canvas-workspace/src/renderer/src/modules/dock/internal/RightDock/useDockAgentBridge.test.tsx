// @vitest-environment happy-dom
import { act, useLayoutEffect, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockStore } from './dock-store';
import { useDockAgentBridge } from './useDockAgentBridge';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type ActivatePayload = {
  requestId: string;
  workspaceId: string;
  tabId: string;
};

let root: Root | null = null;
let host: HTMLDivElement | null = null;
let onActivateTab: ((payload: ActivatePayload) => void) | null = null;
const reportTabActivation = vi.fn();
const publishTabs = vi.fn();

const Harness = ({
  store,
  activeWorkspaceId,
  onActivateWorkspace,
}: {
  store: DockStore;
  activeWorkspaceId: string;
  onActivateWorkspace: (workspaceId: string) => boolean;
}) => {
  const state = useSyncExternalStore(store.subscribe, store.getSnapshot);
  useLayoutEffect(() => {
    store.setActiveWorkspace(activeWorkspaceId);
  }, [activeWorkspaceId, store]);
  useDockAgentBridge(store, state, activeWorkspaceId, onActivateWorkspace);
  return null;
};

const render = async (
  store: DockStore,
  activeWorkspaceId: string,
  onActivateWorkspace = vi.fn(() => true),
) => {
  if (!host) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => {
    root?.render(
      <Harness
        store={store}
        activeWorkspaceId={activeWorkspaceId}
        onActivateWorkspace={onActivateWorkspace}
      />,
    );
    await Promise.resolve();
  });
  return onActivateWorkspace;
};

beforeEach(() => {
  onActivateTab = null;
  reportTabActivation.mockReset();
  publishTabs.mockReset();
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: {
      dock: {
        onActivateTab: (callback: (payload: ActivatePayload) => void) => {
          onActivateTab = callback;
          return () => undefined;
        },
        onOpenTab: () => () => undefined,
        onOpenArtifact: () => () => undefined,
        reportTabActivation,
        publishTabs,
      },
    },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('useDockAgentBridge activation acknowledgement', () => {
  it('publishes the visible tabs under the new workspace after a scope switch', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-1');
    store.openNodeDetail('ws-1', 'node-1', 'Workspace one node');
    store.setActiveWorkspace('ws-2');
    store.openNodeDetail('ws-2', 'node-2', 'Workspace two node');
    await render(store, 'ws-1');

    expect(publishTabs).toHaveBeenLastCalledWith(
      'ws-1',
      expect.arrayContaining([
        expect.objectContaining({ id: 'node-detail:ws-1:node-1' }),
      ]),
    );

    await render(store, 'ws-2');

    expect(publishTabs).toHaveBeenLastCalledWith(
      'ws-2',
      expect.arrayContaining([
        expect.objectContaining({ id: 'node-detail:ws-2:node-2' }),
      ]),
    );
  });

  it('acknowledges only after the requested tab is active', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-1');
    store.openNodeDetail('ws-1', 'node-1', 'Node one');
    store.openNodeDetail('ws-1', 'node-2', 'Node two');
    await render(store, 'ws-1');

    act(() => onActivateTab?.({
      requestId: 'req-1',
      workspaceId: 'ws-1',
      tabId: 'node-detail:ws-1:node-1',
    }));

    expect(store.getSnapshot()).toMatchObject({
      activeTabId: 'node-detail:ws-1:node-1',
      expanded: true,
    });
    expect(reportTabActivation).toHaveBeenCalledWith({
      requestId: 'req-1',
      workspaceId: 'ws-1',
      tabId: 'node-detail:ws-1:node-1',
      ok: true,
    });
  });

  it('switches dock ownership without navigating and acknowledges after the switch', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-1');
    store.setActiveWorkspace('ws-2');
    store.openNodeDetail('ws-2', 'node-2', 'Other workspace node');
    const selectWorkspace = await render(store, 'ws-1');

    act(() => onActivateTab?.({
      requestId: 'req-2',
      workspaceId: 'ws-2',
      tabId: 'node-detail:ws-2:node-2',
    }));

    expect(selectWorkspace).toHaveBeenCalledWith('ws-2');
    expect(reportTabActivation).not.toHaveBeenCalled();

    act(() => store.setActiveWorkspace('ws-2'));
    await render(store, 'ws-2', selectWorkspace);

    expect(store.getSnapshot().activeTabId).toBe('node-detail:ws-2:node-2');
    expect(reportTabActivation).toHaveBeenCalledWith(expect.objectContaining({
      requestId: 'req-2',
      ok: true,
    }));
  });

  it('opens a cross-workspace transcript citation as a preview without switching the Dock', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-1');
    store.setActiveWorkspace('ws-2');
    store.openNodeDetail('ws-2', 'node-2', 'Other workspace node');
    const selectWorkspace = await render(store, 'ws-1');
    const respond = vi.fn();

    act(() => window.dispatchEvent(new CustomEvent('canvas:activate-dock-tab', {
      detail: {
        tabId: 'node-detail:ws-2:node-2',
        dockWorkspaceId: 'ws-2',
        tab: { id: 'node-detail:ws-2:node-2', kind: 'node-detail', title: 'Other workspace node', workspaceId: 'ws-2', nodeId: 'node-2' },
        respond,
      },
    })));

    expect(selectWorkspace).not.toHaveBeenCalled();
    expect(store.getSnapshot()).toMatchObject({ activeTerminalWorkspaceId: 'ws-1', activeTabId: 'node-detail:ws-2:node-2' });
    expect(respond).toHaveBeenCalledWith({ status: 'reopened' });
  });

  it('returns a stale acknowledgement when the tab no longer exists', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-1');
    await render(store, 'ws-1');

    act(() => onActivateTab?.({
      requestId: 'req-stale',
      workspaceId: 'ws-1',
      tabId: 'missing',
    }));

    expect(reportTabActivation).toHaveBeenCalledWith({
      requestId: 'req-stale',
      workspaceId: 'ws-1',
      tabId: 'missing',
      ok: false,
      error: 'stale',
    });
  });

  it('reopens a closed historical link from its persisted URL identity', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-1');
    store.openLink('https://example.com/docs');
    const tabId = store.getSnapshot().activeTabId;
    store.close(tabId);
    await render(store, 'ws-1');
    const respond = vi.fn();

    act(() => window.dispatchEvent(new CustomEvent('canvas:activate-dock-tab', {
      detail: {
        tabId,
        dockWorkspaceId: 'ws-1',
        tab: {
          id: tabId,
          kind: 'link',
          title: 'Product docs',
          url: 'https://example.com/docs',
          workspaceId: 'ws-1',
          dockWorkspaceId: 'ws-1',
        },
        respond,
      },
    })));

    expect(respond).toHaveBeenCalledWith({ status: 'reopened' });
    expect(store.getSnapshot().tabs).toContainEqual(expect.objectContaining({
      kind: 'link',
      url: 'https://example.com/docs',
    }));
    expect(store.getSnapshot()).toMatchObject({ activeTabId: tabId, expanded: true });
  });

  it('does not reopen an unsafe URL forged into a historical mention', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-1');
    await render(store, 'ws-1');
    const respond = vi.fn();

    act(() => window.dispatchEvent(new CustomEvent('canvas:activate-dock-tab', {
      detail: {
        tabId: 'link:forged',
        dockWorkspaceId: 'ws-1',
        tab: {
          id: 'link:forged',
          kind: 'link',
          title: 'Forged link',
          url: 'javascript://alert(1)',
          dockWorkspaceId: 'ws-1',
        },
        respond,
      },
    })));

    expect(respond).toHaveBeenCalledWith({ status: 'stale' });
    expect(store.getSnapshot().tabs).toHaveLength(0);
  });

  it('reopens a foreign historical link in the current scope without changing ownership', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-1');
    const selectWorkspace = await render(store, 'ws-1');
    const respond = vi.fn();
    const tab = {
      id: 'link:historical',
      kind: 'link' as const,
      title: 'Historical docs',
      url: 'https://example.com/historical',
      workspaceId: 'ws-2',
      dockWorkspaceId: 'ws-2',
    };

    act(() => window.dispatchEvent(new CustomEvent('canvas:activate-dock-tab', {
      detail: { tabId: tab.id, dockWorkspaceId: 'ws-2', tab, respond },
    })));
    expect(selectWorkspace).not.toHaveBeenCalled();
    expect(store.getSnapshot().activeTerminalWorkspaceId).toBe('ws-1');

    expect(respond).toHaveBeenCalledWith({ status: 'reopened' });
    expect(store.getSnapshot().tabs).toContainEqual(expect.objectContaining({
      kind: 'link',
      url: 'https://example.com/historical',
    }));
  });

  it('reports an unavailable workspace when the host rejects a stale workspace id', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-1');
    const selectWorkspace = vi.fn(() => false);
    await render(store, 'ws-1', selectWorkspace);

    act(() => onActivateTab?.({
      requestId: 'req-unknown-workspace',
      workspaceId: 'deleted-workspace',
      tabId: 'stale-tab',
    }));

    expect(selectWorkspace).toHaveBeenCalledWith('deleted-workspace');
    expect(reportTabActivation).toHaveBeenCalledWith({
      requestId: 'req-unknown-workspace',
      workspaceId: 'deleted-workspace',
      tabId: 'stale-tab',
      ok: false,
      error: 'workspace-unavailable',
    });
  });
});
