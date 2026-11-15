import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MenuItemConstructorOptions } from 'electron';

const send = vi.fn();
const focusedWindow = { isDestroyed: () => false, webContents: { send } };

vi.mock('electron', () => ({
  app: { name: 'Pulse Canvas', isPackaged: true, getLocale: () => 'en-US' },
  BrowserWindow: { getFocusedWindow: () => focusedWindow },
  Menu: { setApplicationMenu: vi.fn(), buildFromTemplate: vi.fn() },
}));

vi.mock('../window-manager', () => ({
  getLiveCanvasWindow: () => null,
}));

const { buildApplicationMenuTemplate, menuLabels } = await import('../menu');

const flatten = (items: MenuItemConstructorOptions[]): MenuItemConstructorOptions[] => (
  items.flatMap((item) => [
    item,
    ...(Array.isArray(item.submenu) ? flatten(item.submenu) : []),
  ])
);

const build = (isMac: boolean) => flatten(buildApplicationMenuTemplate({
  isMac,
  isDev: false,
  labels: menuLabels('en-US'),
}));

describe('application menu', () => {
  beforeEach(() => {
    send.mockClear();
  });

  it.each([true, false])('claims only the close-window and Settings chords (mac=%s)', (isMac) => {
    const accelerators = build(isMac)
      .map((item) => item.accelerator)
      .filter((value): value is string => typeof value === 'string')
      .sort();

    expect(accelerators).toEqual(['CmdOrCtrl+,', 'Shift+CmdOrCtrl+W']);
  });

  it.each([true, false])('keeps the roles that would eat canvas chords out (mac=%s)', (isMac) => {
    const roles = build(isMac).map((item) => item.role);

    for (const role of ['undo', 'redo', 'resetZoom', 'zoomIn', 'zoomOut', 'fileMenu', 'viewMenu', 'editMenu', 'appMenu']) {
      expect(roles).not.toContain(role);
    }
  });

  it('sends each app command to the focused window', () => {
    const items = build(true);
    const clickByLabel = (label: string) => {
      const item = items.find((entry) => entry.label === label);
      (item?.click as (() => void) | undefined)?.();
    };

    clickByLabel('Settings…');
    clickByLabel('New Workspace');
    clickByLabel('Keyboard Shortcuts');
    clickByLabel('Toggle Sidebar');

    expect(send.mock.calls).toEqual([
      ['app:menu-command', 'open-settings'],
      ['app:menu-command', 'new-workspace'],
      ['app:menu-command', 'shortcuts-help'],
      ['app:menu-command', 'toggle-sidebar'],
    ]);
  });

  it('puts Settings in the app menu on macOS and in File elsewhere', () => {
    const settingsParent = (isMac: boolean) => buildApplicationMenuTemplate({
      isMac,
      isDev: false,
      labels: menuLabels('en-US'),
    }).find((menu) => Array.isArray(menu.submenu)
      && menu.submenu.some((item) => item.label === 'Settings…'))?.label;

    expect(settingsParent(true)).toBe('Pulse Canvas');
    expect(settingsParent(false)).toBe('File');
  });

  it('follows a Chinese OS locale', () => {
    expect(menuLabels('zh-CN').settings).toBe('设置…');
    expect(menuLabels('zh-Hant-TW').file).toBe('文件');
    expect(menuLabels('fr-FR').settings).toBe('Settings…');
  });
});
