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

type WriteLog = (level: string, message: string, details?: string) => Promise<void>;

const HTTP_SCHEMES = new Set(['http:', 'https:']);

// URLs captured before a renderer could receive them (cold start). Drained by
// the renderer on mount via `consumePendingLinks`.
const pendingLinks: string[] = [];
const pendingJoinLinks: string[] = [];

function isInboundHttpUrl(raw: string): boolean {
  try {
    return HTTP_SCHEMES.has(new URL(raw).protocol);
  } catch {
    return false;
  }
}

/** Extract an invite code from `pulse-canvas://join?code=...` or `pulse-share://v1/...`. */
export function extractJoinInviteFromUrl(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.startsWith('pulse-share://v1/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol === 'pulse-canvas:' && parsed.hostname === 'join') {
      const code = parsed.searchParams.get('code')?.trim();
      if (code) return code.startsWith('pulse-share://v1/') ? code : `pulse-share://v1/${code}`;
    }
  } catch {
    return null;
  }
  return null;
}

/** First http/https or join deep-link token in a process argv list, or null. */
export function findHttpUrlInArgv(argv: readonly string[]): string | null {
  for (const arg of argv) {
    if (isInboundHttpUrl(arg) || extractJoinInviteFromUrl(arg)) return arg;
  }
  return null;
}

function focusMainWindow(win: BrowserWindow): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

/**
 * Route an inbound URL into the app. Join deep links go to `remote-vps:join-link`;
 * http/https URLs go to `link:open`. If no renderer is ready yet, queue for cold-start drain.
 */
export function routeInboundUrl(url: string, writeLog?: WriteLog): void {
  const joinInvite = extractJoinInviteFromUrl(url);
  if (joinInvite) {
    void writeLog?.('remote-vps', 'inbound join deep link', joinInvite.slice(0, 48));
    const win = BrowserWindow.getAllWindows().find((w) => !w.isDestroyed());
    if (win && !win.webContents.isLoading()) {
      focusMainWindow(win);
      win.webContents.send('remote-vps:join-link', { inviteCode: joinInvite });
      return;
    }
    pendingJoinLinks.push(joinInvite);
    if (win) focusMainWindow(win);
    return;
  }

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

/** Return and clear queued cold-start join invite codes. */
export function consumePendingJoinLinks(): string[] {
  return pendingJoinLinks.splice(0, pendingJoinLinks.length);
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

  // Register custom schemes for one-click `pulse-share://v1/...` (and legacy `pulse-canvas://join`) links.
  try {
    if (app.isPackaged) {
      app.setAsDefaultProtocolClient('pulse-share');
      app.setAsDefaultProtocolClient('pulse-canvas');
    }
  } catch {
    /* ignore protocol registration failures on unsupported shells */
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
    const joinInvite = extractJoinInviteFromUrl(initial);
    if (joinInvite) {
      pendingJoinLinks.push(joinInvite);
      void writeLog('remote-vps', 'cold-start join deep link', joinInvite.slice(0, 48));
    } else {
      pendingLinks.push(initial);
      void writeLog('default-browser', 'cold-start url', initial);
    }
  }

  return true;
}
