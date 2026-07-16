/**
 * Inbound deep-link handling for the default-browser feature.
 *
 * When Pulse Canvas is the OS http/https handler, clicking a link elsewhere
 * launches (cold) or signals (warm) this app with the URL:
 *   - macOS:          `app.on('open-url')`
 *   - Windows/Linux:  a second process starts with the URL in argv; the
 *                     single-instance lock funnels it to the running process
 *                     via `app.on('second-instance')`, and the very first
 *                     launch carries the URL in `process.argv`.
 *
 * A URL is routed into the app over the existing `link:open` channel, which
 * the renderer (RightDock) already opens in an embedded browser tab. URLs that
 * arrive before a renderer is ready (cold start) are queued and drained by the
 * renderer via `default-browser:consume-pending`.
 *
 * The single-instance lock must be requested BEFORE `app.whenReady`, so
 * `setupDeepLinkEarly` runs synchronously from bootstrap.
 */

import { app, BrowserWindow } from 'electron';
import type { WriteLog } from '../app/logging';

const HTTP_SCHEMES = new Set(['http:', 'https:']);

// URLs captured before a renderer could receive them (cold start). Drained by
// the renderer on mount via `consumePendingLinks`.
const pendingLinks: string[] = [];

function isInboundHttpUrl(raw: string): boolean {
  try {
    return HTTP_SCHEMES.has(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/** First http/https token in a process argv list, or null. */
export function findHttpUrlInArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (isInboundHttpUrl(arg)) return arg;
  }
  return null;
}

function focusMainWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * Route an inbound URL into the app. If a renderer is loaded, push it over
 * `link:open` (warm path — RightDock is already subscribed). Otherwise queue
 * it for the renderer to drain once it mounts (cold path).
 */
export function routeInboundUrl(url: string, writeLog?: WriteLog): void {
  if (!isInboundHttpUrl(url)) return;
  void writeLog?.('default-browser', 'inbound url', url);

  const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
  if (win && !win.webContents.isLoading()) {
    focusMainWindow(win);
    win.webContents.send('link:open', { url });
    return;
  }

  // No window yet, or it is still loading its bundle — queue and let the
  // renderer drain on mount so the URL is never dropped on cold start.
  pendingLinks.push(url);
  if (win) focusMainWindow(win);
}

/** Return and clear queued cold-start URLs. */
export function consumePendingLinks(): string[] {
  return pendingLinks.splice(0, pendingLinks.length);
}

/**
 * Acquire the single-instance lock and wire the OS deep-link listeners.
 * Returns false when another instance already holds the lock — the caller must
 * stop bootstrapping (this instance is quitting).
 */
export function setupDeepLinkEarly(writeLog: WriteLog): boolean {
  const gotLock = app.requestSingleInstanceLock();
  if (!gotLock) {
    app.quit();
    return false;
  }

  // Windows/Linux: a second launch (e.g. a clicked link) is funneled here.
  app.on('second-instance', (_event, argv) => {
    const url = findHttpUrlInArgv(argv);
    if (url) routeInboundUrl(url, writeLog);
  });

  // macOS: link activations arrive as open-url, possibly before whenReady.
  app.on('open-url', (event, url) => {
    event.preventDefault();
    routeInboundUrl(url, writeLog);
  });

  // Windows/Linux cold start: the launching URL rides in on argv.
  const initial = findHttpUrlInArgv(process.argv);
  if (initial) {
    pendingLinks.push(initial);
    void writeLog('default-browser', 'cold-start url', initial);
  }

  return true;
}
