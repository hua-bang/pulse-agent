// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../../i18n';
import { DockCreationControls } from '../DockCreationControls';
import { DockStore } from '../state/dock-store';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let mount: HTMLDivElement | null = null;

beforeAll(async () => {
  // Warm the module cache so React.lazy settles within the interaction's act.
  await import('../tabs/NewDockTabMenu');
});

afterEach(() => {
  act(() => root?.unmount());
  mount?.remove();
  document.querySelectorAll('.right-dock__new-tab-panel').forEach((node) => node.remove());
  vi.restoreAllMocks();
  root = null;
  mount = null;
});

const renderControls = (rootFolder?: string) => {
  const store = new DockStore();
  store.setActiveWorkspace('workspace-1');
  const newLink = vi.spyOn(store, 'newLink');
  const newTerminal = vi.spyOn(store, 'newTerminal');
  mount = document.createElement('div');
  document.body.appendChild(mount);
  root = createRoot(mount);
  act(() => root?.render(
    <I18nProvider>
      <DockCreationControls
        store={store}
        workspaces={[{ id: 'workspace-1', name: 'Workspace', rootFolder }]}
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
  return { trigger, newLink, newTerminal, store };
};

const waitForMenu = async () => {
  await act(async () => {
    await import('../tabs/NewDockTabMenu');
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
      'New web tab',
      'New terminal',
      'Open folder…',
      'Open canvas',
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


it('opens a selected folder, while cancellation and scope changes leave tabs untouched', async () => {
  const original = window.canvasWorkspace;
  let finish: (value: { ok: boolean; canceled?: boolean; folderPath?: string }) => void = () => undefined;
  const openFolder = vi.fn(() => new Promise<{ ok: boolean; canceled?: boolean; folderPath?: string }>(resolve => { finish = resolve; }));
  Object.defineProperty(window, 'canvasWorkspace', { configurable: true, value: { dialog: { openFolder } } });
  try {
    const { trigger, store } = renderControls();
    const choose = async () => {
      act(() => trigger.click());
      const menu = await waitForMenu();
      const button = [...menu.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Open folder…');
      if (!button) throw new Error('Expected folder action');
      act(() => button.click());
    };
    await choose();
    await act(async () => finish({ ok: true, canceled: true }));
    expect(store.getSnapshot().tabs).toHaveLength(0);
    await choose();
    act(() => store.setActiveWorkspace('other'));
    await act(async () => finish({ ok: true, folderPath: '/previous-scope' }));
    expect(store.getSnapshot().tabs).toHaveLength(0);
    await choose();
    await act(async () => finish({ ok: true, folderPath: '/project' }));
    expect(store.getSnapshot().tabs[0]).toMatchObject({ kind: 'folder', folderPath: '/project' });
    await choose();
    expect(openFolder).toHaveBeenCalledTimes(3);
    expect(store.getSnapshot().tabs).toHaveLength(1);
  } finally {
    Object.defineProperty(window, 'canvasWorkspace', { configurable: true, value: original });
  }
});


it('opens the bound workspace directory without showing a picker and reuses its single tab', async () => {
  const original = window.canvasWorkspace;
  const picker = vi.fn();
  Object.defineProperty(window, 'canvasWorkspace', { configurable: true, value: { dialog: { openFolder: picker } } });
  try {
    const { trigger, store } = renderControls('/bound/project');
    for (let attempt = 0; attempt < 2; attempt++) {
      act(() => trigger.click());
      const menu = await waitForMenu();
      const button = [...menu.querySelectorAll<HTMLButtonElement>('button')].find(b => b.textContent === 'Open folder…');
      await act(async () => button?.click());
    }
    expect(picker).not.toHaveBeenCalled();
    expect(store.getSnapshot().tabs).toEqual([{ id: 'folder', kind: 'folder', title: 'project', folderPath: '/bound/project' }]);
  } finally {
    Object.defineProperty(window, 'canvasWorkspace', { configurable: true, value: original });
  }
});
