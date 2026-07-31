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
 * `reload` / `forceReload` stay behind the dev build: reloading the window
 * tears down every live terminal PTY and webview guest, which is a developer
 * action, not something a stray Cmd+R should do to real work.
 */
export function configureApplicationMenu(): void {
  const isMac = process.platform === "darwin";
  const isDev = !app.isPackaged;

  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" } as MenuItemConstructorOptions] : []),
    { role: "fileMenu" },
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
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
