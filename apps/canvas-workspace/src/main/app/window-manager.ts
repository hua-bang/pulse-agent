import { BrowserWindow } from 'electron';

/**
 * On-demand canvas window activation.
 *
 * Some Canvas Agent tools (webview/iframe page control) need the renderer to
 * be open and showing the target workspace so the node's <webview> is mounted
 * and registered. When the agent is driven from a background channel (e.g.
 * Feishu) the window may be hidden, minimized, or on a different workspace.
 * This module activates the workspace WITHOUT stealing focus or bringing the
 * window to the front: it only ensures the window is on-screen (so Chromium
 * doesn't suspend/throttle rendering and the webviews can load) and navigates
 * it to the workspace via the existing hash-route contract
 * (`#/?workspaceId=<id>`), which the renderer already reacts to.
 */

type WindowFactory = () => BrowserWindow;

let windowFactory: WindowFactory | null = null;

/** Registered by bootstrap so we can recreate the window if it was closed. */
export function setWindowFactory(factory: WindowFactory): void {
  windowFactory = factory;
}

function liveWindow(): BrowserWindow | null {
  return BrowserWindow.getAllWindows().find((w) => !w.isDestroyed()) ?? null;
}

/**
 * The live canvas window, or null if none is open. Used by capture tools
 * (e.g. `canvas_screenshot`) that need to grab this app's own window. Prefers
 * the focused window so a multi-window setup screenshots the one in front.
 */
export function getCanvasWindow(): BrowserWindow | null {
  const focused = BrowserWindow.getFocusedWindow();
  if (focused && !focused.isDestroyed()) return focused;
  return liveWindow();
}

function getOrCreateWindow(): BrowserWindow | null {
  return liveWindow() ?? windowFactory?.() ?? null;
}

function whenReady(win: BrowserWindow): Promise<void> {
  if (!win.webContents.isLoading()) return Promise.resolve();
  return new Promise((resolve) => {
    win.webContents.once('did-finish-load', () => resolve());
  });
}

export interface ActivateResult {
  ok: boolean;
  error?: string;
}

/**
 * Activate `workspaceId` in the canvas window and navigate to it, WITHOUT
 * stealing focus or raising the window. Creates the window if none is open.
 * The window is only shown (inactively) when it is hidden/minimized, so its
 * renderer isn't suspended and the workspace's webviews can load. Resolves
 * once navigation is dispatched (not when nodes/webviews have finished
 * mounting).
 */
export async function activateWorkspaceWindow(workspaceId: string): Promise<ActivateResult> {
  const win = getOrCreateWindow();
  if (!win) {
    return { ok: false, error: 'Canvas window is unavailable and could not be created.' };
  }

  try {
    // Only bring it on-screen if it's hidden/minimized (a suspended renderer
    // can't load webviews). showInactive() does this without focusing or
    // raising it above the user's current window.
    if (!win.isVisible() || win.isMinimized()) {
      win.showInactive();
    }

    await whenReady(win);
    // Drive the renderer via its existing hash-route contract. App.tsx reacts
    // to `?workspaceId=` and selects the workspace.
    const hash = `#/?workspaceId=${encodeURIComponent(workspaceId)}`;
    await win.webContents.executeJavaScript(
      `window.location.hash = ${JSON.stringify(hash)}; void 0;`,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
