// @vitest-environment happy-dom
import { act, useLayoutEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShellPortProvider, type AppShellPort } from '../../../../../shared/appShell';
import { I18nProvider } from '../../../../../i18n';
import type { ToastInput } from '../../../../../types/ui-interaction';
import { RightDockProvider, useDockContext } from '../context';
import { DockStore } from '../state/dock-store';
import { createDockSessionPersistence } from '../state/dock-session-persistence';
import { DockAutoCloseToasts } from '../tabs/DockAutoCloseToasts';
import { DOCK_TAB_LIMIT, IDLE_TAB_MS } from '../tabs/dock-tab-cleanup';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let store: DockStore | null = null;
const notify = vi.fn<[ToastInput], string>(() => 'toast');
const appShell = { notify } as unknown as AppShellPort;

// Mirrors App: RightDock enters the workspace before the toast bridge subscribes.
const EnterWorkspace = () => {
  const context = useDockContext();
  store = context.store;
  useLayoutEffect(() => context.store.setActiveWorkspace('ws-a'), [context.store]);
  return null;
};

const render = () => {
  root = createRoot(document.createElement('div'));
  act(() => root?.render(
    <I18nProvider><AppShellPortProvider value={appShell}><RightDockProvider>
      <EnterWorkspace />
      <DockAutoCloseToasts />
    </RightDockProvider></AppShellPortProvider></I18nProvider>,
  ));
};

const titles = () => store?.getSnapshot().tabs.map((tab) => tab.title) ?? [];

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  store = null;
  notify.mockClear();
  window.localStorage.clear();
  vi.useRealTimers();
});

describe('DockAutoCloseToasts', () => {
  it('reports the first-visit cleanup after launch and restores its web tabs', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(0);
    const before = new DockStore(createDockSessionPersistence(window.localStorage));
    before.setActiveWorkspace('ws-a');
    for (const page of ['a', 'b', 'c']) before.openLink(`https://${page}.example`);

    vi.setSystemTime(IDLE_TAB_MS + 1);
    render();
    expect(titles()).toEqual(['https://c.example']);
    expect(notify).toHaveBeenCalledTimes(1);
    const toast = notify.mock.calls[0][0];
    expect(toast.title).toMatch(/2/);

    act(() => toast.action?.onClick());
    expect(titles()).toEqual(['https://a.example', 'https://b.example', 'https://c.example']);
    expect(store?.getSnapshot().activeTabId).toBe(store?.getSnapshot().tabs[2]?.id);
  });

  it('reports a cap close without a restore action', () => {
    render();
    act(() => {
      for (let index = 0; index <= DOCK_TAB_LIMIT; index += 1) store?.openLink(`https://page-${index}.example`);
    });
    expect(titles()).toHaveLength(DOCK_TAB_LIMIT);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0][0].action).toBeUndefined();
  });
});
