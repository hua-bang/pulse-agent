// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { CLOSE_ACTIVE_TAB_EVENT } from '../../shortcuts/useAppShortcuts';
import { WorkspaceTabs } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const workspaces = [
  { id: 'a', name: 'Alpha' },
  { id: 'b', name: 'Beta' },
  { id: 'c', name: 'Gamma' },
];

let host: HTMLDivElement;
let root: Root;
let onSelect: ReturnType<typeof vi.fn>;
let onOpenLauncher: ReturnType<typeof vi.fn>;
let onCreate: ReturnType<typeof vi.fn>;
let onTogglePanel: ReturnType<typeof vi.fn>;

const render = (activeId: string, list = workspaces, panelCollapsed = false) => act(() => root.render(
  <I18nProvider>
    <WorkspaceTabs
      workspaces={list}
      activeId={activeId}
      onSelect={onSelect}
      onCreate={onCreate}
      onOpenLauncher={onOpenLauncher}
      panelCollapsed={panelCollapsed}
      onTogglePanel={onTogglePanel}
    />
  </I18nProvider>,
));

const openPicker = () => act(async () => {
  host.querySelector<HTMLButtonElement>('[aria-label="Open a workspace"]')!.click();
});

const pickerItems = () => [...document.querySelectorAll('.workspace-picker__item')]
  .map((item) => item.textContent);

const tabNames = () => [...host.querySelectorAll('.workspace-tabs__select')].map((tab) => tab.textContent);

