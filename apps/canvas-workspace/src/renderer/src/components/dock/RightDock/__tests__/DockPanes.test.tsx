// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockPanes } from '../DockPanes';
import { CHAT_TAB_ID, DockStore, TERMINAL_TAB_ID } from '../dock-store';
import { dockPaneElementId, dockTabElementId } from '../dock-tab-ids';
import { I18nProvider } from '../../../../i18n';
import type { AgentContextTabRef } from '../../../../types';

const latestTabChatActionProps = vi.hoisted(() => new Map<string, {
  tab: AgentContextTabRef;
  targetWorkspaceId: string;
}>());
vi.mock('../TabChatAction', () => ({
  TabChatAction: (props: { tab: AgentContextTabRef; targetWorkspaceId: string }) => {
    latestTabChatActionProps.set(props.tab.id, props);
    return <button type="button" data-tab-chat-action={props.tab.id}>Ask AI</button>;
  },
}));

// Capture the props each LinkTabView renders with (the real one lazy-loads a
// live <webview>, which has no place in a happy-dom test).
const latestLinkTabProps = vi.hoisted(() => new Map<string, { mountWebview?: boolean; active?: boolean }>());
vi.mock('../../LinkDrawer', () => ({
  LinkTabView: (props: {
    tabId?: string;
    mountWebview?: boolean;
    active?: boolean;
    activeWorkspaceId?: string;
  }) => {
    // Keyed by workspace too: the same tab id can exist in two workspaces, and
    // retained panes render alongside the live ones.
    if (props.tabId) latestLinkTabProps.set(`${props.activeWorkspaceId}::${props.tabId}`, {
      mountWebview: props.mountWebview,
      active: props.active,
    });
    return null;
  },
}));

const latestCanvasPreviewProps = vi.hoisted(() => new Map<string, {
  editingAllowed?: boolean;
  active?: boolean;
  onNodesChange?: unknown;
  onSelectionChange?: unknown;
}>());
vi.mock('../CanvasPreview', () => ({
  CanvasPreview: (props: {
    workspaceId: string;
    editingAllowed?: boolean;
    active?: boolean;
    onNodesChange?: unknown;
    onSelectionChange?: unknown;
  }) => {
    latestCanvasPreviewProps.set(props.workspaceId, props);
    return <div data-canvas-preview={props.workspaceId} />;
  },
}));

/** Props the LinkTabView for `tabId` last rendered with, in `workspaceId`. */
const propsFor = (tabId: string, workspaceId = 'ws1') =>
  latestLinkTabProps.get(`${workspaceId}::${tabId}`);

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

beforeEach(() => {
  latestLinkTabProps.clear();
  latestTabChatActionProps.clear();
  latestCanvasPreviewProps.clear();
});

afterEach(() => {
  flushSync(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

describe('DockPanes split focus', () => {
  it('moves active-view focus between Pulse AI and Terminal for keyboard focus', () => {
    const store = new DockStore();
    store.openTerminal();
    store.toggleSplitView();
    store.activate(CHAT_TAB_ID);
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    const onDividerKeyDown = vi.fn();
    flushSync(() => root?.render(
      <I18nProvider><DockPanes
        store={store}
        state={store.getSnapshot()}
        activePaneId={CHAT_TAB_ID}
        dockVisible
        splitTabId={TERMINAL_TAB_ID}
        chatTabEnabled
        splitContentWidth={320}
        splitDividerWidth={6}
        splitMinContentWidth={280}
        splitMaxContentWidth={440}
        onDividerMouseDown={() => undefined}
        onDividerKeyDown={onDividerKeyDown}
        setChatHost={() => undefined}
        setTerminalHost={() => undefined}
        terminalHostMounted
        activeWorkspaceId="ws1"
        workspaces={[]}
        onOpenNodePage={() => undefined}
        pinUrlReference={() => undefined}
        onAddDomSelectionToChat={async () => ({ status: 'unavailable', target: null })}
      /></I18nProvider>,
    ));

    mount.querySelector('.right-dock__pane--terminal')?.dispatchEvent(
      new FocusEvent('focusin', { bubbles: true }),
    );
    expect(store.getSnapshot().activeTabId).toBe(TERMINAL_TAB_ID);

    mount.querySelector('.right-dock__pane--chat')?.dispatchEvent(
      new FocusEvent('focusin', { bubbles: true }),
    );
    expect(store.getSnapshot().activeTabId).toBe(CHAT_TAB_ID);

    const divider = mount.querySelector<HTMLElement>('.right-dock__split-divider')!;
    expect(divider.tabIndex).toBe(0);
    expect(divider.getAttribute('aria-valuemin')).toBe('280');
    expect(divider.getAttribute('aria-valuemax')).toBe('440');
    expect(divider.getAttribute('aria-valuenow')).toBe('320');
    divider.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'ArrowRight',
      bubbles: true,
    }));
    expect(onDividerKeyDown).toHaveBeenCalledTimes(1);
  });
});

