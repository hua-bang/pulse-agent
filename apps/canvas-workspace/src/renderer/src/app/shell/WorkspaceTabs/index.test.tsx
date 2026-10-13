// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
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

const render = (activeId: string, list = workspaces) => act(() => root.render(
  <I18nProvider>
    <WorkspaceTabs workspaces={list} activeId={activeId} onSelect={onSelect} onOpenLauncher={onOpenLauncher} />
  </I18nProvider>,
));

const tabNames = () => [...host.querySelectorAll('.workspace-tabs__select')].map((tab) => tab.textContent);

beforeEach(() => {
  window.localStorage.clear();
  onSelect = vi.fn();
  onOpenLauncher = vi.fn();
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

  it('closing a background tab keeps the current workspace', async () => {
    window.localStorage.setItem('pulse-canvas.open-workspace-tabs', JSON.stringify(['a', 'b']));
    await render('b');
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Close Alpha"]')!.click());
    expect(onSelect).not.toHaveBeenCalled();
    expect(tabNames()).toEqual(['Beta']);
  });

  it('drops tabs of deleted workspaces and opens the launcher from +', async () => {
    window.localStorage.setItem('pulse-canvas.open-workspace-tabs', JSON.stringify(['a', 'gone']));
    await render('a');
    expect(tabNames()).toEqual(['Alpha']);
    await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Open the launcher"]')!.click());
    expect(onOpenLauncher).toHaveBeenCalledTimes(1);
  });
});
