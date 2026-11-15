import { app, BrowserWindow, Menu, type MenuItemConstructorOptions } from "electron";
import { APP_MENU_COMMAND_CHANNEL, type AppMenuCommand } from "../../shared/app-info";
import { getLiveCanvasWindow } from "./window-manager";

/**
 * Replaces Electron's default application menu.
 *
 * Menu accelerators are consumed in the main process BEFORE the keystroke
 * reaches the renderer, so every default role here is really a decision
 * about which canvas shortcut is allowed to exist at all. Two roles were
 * taking keys the canvas needs:
 *
 *  - Edit's Undo/Redo (CmdOrCtrl+Z / Shift+CmdOrCtrl+Z) swallowed the
 *    canvas's own history. Text inputs still get native undo from Chromium
 *    once the key reaches the page, and the note editor (TipTap) ships its
 *    own history keymap.
 *  - View's resetZoom/zoomIn/zoomOut (CmdOrCtrl+0 and +/-) zoomed the whole
 *    UI via webFrame. On a canvas app that reads as a bug: the user means
 *    "zoom the canvas". Those keys now reach the renderer and drive the
 *    canvas transform (`canvas.zoomIn` / `zoomOut` / `zoomReset` in
 *    `shortcuts/registry.ts`).
 *
 * The default File and Window menus bind CmdOrCtrl+W to closing the window.
 * That key now closes the active workspace tab (`app.closeTab`), as in a
 * browser, so the window-close item moves to Shift+CmdOrCtrl+W.
 *
 * `reload` / `forceReload` stay behind the dev build: reloading the window
 * tears down every live terminal PTY and webview guest, which is a developer
 * action, not something a stray Cmd+R should do to real work.
 *
 * App commands (Settings, New workspace, panels, help) send an
 * `AppMenuCommand` to the window, and the renderer runs its existing handler.
 * Only Settings has an accelerator: CmdOrCtrl+, runs the same handler as the
 * renderer's `app.openSettings`. The other items deliberately have none. The
 * renderer registry owns their chords, and a menu accelerator would take the
 * key before the renderer's focus and overlay guards (for example `?` while
 * typing, or Mod+Shift+D in the note editor).
 */
const CLOSE_WINDOW_ACCELERATOR = "Shift+CmdOrCtrl+W";
const SETTINGS_ACCELERATOR = "CmdOrCtrl+,";

export type MenuLabelKey =
  | "file"
  | "edit"
  | "view"
  | "window"
  | "help"
  | "settings"
  | "newWorkspace"
  | "commandPalette"
  | "toggleSidebar"
  | "togglePanels"
  | "toggleChatPage"
  | "keyboardShortcuts";

type MenuLabels = Record<MenuLabelKey, string>;

const EN_LABELS: MenuLabels = {
  file: "File",
  edit: "Edit",
  view: "View",
  window: "Window",
  help: "Help",
  settings: "Settings…",
  newWorkspace: "New Workspace",
  commandPalette: "Command Palette…",
  toggleSidebar: "Toggle Sidebar",
  togglePanels: "Toggle All Panels",
  toggleChatPage: "Toggle Chat Page",
  keyboardShortcuts: "Keyboard Shortcuts",
};

const ZH_LABELS: MenuLabels = {
  file: "文件",
  edit: "编辑",
  view: "视图",
  window: "窗口",
  help: "帮助",
  settings: "设置…",
  newWorkspace: "新建工作区",
  commandPalette: "命令面板…",
  toggleSidebar: "切换侧边栏",
  togglePanels: "切换全部面板",
  toggleChatPage: "切换聊天页",
  keyboardShortcuts: "键盘快捷键",
};

/**
 * Main has no copy of the renderer's language setting, so the menu follows
 * the OS locale, like the other main-process dialogs (`unload-prompt.ts`).
 */
export function menuLabels(locale: string): MenuLabels {
  return locale.toLowerCase().startsWith("zh") ? ZH_LABELS : EN_LABELS;
}

function sendMenuCommand(command: AppMenuCommand): void {
  const focused = BrowserWindow.getFocusedWindow();
  const win = focused && !focused.isDestroyed() ? focused : getLiveCanvasWindow();
  win?.webContents.send(APP_MENU_COMMAND_CHANNEL, command);
}

function commandItem(
  label: string,
  command: AppMenuCommand,
  accelerator?: string,
): MenuItemConstructorOptions {
  return {
    label,
    ...(accelerator ? { accelerator } : {}),
    click: () => sendMenuCommand(command),
  };
}

export function buildApplicationMenuTemplate(options: {
  isMac: boolean;
  isDev: boolean;
  labels: MenuLabels;
}): MenuItemConstructorOptions[] {
  const { isMac, isDev, labels } = options;
  const settingsItem = commandItem(labels.settings, "open-settings", SETTINGS_ACCELERATOR);

  return [
    ...(isMac
      ? [{
        label: app.name,
        submenu: [
          { role: "about" },
          { type: "separator" },
          settingsItem,
          { type: "separator" },
          { role: "services" },
          { type: "separator" },
          { role: "hide" },
          { role: "hideOthers" },
          { role: "unhide" },
          { type: "separator" },
          { role: "quit" },
        ],
      } as MenuItemConstructorOptions]
      : []),
    {
      label: labels.file,
      submenu: [
        commandItem(labels.newWorkspace, "new-workspace"),
        { type: "separator" },
        ...(isMac
          ? []
          : [settingsItem, { type: "separator" } as MenuItemConstructorOptions]),
        isMac
          ? { role: "close", accelerator: CLOSE_WINDOW_ACCELERATOR }
          : { role: "quit" },
      ],
    },
    {
      label: labels.edit,
      submenu: [
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        ...(isMac
          ? [{ role: "pasteAndMatchStyle" } as MenuItemConstructorOptions]
          : []),
        { role: "delete" },
        { type: "separator" },
        { role: "selectAll" },
      ],
    },
    {
      label: labels.view,
      submenu: [
        commandItem(labels.commandPalette, "command-palette"),
        { type: "separator" },
        commandItem(labels.toggleSidebar, "toggle-sidebar"),
        commandItem(labels.togglePanels, "toggle-panels"),
        commandItem(labels.toggleChatPage, "toggle-chat-page"),
        { type: "separator" },
        ...(isDev
          ? ([
            { role: "reload" },
            { role: "forceReload" },
            { type: "separator" },
          ] as MenuItemConstructorOptions[])
          : []),
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },
    {
      label: labels.window,
      // The `window` role gives macOS its open-window list.
      role: "window",
      submenu: isMac
        ? [
          { role: "minimize" },
          { role: "zoom" },
          { type: "separator" },
          { role: "front" },
        ]
        : [
          { role: "minimize" },
          { role: "close", accelerator: CLOSE_WINDOW_ACCELERATOR },
        ],
    },
    {
      label: labels.help,
      role: "help",
      submenu: [
        commandItem(labels.keyboardShortcuts, "shortcuts-help"),
      ],
    },
  ];
}

export function configureApplicationMenu(): void {
  const template = buildApplicationMenuTemplate({
    isMac: process.platform === "darwin",
    isDev: !app.isPackaged,
    labels: menuLabels(app.getLocale()),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
