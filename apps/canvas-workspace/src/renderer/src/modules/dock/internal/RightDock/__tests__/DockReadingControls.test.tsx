// @vitest-environment happy-dom
import { act, useSyncExternalStore } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { DockReadingControls } from '../DockReadingControls';
import { CHAT_TAB_ID, DockStore } from '../dock-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | null = null;
let mount: HTMLDivElement | null = null;
afterEach(() => { act(() => root?.unmount()); mount?.remove(); root = null; });
const View = ({ store, chat }: { store: DockStore; chat: boolean }) => {
  useSyncExternalStore(store.subscribe, store.getSnapshot);
  return <I18nProvider><DockReadingControls store={store} expanded={false} chatTabEnabled={chat}
    hasContent returnLabel="Back" onExpand={() => undefined} onReturn={() => undefined} /></I18nProvider>;
};
const setup = async (store: DockStore, chat: boolean) => {
  mount = document.createElement('div'); document.body.appendChild(mount); root = createRoot(mount);
  await act(async () => root?.render(<View store={store} chat={chat} />));
  await act(async () => mount!.querySelector<HTMLButtonElement>('.right-dock__comparison-trigger')!.click());
};
const rows = () => [...document.querySelectorAll<HTMLButtonElement>('[role="option"]')];

describe('explicit comparison picker', () => {
  it('compares two web tabs on full-page chat, excludes AI, and switches the focused side', async () => {
    const store = new DockStore();
    store.openLink('https://first.example'); const first = store.getSnapshot().activeTabId;
    store.openLink('https://second.example'); const second = store.getSnapshot().activeTabId;
    await setup(store, false);
    expect(store.getSnapshot().splitTabIds).toBeUndefined();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('first.example');
    expect(document.body.textContent).not.toContain('Pulse Agent');
    act(() => rows()[0].click());
    expect(store.getSnapshot().splitTabIds).toEqual([second, first]);
    act(() => store.activate(first));
    act(() => store.openLink('https://third.example'));
    expect(store.getSnapshot().splitTabIds).toEqual([second, store.getSnapshot().activeTabId]);
    act(() => mount!.querySelector<HTMLButtonElement>('.right-dock__split-toggle')!.click());
    expect(store.getSnapshot().splitTabIds).toBeUndefined();
  });
  it('offers AI on Canvas only after an explicit choice, not upon opening the picker', async () => {
    const store = new DockStore(); store.openLink('https://first.example');
    const page = store.getSnapshot().activeTabId;
    await setup(store, true);
    expect(store.getSnapshot().splitTabIds).toBeUndefined();
    expect(rows()).toHaveLength(1);
    expect(rows()[0].textContent).toContain('Pulse Agent');
    act(() => rows()[0].click());
    expect(store.getSnapshot().splitTabIds).toEqual([page, CHAT_TAB_ID]);
  });
  it('explains when no second tab is available instead of silently opening AI', async () => {
    const store = new DockStore(); store.openLink('https://only.example');
    await setup(store, false);
    expect(rows()).toHaveLength(0);
    expect(document.querySelector('[role="status"]')?.textContent).toBe('Open another tab to compare.');
    expect(store.getSnapshot().splitTabIds).toBeUndefined();
  });
  it('never offers another terminal beside the single shared terminal host', async () => {
    const store = new DockStore(); store.openTerminal(); store.newTerminal();
    await setup(store, false);
    expect(rows()).toHaveLength(0);
    expect(store.getSnapshot().splitTabIds).toBeUndefined();
  });
});
