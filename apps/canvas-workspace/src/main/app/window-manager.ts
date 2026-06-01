import { BrowserWindow } from 'electron';

/**
 * On-demand canvas window activation.
 *
 * Some Canvas Agent tools (webview/iframe page control) need the renderer to
 * be open and showing the target workspace so the node's <webview> is mounted
 * and registered. When the agent is driven from a background channel (e.g.
 * Feishu) the window may be hidden, minimized, or on a different workspace.
 * This module focuses/creates the window and navigates it to a workspace via
 * the existing hash-route contract (`#/?workspaceId=<id>`), which the renderer
 * already reacts to.
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
 * Bring the canvas window to the front and navigate it to `workspaceId`.
 * Creates the window if none is open. Resolves once the navigation has been
 * dispatched (not when nodes/webviews have finished mounting).
 */
export async function activateWorkspaceWindow(workspaceId: string): Promise<ActivateResult> {
  const win = getOrCreateWindow();
  if (!win) {
    return { ok: false, error: 'Canvas window is unavailable and could not be created.' };
  }

  try {
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();

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
