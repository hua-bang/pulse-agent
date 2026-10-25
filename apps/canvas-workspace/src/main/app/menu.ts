import { app, Menu, type MenuItemConstructorOptions } from "electron";

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
 */
const CLOSE_WINDOW_ACCELERATOR = "Shift+CmdOrCtrl+W";

export function configureApplicationMenu(): void {
  const isMac = process.platform === "darwin";
  const isDev = !app.isPackaged;

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    {
      label: "File",
      submenu: [
        isMac
          ? { role: "close", accelerator: CLOSE_WINDOW_ACCELERATOR }
          : { role: "quit" },
      ],
    },
    {
      label: "Edit",
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
      label: "View",
      submenu: [
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
      label: "Window",
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
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
