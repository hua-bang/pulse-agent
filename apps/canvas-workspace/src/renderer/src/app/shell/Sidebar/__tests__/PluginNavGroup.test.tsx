// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import type { PluginNavItem } from '../../../../../../plugins/types';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const shell = vi.hoisted(() => ({
  confirm: vi.fn(),
  notify: vi.fn(),
}));
const market = vi.hoisted(() => ({
  findInstalledListing: vi.fn(),
  uninstallListing: vi.fn(),
}));

vi.mock('../../../../shared/appShell', () => ({ useAppShell: () => shell }));
vi.mock('../../../../modules/plugin-market', () => market);

import PluginNavGroup from '../PluginNavGroup';

const items: PluginNavItem[] = [
  { id: 'sticky-nav', path: '/plugins/sticky', label: 'Sticky Wall', pluginId: 'sticky-wall' },
  { id: 'devtools-nav', path: '/devtools', label: 'Devtools', pluginId: 'devtools' },
];

let host: HTMLDivElement;
let root: Root;
let onNavigate: ReturnType<typeof vi.fn>;

const render = () => act(async () => {
  root.render(
    <I18nProvider>
      <PluginNavGroup items={items} activeView="canvas" onNavigate={onNavigate} />
    </I18nProvider>,
  );
});

const button = (label: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);

const rightClick = async (label: string) => {
  await act(async () => {
    button(label)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, clientX: 10, clientY: 10 }));
  });
  await act(async () => { await Promise.resolve(); });
};

const menuItem = () => document.body.querySelector<HTMLButtonElement>('.sidebar-plugin-nav-menu [role="menuitem"]');

beforeEach(() => {
  window.localStorage.clear();
  shell.confirm.mockReset();
  shell.notify.mockReset();
  market.findInstalledListing.mockReset();
  market.uninstallListing.mockReset();
  onNavigate = vi.fn();
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe('PluginNavGroup', () => {
  it('collapses and expands its entries and remembers the choice', async () => {
    await render();
    expect(button('Sticky Wall')).not.toBeNull();
    const header = host.querySelector<HTMLButtonElement>('.sidebar-plugin-nav__header')!;
    expect(header.getAttribute('aria-expanded')).toBe('true');

    await act(async () => header.click());
    expect(button('Sticky Wall')).toBeNull();
    expect(header.getAttribute('aria-expanded')).toBe('false');
    expect(window.localStorage.getItem('pulse-canvas.plugin-nav-collapsed')).toBe('1');

    await act(async () => header.click());
    expect(button('Sticky Wall')).not.toBeNull();
  });

  it('navigates on click', async () => {
    await render();
    await act(async () => button('Sticky Wall')!.click());
    expect(onNavigate).toHaveBeenCalledWith('/plugins/sticky');
  });

  it('uninstalls an installed plugin after confirmation', async () => {
    market.findInstalledListing.mockResolvedValue({ id: 'listing-1', name: 'sticky-wall' });
    market.uninstallListing.mockResolvedValue({ ok: true });
    shell.confirm.mockResolvedValue(true);
    await render();

    await rightClick('Sticky Wall');
    expect(market.findInstalledListing).toHaveBeenCalledWith('sticky-wall');
    expect(menuItem()!.disabled).toBe(false);

    await act(async () => menuItem()!.click());
    expect(shell.confirm).toHaveBeenCalledWith(expect.objectContaining({ intent: 'danger' }));
    expect(market.uninstallListing).toHaveBeenCalledWith('listing-1');
    expect(shell.notify).toHaveBeenCalledWith(expect.objectContaining({ tone: 'success' }));
  });

  it('does not uninstall when the user cancels', async () => {
    market.findInstalledListing.mockResolvedValue({ id: 'listing-1', name: 'sticky-wall' });
    shell.confirm.mockResolvedValue(false);
    await render();

    await rightClick('Sticky Wall');
    await act(async () => menuItem()!.click());
    expect(market.uninstallListing).not.toHaveBeenCalled();
  });

  it('disables uninstall for a built-in plugin', async () => {
    market.findInstalledListing.mockResolvedValue(null);
    await render();

    await rightClick('Devtools');
    expect(menuItem()!.disabled).toBe(true);
  });
});
