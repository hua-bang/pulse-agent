// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyDockBrowserCommand,
  consumeDockPageFocusRequest,
  focusActiveDockTarget,
  FOCUS_DOCK_PAGE_EVENT,
  requestDockPageFocus,
  FOCUS_DOCK_ADDRESS_EVENT,
} from '../dock-browser-commands';
import { DockStore } from '../dock-store';

describe('dock page focus routing', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('qualifies a focus request by workspace as well as tab id', () => {
    const details: unknown[] = [];
    const onFocus = (event: Event) => details.push((event as CustomEvent).detail);
    window.addEventListener(FOCUS_DOCK_PAGE_EVENT, onFocus);

    requestDockPageFocus({ workspaceId: 'ws-live', tabId: 'same-url-tab' });

    expect(details).toEqual([{ workspaceId: 'ws-live', tabId: 'same-url-tab' }]);
    expect(consumeDockPageFocusRequest({
      workspaceId: 'ws-retained',
      tabId: 'same-url-tab',
    })).toBe(false);
    expect(consumeDockPageFocusRequest({
      workspaceId: 'ws-live',
      tabId: 'same-url-tab',
    })).toBe(true);
    window.removeEventListener(FOCUS_DOCK_PAGE_EVENT, onFocus);
  });

  it('keeps a cold-tab focus request until its guest eventually mounts', () => {
    vi.useFakeTimers();
    requestDockPageFocus({ workspaceId: 'ws-slow', tabId: 'cold-tab' });
    vi.advanceTimersByTime(60_000);

    expect(consumeDockPageFocusRequest({ workspaceId: 'ws-slow', tabId: 'cold-tab' }))
      .toBe(true);
    vi.useRealTimers();
  });

  it('hands focus to the resulting page after keyboard switch, close, and reopen', () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws1');
    store.openLink('https://a.example/');
    store.openLink('https://b.example/');
    const [tabA, tabB] = store.getSnapshot().tabs;
    store.activate(tabA.id);
    const details: Array<{ workspaceId: string; tabId: string }> = [];
    const onFocus = (event: Event) => details.push(
      (event as CustomEvent<{ workspaceId: string; tabId: string }>).detail,
    );
    window.addEventListener(FOCUS_DOCK_PAGE_EVENT, onFocus);

    expect(applyDockBrowserCommand(
      'next-tab',
      store,
      store.getSnapshot(),
      'New tab',
    )).toBe(true);
    expect(store.getSnapshot().activeTabId).toBe(tabB.id);

    expect(applyDockBrowserCommand(
      'close-tab',
      store,
      store.getSnapshot(),
      'New tab',
    )).toBe(true);
    expect(store.getSnapshot().activeTabId).toBe(tabA.id);

    expect(applyDockBrowserCommand(
      'reopen-tab',
      store,
      store.getSnapshot(),
      'New tab',
    )).toBe(true);
    expect(details).toEqual([
      { workspaceId: 'ws1', tabId: tabB.id },
      { workspaceId: 'ws1', tabId: tabA.id },
      { workspaceId: 'ws1', tabId: tabB.id },
    ]);
    window.removeEventListener(FOCUS_DOCK_PAGE_EVENT, onFocus);
  });

  it('targets address-bar commands to the exact active workspace tab', () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-command');
    store.openLink('https://example.com/');
    const details: unknown[] = [];
    const listener = (event: Event) => details.push((event as CustomEvent).detail);
    window.addEventListener(FOCUS_DOCK_ADDRESS_EVENT, listener);

    expect(applyDockBrowserCommand(
      'focus-address', store, store.getSnapshot(), 'New tab',
    )).toBe(true);

    expect(details).toEqual([{
      workspaceId: 'ws-command',
      tabId: store.getSnapshot().activeTabId,
    }]);
    window.removeEventListener(FOCUS_DOCK_ADDRESS_EVENT, listener);
  });

  it('focuses the omnibox instead of creating an unclaimable page intent for a blank tab', async () => {
    const store = new DockStore();
    store.setActiveWorkspace('ws-blank');
    store.newLink('New tab');
    const addressDetails: unknown[] = [];
    const pageDetails: unknown[] = [];
    const onAddress = (event: Event) => addressDetails.push((event as CustomEvent).detail);
    const onPage = (event: Event) => pageDetails.push((event as CustomEvent).detail);
    window.addEventListener(FOCUS_DOCK_ADDRESS_EVENT, onAddress);
    window.addEventListener(FOCUS_DOCK_PAGE_EVENT, onPage);

    focusActiveDockTarget(store);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));

    expect(addressDetails).toEqual([{
      workspaceId: 'ws-blank',
      tabId: store.getSnapshot().activeTabId,
    }]);
    expect(pageDetails).toEqual([]);
    expect(consumeDockPageFocusRequest({
      workspaceId: 'ws-blank',
      tabId: store.getSnapshot().activeTabId,
    })).toBe(false);
    window.removeEventListener(FOCUS_DOCK_ADDRESS_EVENT, onAddress);
    window.removeEventListener(FOCUS_DOCK_PAGE_EVENT, onPage);
  });
});