describe('DockPanes lazy link-tab webview mount', () => {
  const renderPanes = (
    store: DockStore,
    activePaneId: string | null,
    activeWorkspaceId = 'ws1',
    dockVisible = true,
  ) => {
    flushSync(() => root?.render(
      <I18nProvider><DockPanes
        store={store}
        state={store.getSnapshot()}
        activePaneId={activePaneId}
        dockVisible={dockVisible}
        chatTabEnabled
        splitContentWidth={320}
        splitDividerWidth={6}
        onDividerMouseDown={() => undefined}
        setChatHost={() => undefined}
        setTerminalHost={() => undefined}
        terminalHostMounted={false}
        activeWorkspaceId={activeWorkspaceId}
        workspaces={[]}
        onOpenNodePage={() => undefined}
        pinUrlReference={() => undefined}
        onAddDomSelectionToChat={async () => ({ status: 'unavailable', target: null })}
      /></I18nProvider>,
    ));
  };

  it('mounts the webview only for tabs that have been active, and never unmounts', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws1');
    store.openLink('https://a.example/');
    store.openLink('https://b.example/');
    const [tabA, tabB] = store.getSnapshot().tabs;
    // Startup-restore shape: several restored link tabs, only one active.
    store.activate(tabA.id);

    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    renderPanes(store, tabA.id);

    await vi.waitFor(() => expect(latestLinkTabProps.size).toBe(2));
    expect(propsFor(tabA.id)?.mountWebview).toBe(true);
    expect(propsFor(tabA.id)?.active).toBe(true);
    expect(propsFor(tabB.id)?.mountWebview).toBe(false);
    expect(propsFor(tabB.id)?.active).toBe(false);

    // Activating the second tab mounts its webview...
    renderPanes(store, tabB.id);
    await vi.waitFor(() => expect(propsFor(tabB.id)?.mountWebview).toBe(true));
    expect(propsFor(tabA.id)?.active).toBe(false);
    expect(propsFor(tabB.id)?.active).toBe(true);

    // ...and switching away keeps it mounted (no reload on return).
    renderPanes(store, tabA.id);
    await vi.waitFor(() => expect(propsFor(tabA.id)?.mountWebview).toBe(true));
    expect(propsFor(tabB.id)?.mountWebview).toBe(true);
  });

  it('does not cold-mount a restored tab while collapsed and backgrounds it after collapse', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws1');
    store.openLink('https://a.example/');
    const [tab] = store.getSnapshot().tabs;

    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);

    renderPanes(store, tab.id, 'ws1', false);
    await vi.waitFor(() => expect(propsFor(tab.id)).toBeDefined());
    expect(propsFor(tab.id)?.mountWebview).toBe(false);
    expect(propsFor(tab.id)?.active).toBe(false);

    renderPanes(store, tab.id, 'ws1', true);
    await vi.waitFor(() => expect(propsFor(tab.id)?.mountWebview).toBe(true));
    expect(propsFor(tab.id)?.active).toBe(true);

    renderPanes(store, tab.id, 'ws1', false);
    expect(propsFor(tab.id)?.mountWebview).toBe(true);
    expect(propsFor(tab.id)?.active).toBe(false);
  });

  it('keeps a left workspace\'s tabs mounted, so switching back does not reload', async () => {
    // The point of retention: a canvas switch used to unmount every guest, so
    // returning reloaded each page and lost its scroll, form state and login.
    const store = new DockStore();
    store.setActiveWorkspace('ws1');
    store.openLink('https://a.example/');
    const [tabA] = store.getSnapshot().tabs;

    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    renderPanes(store, tabA.id);
    await vi.waitFor(() => expect(propsFor(tabA.id)?.mountWebview).toBe(true));

    store.setActiveWorkspace('ws2');
    renderPanes(store, store.getSnapshot().activeTabId, 'ws2');

    // Still rendered, still mounted — but hidden and inactive, so the
    // lifecycle ladder throttles it like any background tab.
    expect(propsFor(tabA.id)?.mountWebview).toBe(true);
    expect(propsFor(tabA.id)?.active).toBe(false);
    expect(mount.querySelectorAll('.right-dock__pane--retained')).toHaveLength(1);

    // And coming back needs no remount.
    store.setActiveWorkspace('ws1');
    renderPanes(store, tabA.id);
    expect(propsFor(tabA.id)?.mountWebview).toBe(true);
    expect(mount.querySelectorAll('.right-dock__pane--retained')).toHaveLength(0);
  });

  it('survives the render where the prop has switched but the store has not', async () => {
    // `RightDock` calls setActiveWorkspace from a LAYOUT EFFECT, so React
    // commits one render with the new `activeWorkspaceId` prop against the old
    // store state. Keying the mounted-pane set off the prop there prunes every
    // real key as "not live", and the retained panes arrive unmounted — the
    // guests die and retention silently does nothing. Reproduced on a real
    // workspace switch; the fix is to key off the store's own snapshot.
    const store = new DockStore();
    store.setActiveWorkspace('ws1');
    store.openLink('https://a.example/');
    const [tabA] = store.getSnapshot().tabs;

    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    renderPanes(store, tabA.id, 'ws1');
    await vi.waitFor(() => expect(propsFor(tabA.id)?.mountWebview).toBe(true));

    // The transient frame: prop already on ws2, store still on ws1.
    renderPanes(store, tabA.id, 'ws2');
    // …then the layout effect lands and the store switches.
    store.setActiveWorkspace('ws2');
    renderPanes(store, store.getSnapshot().activeTabId, 'ws2');

    expect(propsFor(tabA.id)?.mountWebview).toBe(true);
  });

  it('re-arms the lazy gate for tabs evicted past the retention limit', async () => {
    // Retention is bounded (RETAINED_WORKSPACE_LIMIT). Once a workspace falls
    // off the tail its guests DO unmount, and its keys must leave the
    // "has been visible" set — otherwise returning remounts every tab the
    // user ever opened there in one commit, the cold-start burst the lazy
    // gate exists to prevent.
    const store = new DockStore();
    store.setActiveWorkspace('ws1');
    store.openLink('https://a.example/');
    store.openLink('https://b.example/');
    const [tabA, tabB] = store.getSnapshot().tabs;
    store.activate(tabA.id);
    store.activate(tabB.id);

    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);
    renderPanes(store, tabA.id);
    renderPanes(store, tabB.id);
    await vi.waitFor(() => expect(propsFor(tabA.id)?.mountWebview).toBe(true));
    expect(propsFor(tabB.id)?.mountWebview).toBe(true);

    // Three further workspaces, each with a tab of its own, push ws1 off the
    // retention tail. (A workspace with no web tabs retains nothing, so it
    // cannot evict one that has them.)
    for (const id of ['ws2', 'ws3', 'ws4']) {
      store.setActiveWorkspace(id);
      store.openLink(`https://${id}.example/`);
      renderPanes(store, store.getSnapshot().activeTabId, id);
    }
    expect(store.getSnapshot().retainedLinkTabs.map((entry) => entry.workspaceId))
      .not.toContain('ws1');

    latestLinkTabProps.clear();
    store.setActiveWorkspace('ws1');
    renderPanes(store, tabB.id);

    // ws3 and ws4 are still retained alongside ws1's own tabs, so assert on
    // the tabs themselves rather than a total count.
    await vi.waitFor(() => expect(propsFor(tabB.id)?.mountWebview).toBe(true));
    expect(propsFor(tabA.id)?.mountWebview).toBe(false);
  });
});

