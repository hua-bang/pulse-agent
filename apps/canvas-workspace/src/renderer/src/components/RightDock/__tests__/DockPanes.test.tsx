// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockPanes } from '../DockPanes';
import { CHAT_TAB_ID, DockStore, TERMINAL_TAB_ID } from '../dock-store';
import { dockPaneElementId, dockTabElementId } from '../dock-tab-ids';
import { I18nProvider } from '../../../i18n';

// Capture the props each LinkTabView renders with (the real one lazy-loads a
// live <webview>, which has no place in a happy-dom test).
const latestLinkTabProps = vi.hoisted(() => new Map<string, { mountWebview?: boolean; active?: boolean }>());
vi.mock('../../LinkDrawer', () => ({
  LinkTabView: (props: { tabId?: string; mountWebview?: boolean; active?: boolean }) => {
    if (props.tabId) latestLinkTabProps.set(props.tabId, {
      mountWebview: props.mountWebview,
      active: props.active,
    });
    return null;
  },
}));

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

beforeEach(() => {
  latestLinkTabProps.clear();
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
        onAddDomSelectionToChat={() => undefined}
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
  const renderPanes = (store: DockStore, activePaneId: string | null) => {
    flushSync(() => root?.render(
      <I18nProvider><DockPanes
        store={store}
        state={store.getSnapshot()}
        activePaneId={activePaneId}
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
        onAddDomSelectionToChat={() => undefined}
      /></I18nProvider>,
    ));
  };

  it('mounts the webview only for tabs that have been active, and never unmounts', async () => {
    const store = new DockStore();
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
    expect(latestLinkTabProps.get(tabA.id)?.mountWebview).toBe(true);
    expect(latestLinkTabProps.get(tabA.id)?.active).toBe(true);
    expect(latestLinkTabProps.get(tabB.id)?.mountWebview).toBe(false);
    expect(latestLinkTabProps.get(tabB.id)?.active).toBe(false);

    // Activating the second tab mounts its webview...
    renderPanes(store, tabB.id);
    await vi.waitFor(() => expect(latestLinkTabProps.get(tabB.id)?.mountWebview).toBe(true));
    expect(latestLinkTabProps.get(tabA.id)?.active).toBe(false);
    expect(latestLinkTabProps.get(tabB.id)?.active).toBe(true);

    // ...and switching away keeps it mounted (no reload on return).
    renderPanes(store, tabA.id);
    await vi.waitFor(() => expect(latestLinkTabProps.get(tabA.id)?.mountWebview).toBe(true));
    expect(latestLinkTabProps.get(tabB.id)?.mountWebview).toBe(true);
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
        onAddDomSelectionToChat={() => undefined}
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
        onAddDomSelectionToChat={() => undefined}
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
