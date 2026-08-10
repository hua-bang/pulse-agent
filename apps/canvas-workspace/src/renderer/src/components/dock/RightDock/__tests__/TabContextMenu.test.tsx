// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import { TabContextMenu } from '../TabContextMenu';
import { DockStore } from '../dock-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

const seedDock = () => {
  const store = new DockStore();
  store.setActiveWorkspace('ws1');
  store.openLink('https://a.example/');
  store.openLink('https://b.example/');
  store.openLink('https://c.example/');
  return store;
};

const render = (
  store: DockStore,
  tabId: string,
  onClose = vi.fn(),
  onActionComplete = vi.fn(),
) => {
  const state = store.getSnapshot();
  const tab = state.tabs.find((item) => item.id === tabId)!;
  act(() => root?.render(
    <I18nProvider>
      <TabContextMenu
        tab={tab}
        tabs={state.tabs}
        store={store}
        x={0}
        y={0}
        onClose={onClose}
        onActionComplete={onActionComplete}
      />
    </I18nProvider>,
  ));
  return onClose;
};

const rows = () => [...document.querySelectorAll<HTMLButtonElement>('.context-menu-item')];

const click = (text: string) => {
  const row = rows().find((item) => item.textContent?.includes(text));
  if (!row) throw new Error(`no row "${text}" in [${rows().map((r) => r.textContent).join(' | ')}]`);
  act(() => row.click());
};

const urls = (store: DockStore) => store.getSnapshot().tabs
  .map((tab) => (tab.kind === 'link' ? tab.url : tab.id));

beforeEach(() => {
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: { shell: { openExternal: vi.fn() } },
  });
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  root = null;
  mount = null;
});

describe('TabContextMenu', () => {
  it('closes every tab to the right, leaving the target and its left', () => {
    const store = seedDock();
    const [, second] = store.getSnapshot().tabs;
    render(store, second.id);

    click('Close tabs to the right');

    expect(urls(store)).toEqual(['https://a.example/', 'https://b.example/']);
  });

  it('closes all other tabs', () => {
    const store = seedDock();
    const [, second] = store.getSnapshot().tabs;
    render(store, second.id);

    click('Close other tabs');

    expect(urls(store)).toEqual(['https://b.example/']);
  });

  it('leaves every bulk-closed web tab on the reopen stack', () => {
    // Bulk closing must be as undoable as closing one at a time — the whole
    // point of the reopen stack is that no close is a dead end.
    const store = seedDock();
    const [first] = store.getSnapshot().tabs;
    render(store, first.id);

    click('Close other tabs');
    expect(store.canReopenClosedTab()).toBe(true);

    store.reopenClosedTab();
    store.reopenClosedTab();
    expect(urls(store).sort()).toEqual([
      'https://a.example/',
      'https://b.example/',
      'https://c.example/',
    ]);
  });

  it('disables the rows that would do nothing', () => {
    const store = seedDock();
    const tabs = store.getSnapshot().tabs;
    render(store, tabs[tabs.length - 1].id);

    const rightRow = rows().find((row) => row.textContent?.includes('Close tabs to the right'));
    const reopenRow = rows().find((row) => row.textContent?.includes('Reopen closed tab'));
    expect(rightRow?.disabled).toBe(true);
    expect(reopenRow?.disabled).toBe(true);
  });

  it('marks itself as dock-anchored so it is not painted behind the dock', () => {
    const store = seedDock();
    render(store, store.getSnapshot().tabs[0].id);
    expect(document.querySelector('.context-menu--in-dock')).not.toBeNull();
  });

  it('closes the menu after acting', () => {
    const store = seedDock();
    const [first] = store.getSnapshot().tabs;
    const onClose = render(store, first.id);

    click('Close tab');

    expect(onClose).toHaveBeenCalledOnce();
    expect(urls(store)).toEqual(['https://b.example/', 'https://c.example/']);
  });

  it('shields guest pointer input for the lifetime of the menu', () => {
    const guest = document.createElement('webview');
    document.body.appendChild(guest);
    const store = seedDock();
    render(store, store.getSnapshot().tabs[0].id);

    expect(guest.style.pointerEvents).toBe('none');
    act(() => root?.render(null));
    expect(guest.style.pointerEvents).toBe('');
    guest.remove();
  });

  it('restores the active dock target after Escape dismissal', () => {
    const store = seedDock();
    const onClose = vi.fn();
    const onActionComplete = vi.fn();
    render(store, store.getSnapshot().tabs[0].id, onClose, onActionComplete);

    act(() => rows()[0]?.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
    })));

    expect(onClose).toHaveBeenCalledOnce();
    expect(onActionComplete).toHaveBeenCalledOnce();
  });
});
