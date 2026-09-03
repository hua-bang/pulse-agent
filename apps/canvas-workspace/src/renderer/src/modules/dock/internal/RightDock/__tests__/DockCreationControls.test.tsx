// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { DockCreationControls } from '../DockCreationControls';
import { DockStore } from '../dock-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

beforeAll(async () => {
  // Warm the module cache so React.lazy settles within the interaction's act.
  await import('../NewDockTabMenu');
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  document.querySelectorAll('.right-dock__new-tab-panel').forEach((node) => node.remove());
  vi.restoreAllMocks();
  root = null;
  mount = null;
});

const renderControls = () => {
  const store = new DockStore();
  const newLink = vi.spyOn(store, 'newLink');
  const newTerminal = vi.spyOn(store, 'newTerminal');
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  act(() => root?.render(
    <I18nProvider>
      <DockCreationControls
        store={store}
        workspaces={[]}
        activeWorkspaceId="workspace-1"
        showTerminal
        newTabTitle="New tab"
        mountedWorkspaceIds={new Set()}
        terminalWorkspaceIds={new Set()}
      />
    </I18nProvider>,
  ));
  const trigger = mount.querySelector<HTMLButtonElement>('[aria-label="New tab"]');
  if (!trigger) throw new Error('Expected the new-tab menu trigger');
  return { trigger, newLink, newTerminal };
};

const waitForMenu = async () => {
  await act(async () => {
    await import('../NewDockTabMenu');
    await Promise.resolve();
  });
  await vi.waitFor(() => {
    expect(document.querySelector('.right-dock__new-tab-panel')).not.toBeNull();
  });
  return document.querySelector<HTMLElement>('.right-dock__new-tab-panel')!;
};

describe('DockCreationControls new-tab trigger', () => {
  it('uses one menu-button contract for pointer and native keyboard activation', async () => {
    const { trigger, newLink, newTerminal } = renderControls();

    expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
    expect(trigger.classList.contains('ui-btn--md')).toBe(true);

    act(() => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    const menu = await waitForMenu();

    expect(newLink).not.toHaveBeenCalled();
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(trigger.getAttribute('aria-controls')).toBe(menu.id);

    const menuItems = [...menu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')];
    expect(menuItems.map((item) => item.textContent)).toEqual([
      'Open node',
      'Open canvas',
      'New terminal',
      'New web tab',
    ]);

    const newTerminalTab = menuItems.find((item) => item.textContent === 'New terminal');
    if (!newTerminalTab) throw new Error('Expected the New terminal menu item');
    act(() => newTerminalTab.click());
    expect(newTerminal).toHaveBeenCalledTimes(1);

    act(() => trigger.click());
    const reopenedMenu = await waitForMenu();
    const newWebTab = [...reopenedMenu.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find((item) => item.textContent === 'New web tab');
    if (!newWebTab) throw new Error('Expected the New web tab menu item');
    act(() => newWebTab.click());
    expect(newLink).toHaveBeenCalledWith('New tab');
  });

  it.each(['ArrowDown', 'ArrowUp'])('opens the menu with %s', async (key) => {
    const { trigger, newLink } = renderControls();

    act(() => trigger.dispatchEvent(new KeyboardEvent('keydown', {
      key,
      bubbles: true,
      cancelable: true,
    })));
    await waitForMenu();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(newLink).not.toHaveBeenCalled();
  });

  it('opens the same menu on hover without creating a tab', async () => {
    const { trigger, newLink } = renderControls();
    const group = trigger.closest('.right-dock__new-tab-menu');
    if (!group) throw new Error('Expected the new-tab trigger group');

    act(() => group.dispatchEvent(new MouseEvent('mouseover', {
      bubbles: true,
      cancelable: true,
      relatedTarget: null,
    })));
    await waitForMenu();

    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(newLink).not.toHaveBeenCalled();

    act(() => trigger.click());
    expect(trigger.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('.right-dock__new-tab-panel')).not.toBeNull();
    expect(newLink).not.toHaveBeenCalled();
  });
});
