// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DockPanes } from '../DockPanes';
import { CHAT_TAB_ID, DockStore, TERMINAL_TAB_ID } from '../dock-store';
import { I18nProvider } from '../../../i18n';

// Capture the props each LinkTabView renders with (the real one lazy-loads a
// live <webview>, which has no place in a happy-dom test).
const latestLinkTabProps = vi.hoisted(() => new Map<string, { mountWebview?: boolean }>());
vi.mock('../../LinkDrawer', () => ({
  LinkTabView: (props: { tabId?: string; mountWebview?: boolean }) => {
    if (props.tabId) latestLinkTabProps.set(props.tabId, { mountWebview: props.mountWebview });
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
    flushSync(() => root?.render(
      <I18nProvider><DockPanes
        store={store}
        state={store.getSnapshot()}
        activePaneId={CHAT_TAB_ID}
        splitTabId={TERMINAL_TAB_ID}
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

    mount.querySelector('.right-dock__pane--terminal')?.dispatchEvent(
      new FocusEvent('focusin', { bubbles: true }),
    );
    expect(store.getSnapshot().activeTabId).toBe(TERMINAL_TAB_ID);

    mount.querySelector('.right-dock__pane--chat')?.dispatchEvent(
      new FocusEvent('focusin', { bubbles: true }),
    );
    expect(store.getSnapshot().activeTabId).toBe(CHAT_TAB_ID);
  });
});

describe('DockPanes lazy link-tab webview mount', () => {
  const renderPanes = (store: DockStore, activePaneId: string | null) => {
    flushSync(() => root?.render(
      <I18nProvider><DockPanes
        store={store}
        state={store.getSnapshot()}
        activePaneId={activePaneId}
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
    expect(latestLinkTabProps.get(tabB.id)?.mountWebview).toBe(false);

    // Activating the second tab mounts its webview...
    renderPanes(store, tabB.id);
    await vi.waitFor(() => expect(latestLinkTabProps.get(tabB.id)?.mountWebview).toBe(true));

    // ...and switching away keeps it mounted (no reload on return).
    renderPanes(store, tabA.id);
    await vi.waitFor(() => expect(latestLinkTabProps.get(tabA.id)?.mountWebview).toBe(true));
    expect(latestLinkTabProps.get(tabB.id)?.mountWebview).toBe(true);
  });
});
