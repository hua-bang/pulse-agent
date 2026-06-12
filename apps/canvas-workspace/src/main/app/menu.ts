import { Menu, type MenuItemConstructorOptions } from "electron";

/**
 * Replaces Electron's default application menu. The default Edit menu
 * registers Undo/Redo role items whose CmdOrCtrl+Z / Shift+CmdOrCtrl+Z
 * accelerators consume the keystroke before the renderer ever sees it,
 * so the canvas's own history (useCanvasKeyboard) never fires. We keep
 * the rest of the default menus but drop those two items — text inputs
 * still get native undo from Chromium once the key reaches the page,
 * and the note editor (TipTap) ships its own history keymap.
 */
export function configureApplicationMenu(): void {
  const isMac = process.platform === "darwin";

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
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