describe('DockPanes tabpanel relationships', () => {
  it('labels visible chat and terminal panes with their controlling tabs in split view', () => {
    const store = new DockStore();
    store.openTerminal();
    store.toggleSplitView();
    store.activate(CHAT_TAB_ID);
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);

    flushSync(() => root?.render(
      <I18nProvider><DockPanes
        store={store}
        state={store.getSnapshot()}
        activePaneId={CHAT_TAB_ID}
        dockVisible
        splitTabId={TERMINAL_TAB_ID}
        chatTabEnabled
        splitContentWidth={320}
        splitDividerWidth={6}
        onDividerMouseDown={() => undefined}
        setChatHost={() => undefined}
        setTerminalHost={() => undefined}
        terminalHostMounted
        activeWorkspaceId="ws1"
        workspaces={[]}
        onOpenNodePage={() => undefined}
        pinUrlReference={() => undefined}
        onAddDomSelectionToChat={async () => ({ status: 'unavailable', target: null })}
      /></I18nProvider>,
    ));

    const chatPane = mount.querySelector<HTMLElement>('.right-dock__pane--chat')!;
    const terminalPane = mount.querySelector<HTMLElement>('.right-dock__pane--terminal')!;
    expect(chatPane).toMatchObject({
      id: dockPaneElementId(CHAT_TAB_ID),
      role: 'tabpanel',
    });
    expect(chatPane.getAttribute('aria-labelledby')).toBe(dockTabElementId(CHAT_TAB_ID));
    expect(chatPane.getAttribute('aria-hidden')).toBe('false');
    expect(terminalPane).toMatchObject({
      id: dockPaneElementId(TERMINAL_TAB_ID),
      role: 'tabpanel',
    });
    expect(terminalPane.getAttribute('aria-labelledby')).toBe(dockTabElementId(TERMINAL_TAB_ID));
    expect(terminalPane.getAttribute('aria-hidden')).toBe('false');
  });

  it('labels each preview pane and hides inactive panes from the accessibility tree', () => {
    const store = new DockStore();
    store.openNodeDetail('ws1', 'node-1', 'First');
    store.openNodeDetail('ws1', 'node-2', 'Second');
    const [first, second] = store.getSnapshot().tabs;
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);

    flushSync(() => root?.render(
      <I18nProvider><DockPanes
        store={store}
        state={store.getSnapshot()}
        activePaneId={second.id}
        dockVisible
        chatTabEnabled
        splitContentWidth={320}
        splitDividerWidth={6}
        onDividerMouseDown={() => undefined}
        setChatHost={() => undefined}
        setTerminalHost={() => undefined}
        terminalHostMounted={false}
        activeWorkspaceId="ws1"
        workspaces={[]}
        onOpenNodePage={() => undefined}
        pinUrlReference={() => undefined}
        onAddDomSelectionToChat={async () => ({ status: 'unavailable', target: null })}
      /></I18nProvider>,
    ));

    const firstPane = document.getElementById(dockPaneElementId(first.id))!;
    const secondPane = document.getElementById(dockPaneElementId(second.id))!;
    expect(firstPane.getAttribute('role')).toBe('tabpanel');
    expect(firstPane.getAttribute('aria-labelledby')).toBe(dockTabElementId(first.id));
    expect(firstPane.getAttribute('aria-hidden')).toBe('true');
    expect(secondPane.getAttribute('aria-hidden')).toBe('false');
  });
});

