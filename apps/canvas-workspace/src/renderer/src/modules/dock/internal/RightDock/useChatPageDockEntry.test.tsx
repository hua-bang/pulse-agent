// @vitest-environment happy-dom
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { CHAT_TAB_ID, DockStore } from './state/dock-store';
import { useChatPageDockEntry } from './useChatPageDockEntry';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

// Mirrors RightDock: the scope switch is declared before the page hook.
const Harness = ({ store, view, scopeId }: { store: DockStore; view: string; scopeId: string }) => {
  useLayoutEffect(() => store.setActiveWorkspace(scopeId), [scopeId, store]);
  useChatPageDockEntry(store, view === 'chat', scopeId);
  return null;
};

const render = (store: DockStore, view: string, scopeId: string) => {
  root ??= createRoot(document.createElement('div'));
  act(() => root?.render(<Harness store={store} view={view} scopeId={scopeId} />));
};

afterEach(() => {
  act(() => root?.unmount());
  root = null;
});

describe('useChatPageDockEntry', () => {
  it('collapses on AI Chat and gives Canvas back its dock chat', () => {
    const store = new DockStore();
    render(store, 'canvas', 'ws1');
    store.newLink();
    store.openChat();

    render(store, 'chat', 'ws1');
    expect(store.getSnapshot().expanded).toBe(false);

    store.toggleContentTabs();
    expect(store.getSnapshot().expanded).toBe(true);

    render(store, 'canvas', 'ws1');
    expect(store.getSnapshot()).toMatchObject({ expanded: true, activeTabId: CHAT_TAB_ID });
  });

  it('keeps a collapsed Canvas dock collapsed after the page opened tabs', () => {
    const store = new DockStore();
    render(store, 'canvas', 'ws1');
    store.newLink();
    store.collapse();

    render(store, 'chat', 'ws1');
    store.toggleContentTabs();
    render(store, 'canvas', 'ws1');
    expect(store.getSnapshot().expanded).toBe(false);
  });

  it('collapses each scope the page switches to', () => {
    const store = new DockStore();
    render(store, 'chat', 'ws1');
    store.newLink();
    expect(store.getSnapshot().expanded).toBe(true);

    render(store, 'chat', '__global_chat__');
    store.newLink();
    render(store, 'chat', 'ws1');
    expect(store.getSnapshot()).toMatchObject({ activeTerminalWorkspaceId: 'ws1', expanded: false });
  });
});