beforeEach(() => {
  window.localStorage.clear();
  onSelect = vi.fn();
  onOpenLauncher = vi.fn();
  onCreate = vi.fn();
  onTogglePanel = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

describe('WorkspaceTabs', () => {
  it('opens a tab for each workspace that becomes active and keeps them open', async () => {
    await render('a');
    await render('c');
    expect(tabNames()).toEqual(['Alpha', 'Gamma']);
    expect(host.querySelector('[aria-current="page"]')?.textContent).toBe('Gamma');
    expect(JSON.parse(window.localStorage.getItem('pulse-canvas.open-workspace-tabs')!)).toEqual(['a', 'c']);
    // The launcher orders its workspace cards by this recency list.
    expect(JSON.parse(window.localStorage.getItem('pulse-canvas.recent-workspaces')!)).toEqual(['c', 'a']);

    await act(async () => host.querySelector<HTMLButtonElement>('.workspace-tabs__select')!.click());
    expect(onSelect).toHaveBeenCalledWith('a');
  });

  it('closes other tabs from the tab context menu and selects the kept tab', async () => {
    window.localStorage.setItem('pulse-canvas.open-workspace-tabs', JSON.stringify(['a', 'b', 'c']));
    await render('a');
    const betaTab = host.querySelectorAll<HTMLElement>('.workspace-tabs__tab')[1];
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    await act(async () => { betaTab.dispatchEvent(event); });
    expect(event.defaultPrevented).toBe(true);
    const closeOthers = await vi.waitFor(() => {
      const item = [...document.querySelectorAll<HTMLButtonElement>('.workspace-tabs__menu [role="menuitem"]')]
        .find((button) => button.textContent === 'Close other tabs');
      if (!item) throw new Error('menu not open');
      return item;
    });

    await act(async () => closeOthers.click());

    expect(tabNames()).toEqual(['Beta']);
    expect(onSelect).toHaveBeenCalledWith('b');
  });

  it('shows the neighbour after closing the active tab, and the launcher after the last', async () => {
    window.localStorage.setItem('pulse-canvas.open-workspace-tabs', JSON.stringify(['a', 'b']));
    await render('b');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Beta"]')!.click());
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(tabNames()).toEqual(['Alpha']);

    await render('a');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Alpha"]')!.click());
    expect(onOpenLauncher).toHaveBeenCalledTimes(1);
    expect(tabNames()).toEqual([]);
  });

  it('closes the active tab when the shortcut layer asks', async () => {
    window.localStorage.setItem('pulse-canvas.open-workspace-tabs', JSON.stringify(['a', 'b']));
    await render('b');
    await act(async () => window.dispatchEvent(new Event(CLOSE_ACTIVE_TAB_EVENT)));
    expect(onSelect).toHaveBeenCalledWith('a');
    expect(tabNames()).toEqual(['Alpha']);
  });

  it('closing a background tab keeps the current workspace', async () => {
    window.localStorage.setItem('pulse-canvas.open-workspace-tabs', JSON.stringify(['a', 'b']));
    await render('b');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Alpha"]')!.click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(tabNames()).toEqual(['Beta']);
  });

  it('keeps tab widths while closing in a row, until the pointer leaves the bar', async () => {
    window.localStorage.setItem('pulse-canvas.open-workspace-tabs', JSON.stringify(['a', 'b', 'c']));
    await render('c');
    const list = host.querySelector<HTMLElement>('.workspace-tabs__list')!;
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Alpha"]')!.click());
    expect(list.dataset.frozen).toBe('true');
    expect(list.style.getPropertyValue('--tab-frozen-width')).toMatch(/px$/);

    await act(async () => {
      host.querySelector('.workspace-tabs')!.dispatchEvent(new MouseEvent('mouseout', { bubbles: true }));
    });
    expect(list.dataset.frozen).toBeUndefined();
  });

  it('sizes tabs from the tab count and scrolls the active tab into view', async () => {
    const scrolled: string[] = [];
    const spy = vi.spyOn(HTMLElement.prototype, 'scrollIntoView')
      .mockImplementation(function (this: HTMLElement) { scrolled.push(this.textContent ?? ''); });
    await render('a');
    await render('c');
    const list = host.querySelector<HTMLElement>('.workspace-tabs__list')!;
    expect(list.style.getPropertyValue('--tab-count')).toBe('2');
    expect(scrolled.at(-1)).toBe('Gamma');
    spy.mockRestore();
  });

  it('drops tabs of deleted workspaces', async () => {
    window.localStorage.setItem('pulse-canvas.open-workspace-tabs', JSON.stringify(['a', 'gone']));
    await render('a');
    expect(tabNames()).toEqual(['Alpha']);
  });

  it('+ lists workspaces by recency, filters them, and opens the chosen one', async () => {
    window.localStorage.setItem('pulse-canvas.recent-workspaces', JSON.stringify(['c']));
    await render('a');
    await openPicker();
    // 'a' became most recent on render; 'b' was never opened.
    expect(pickerItems()).toEqual(['Alpha', 'Gamma', 'Beta', 'New workspace', 'Pulse Agent']);

    const search = document.querySelector<HTMLInputElement>('.workspace-picker__search')!;
    expect(document.activeElement).toBe(search);
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
    await act(async () => {
      setter?.call(search, 'gam');
      search.dispatchEvent(new Event('input', { bubbles: true }));
    });
    expect(pickerItems()).toEqual(['Gamma', 'New workspace', 'Pulse Agent']);
    await act(async () => {
      search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    expect(onSelect).toHaveBeenCalledWith('c');
    expect(document.querySelector('.workspace-picker')).toBeNull();
  });

  it('+ also creates a workspace or goes home', async () => {
    await render('a');
    await openPicker();
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.workspace-picker__item')]
      .find((item) => item.textContent === 'New workspace')!.click());
    expect(onCreate).toHaveBeenCalledTimes(1);
    await openPicker();
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('.workspace-picker__item')]
      .find((item) => item.textContent === 'Pulse Agent')!.click());
    expect(onOpenLauncher).toHaveBeenCalledTimes(1);
  });

  it('offers a way back to the workspace panel only while it is closed', async () => {
    await render('a');
    expect(host.querySelector('.workspace-tabs__panel')).toBeNull();
    await render('a', workspaces, true);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Expand sidebar"]')!.click());
    expect(onTogglePanel).toHaveBeenCalledTimes(1);
  });
});