describe('DockPanes canvas editing host capability', () => {
  it('passes AI Chat permission and visible-pane activity without persisting either on the tab', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws1');
    store.openCanvasPreview('ws2', 'Research');
    const tab = store.getSnapshot().tabs[0]!;
    const onCanvasNodesChange = vi.fn();
    const onCanvasSelectionChange = vi.fn();
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);

    const render = (dockVisible: boolean) => flushSync(() => root?.render(
      <I18nProvider><DockPanes
        store={store}
        state={store.getSnapshot()}
        activePaneId={tab.id}
        dockVisible={dockVisible}
        chatTabEnabled={false}
        canvasTabEditingAllowed
        onCanvasNodesChange={onCanvasNodesChange}
        onCanvasSelectionChange={onCanvasSelectionChange}
        splitContentWidth={320}
        splitDividerWidth={6}
        onDividerMouseDown={() => undefined}
        setChatHost={() => undefined}
        setTerminalHost={() => undefined}
        terminalHostMounted={false}
        activeWorkspaceId="ws1"
        workspaces={[{ id: 'ws2', name: 'Research' }]}
        onOpenNodePage={() => undefined}
        pinUrlReference={() => undefined}
        onAddDomSelectionToChat={async () => ({ status: 'unavailable', target: null })}
      /></I18nProvider>,
    ));

    render(true);
    await vi.waitFor(() => expect(latestCanvasPreviewProps.get('ws2')).toBeDefined());
    expect(latestCanvasPreviewProps.get('ws2')).toMatchObject({
      editingAllowed: true,
      active: true,
      onNodesChange: onCanvasNodesChange,
      onSelectionChange: onCanvasSelectionChange,
    });
    expect(store.getSnapshot().tabs[0]).not.toHaveProperty('editingAllowed');

    render(false);
    expect(latestCanvasPreviewProps.get('ws2')?.active).toBe(false);
  });
});

