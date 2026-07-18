// @vitest-environment happy-dom
import { flushSync } from 'react-dom';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { DockPanes } from '../DockPanes';
import { CHAT_TAB_ID, DockStore, TERMINAL_TAB_ID } from '../dock-store';
import { I18nProvider } from '../../../i18n';

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

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