describe('DockPanes whole-tab Chat actions', () => {
  it('offers exact artifact and split-terminal refs without covering terminal content', () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws1');
    store.openArtifact('artifact-scope', 'artifact-1');
    const artifactId = store.getSnapshot().tabs[0]!.id;
    store.openTerminal();
    store.renameTerminal(TERMINAL_TAB_ID, 'Build shell');
    store.toggleSplitView();
    store.activate(CHAT_TAB_ID);
    const state = store.getSnapshot();
    mount = document.createElement('div');
    document.body.appendChild(mount);
    root = createRoot(mount);

    flushSync(() => root?.render(
      <I18nProvider><DockPanes
        store={store}
        state={state}
        activePaneId={CHAT_TAB_ID}
        dockVisible
        splitTabId={state.splitTabId}
        chatTabEnabled
        splitContentWidth={320}
        splitDividerWidth={6}
        onDividerMouseDown={() => undefined}
        setChatHost={() => undefined}
        setTerminalHost={() => undefined}
        terminalHostMounted
        activeWorkspaceId="ws1"
        workspaces={[]}
        onOpenNodePage={() => undefined}
        pinUrlReference={() => undefined}
        onAddDomSelectionToChat={async () => ({ status: 'unavailable', target: null })}
        onAddTabToChat={async () => ({ status: 'unavailable', target: null })}
      /></I18nProvider>,
    ));

    expect(latestTabChatActionProps.get(artifactId)).toMatchObject({
      targetWorkspaceId: 'ws1',
      tab: {
        id: artifactId,
        kind: 'artifact',
        workspaceId: 'artifact-scope',
        dockWorkspaceId: 'ws1',
        artifactId: 'artifact-1',
      },
    });
    expect(latestTabChatActionProps.get(TERMINAL_TAB_ID)).toMatchObject({
      targetWorkspaceId: 'ws1',
      tab: {
        id: TERMINAL_TAB_ID,
        kind: 'terminal',
        title: 'Build shell',
        workspaceId: 'ws1',
        dockWorkspaceId: 'ws1',
        sessionId: 'workspace-terminal:ws1',
        isSplit: true,
      },
    });
    expect(mount.querySelector('.right-dock__pane--terminal [data-tab-chat-action]')).not.toBeNull();
    expect(mount.querySelector('.right-dock__terminal-host--with-chat-action')).not.toBeNull();
    expect(document.getElementById(dockPaneElementId(artifactId))
      ?.querySelector('[data-tab-chat-action]')).not.toBeNull();
  });
});
