/**
 * Webview registry for iframe/link canvas nodes.
 *
 * Each iframe node in the renderer hosts an Electron `<webview>` tag whose
 * `webContents` lives in its own process. The webview's `did-attach`
 * listener posts the resulting `webContentsId` back to main via IPC, which
 * we store here keyed by `{ workspaceId, nodeId }`. The Canvas Agent then
 * uses `getNodeRenderedText()` to pull the post-JS DOM text straight from
 * that webContents — this is what lets it read SPAs / login-gated pages /
 * anything the user is actually seeing, not just the raw server HTML.
 *
 * If the node isn't currently mounted (workspace not open, or not yet
 * loaded), the lookup returns null and the caller falls back to a plain
 * server-side fetch.
 */
import { ipcMain, webContents as allWebContents } from 'electron';
import { performance } from 'node:perf_hooks';
import type { AgentContextDomSelectionRef } from '../../shared/agent-chat';
import type {
  SetWebviewLifecycleResult,
  WebviewLifecycleState,
} from '../../shared/webview-lifecycle';
import {
  DEFAULT_WEBVIEW_SURFACE_KIND,
  isWebviewSurfaceKind,
  webviewInstanceKey,
  type WebviewInstanceIdentity,
  type WebviewRegistrationIdentity,
  type WebviewRegistrationRequest,
  type WebviewSurfaceKind,
} from '../../shared/webview-registration';
import { createDomPickerScript } from './dom-snapshot-script';
import {
  getFrozenSince,
  getWebviewFreezeExemption,
  setWebviewLifecycle,
} from './lifecycle';
import { forgetFreezeSnapshot, rememberFreezeSnapshot } from './discard-monitor';
import { captureBoundedSnapshot } from './snapshot';
import { buildFreezeRecord, probeFreezeState } from './freeze-probe';
import { attachShortcutForwarding } from './shortcut-forwarding';
import {
  beginLifecycleRequest,
  serializeLifecycleTransition,
} from './lifecycle-request-guard';
import {
  WebviewRegistrationStore,
  type WebviewRegistrationKey,
} from './registration-store';
import { withTemporarilyActiveWebview } from './temporary-active-read';

const registry = new WebviewRegistrationStore();
let welcomePerfRecorded = false;
const recordWelcomeReadyForPerf = (k: WebviewRegistrationKey): void => {
  if (!process.env.PULSE_CANVAS_PERF || welcomePerfRecorded) return;
  if (k.nodeId !== 'node-welcome-download') return;
  welcomePerfRecorded = true;
  console.log(`[perf] welcome-webview ${JSON.stringify({ at: Math.round(performance.now()) })}`);
};

function register(
  k: WebviewRegistrationKey,
  webContentsId: number,
  surfaceKind: WebviewSurfaceKind,
  ready = false,
): void {
  const isNewGuest = registry.register(k, webContentsId, surfaceKind);
  if (isNewGuest) {
    // Self-cleaning entry: a guest that dies without a renderer unregister
    // (crash, discard, silent teardown) must not linger in the registry.
    // The compare-and-delete below keeps THIS generation's hook from
    // evicting a newer webContents that reused the node key.
    const wc = allWebContents.fromId(webContentsId);
    wc?.once('destroyed', () => {
      const identity = registry.getByWebContentsId(webContentsId);
      if (identity) unregister(identity, webContentsId);
    });
    // Give the guest a keyboard escape hatch back to the host window.
    attachShortcutForwarding(wc);
  }
  if (ready) recordWelcomeReadyForPerf(k);
}

/**
 * Compare-and-delete: when `expectedWebContentsId` is given, the entry is
 * only removed if it still points at that id — a stale renderer teardown
 * (or a destroyed-hook from an old guest) can never evict a newer
 * generation's registration.
 */
function unregister(k: WebviewRegistrationKey, expectedWebContentsId?: number): boolean {
  const identity = expectedWebContentsId === undefined
    ? registry.getByNode(k)
    : registry.getByWebContentsId(expectedWebContentsId);
  const removed = registry.unregister(k, expectedWebContentsId);
  if (removed && identity) forgetFreezeSnapshot(webviewInstanceKey(identity));
  return removed;
}

function lookup(k: WebviewRegistrationKey): number | undefined {
  return registry.getByNode(k)?.webContentsId;
}

/** Full renderer-declared identity for a guest, queried in O(1) by Electron id. */
export function getWebviewRegistration(
  webContentsId: number,
): WebviewRegistrationIdentity | null {
  return registry.getByWebContentsId(webContentsId) ?? null;
}

/** Surface policy for a guest id, or null when it has not registered. */
export function getWebviewSurfaceKind(webContentsId: number): WebviewSurfaceKind | null {
  return getWebviewRegistration(webContentsId)?.surfaceKind ?? null;
}

/** Resolve one exact mounted presentation. A node key alone is ambiguous
 * when the canvas card and dock detail are both alive. */
export function getWebContentsForInstance(
  identity: WebviewInstanceIdentity,
): ReturnType<typeof allWebContents.fromId> | null {
  const registered = registry.getByWebContentsId(identity.webContentsId);
  if (!registered || registered.workspaceId !== identity.workspaceId
    || registered.nodeId !== identity.nodeId) return null;
  const wc = allWebContents.fromId(identity.webContentsId);
  if (wc && !wc.isDestroyed()) return wc;
  unregister(registered, identity.webContentsId);
  return null;
}

/**
 * Return the live WebContents for a registered iframe node, or null if the
 * node is not registered / the webContents has already been destroyed.
 */
export function getWebContentsForNode(
  workspaceId: string,
  nodeId: string,
): ReturnType<typeof allWebContents.fromId> | null {
  const id = lookup({ workspaceId, nodeId });
  if (id === undefined) return null;
  const wc = allWebContents.fromId(id);
  if (wc && !wc.isDestroyed()) return wc;
  return unregister({ workspaceId, nodeId }, id)
    ? getWebContentsForNode(workspaceId, nodeId)
    : null;
}

/**
 * Enumerate every registered, still-live webview with its node identity —
 * the L3 discard monitor walks this to price guest processes against the
 * memory budget. Entries whose webContents died without unregistering are
 * skipped.
 */
export function listRegisteredWebviews(): Array<{
  workspaceId: string;
  nodeId: string;
  webContentsId: number;
  wc: NonNullable<ReturnType<typeof allWebContents.fromId>>;
}> {
  const out: Array<{
    workspaceId: string;
    nodeId: string;
    webContentsId: number;
    wc: NonNullable<ReturnType<typeof allWebContents.fromId>>;
  }> = [];
  for (const entry of registry.values()) {
    const wc = allWebContents.fromId(entry.webContentsId);
    if (!wc || wc.isDestroyed()) continue;
    out.push({
      workspaceId: entry.workspaceId,
      nodeId: entry.nodeId,
      webContentsId: entry.webContentsId,
      wc,
    });
  }
  return out;
}

const EXTRACT_TIMEOUT_MS = 8_000;
const EXTRACT_MAX_CHARS = 200_000;
export async function pickDomElementForNode(
  workspaceId: string,
  nodeId: string,
): Promise<{
  ok: boolean;
  selection?: AgentContextDomSelectionRef;
  error?: string;
  cancelled?: boolean;
}> {
  const wc = getWebContentsForNode(workspaceId, nodeId);
  if (!wc) {
    return {
      ok: false,
      error:
        `No active webview for node ${nodeId} in workspace ${workspaceId}. ` +
        'Open the iframe node in URL mode and wait for it to load.',
    };
  }
  try {
    wc.focus();
  } catch {
    // best-effort
  }
  try {
    const result = await wc.executeJavaScript(createDomPickerScript(workspaceId, nodeId), true) as {
      ok: boolean;
      selection?: AgentContextDomSelectionRef;
      error?: string;
      cancelled?: boolean;
    };
    if (result?.ok && result.selection) return { ok: true, selection: result.selection };
    return {
      ok: false,
      error: result?.error ?? 'DOM picker did not return a selection',
      cancelled: result?.cancelled,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function cancelDomElementPickForNode(
  workspaceId: string,
  nodeId: string,
): Promise<{ ok: boolean; error?: string }> {
  const wc = getWebContentsForNode(workspaceId, nodeId);
  if (!wc) {
    return {
      ok: false,
      error:
        `No active webview for node ${nodeId} in workspace ${workspaceId}.`,
    };
  }

  try {
    const cancelled = await wc.executeJavaScript(
      `(() => {
        const cancel = window.__pulseDomPickerCancel;
        if (typeof cancel !== 'function') return false;
        cancel('cancelled');
        return true;
      })()`,
      false,
    ) as boolean;
    return cancelled
      ? { ok: true }
      : { ok: false, error: 'No active DOM picker for this node.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Pull the rendered text of the webview hosting an iframe node.
 *
 * Returns the extracted text on success, or `null` if no webview is
 * registered / the webContents has been destroyed. Throws only on
 * unexpected errors; `executeJavaScript` failures are swallowed and
 * surfaced as `null` so the agent can fall back cleanly.
 */
export async function getNodeRenderedText(
  workspaceId: string,
  nodeId: string,
): Promise<string | null> {
  const id = lookup({ workspaceId, nodeId });
  if (id === undefined) {
    console.log(
      `[webview-registry] getNodeRenderedText: no entry for ${workspaceId}::${nodeId} (registry has ${registry.size})`,
    );
    return null;
  }

  const wc = allWebContents.fromId(id);
  if (!wc || wc.isDestroyed()) {
    console.log(
      `[webview-registry] getNodeRenderedText: webContents#${id} gone for ${workspaceId}::${nodeId}`,
    );
    unregister({ workspaceId, nodeId }, id);
    return null;
  }

  // Pull visible text + title from the guest page. Running inside the
  // guest's isolated world so it can't see our renderer globals.
  const script = `
    (function () {
      try {
        var title = document.title || '';
        var body = document.body;
        var text = body ? (body.innerText || body.textContent || '') : '';
        return { ok: true, title: title, text: text, url: location.href };
      } catch (err) {
        return { ok: false, error: String(err) };
      }
    })();
  `;

  let result: { ok: boolean; title?: string; text?: string; url?: string; error?: string } | null = null;

  let threw = false;
  try {
    result = await withTemporarilyActiveWebview(
      wc,
      id,
      () => getWebContentsForInstance({ workspaceId, nodeId, webContentsId: id }) === wc,
      () => Promise.race([
        wc.executeJavaScript(script, /* userGesture */ false),
        new Promise<null>((resolve) =>
          setTimeout(() => resolve(null), EXTRACT_TIMEOUT_MS),
        ),
      ]),
    );
  } catch {
    threw = true;
  }
  if (threw) return null;

  if (!result) return `[webview text extraction timed out after ${EXTRACT_TIMEOUT_MS / 1000}s]`;
  if (!result.ok) return null;

  const cleaned = (result.text ?? '').replace(/\s+/g, ' ').trim();
  const truncated = cleaned.length > EXTRACT_MAX_CHARS;
  const body = truncated ? cleaned.slice(0, EXTRACT_MAX_CHARS) : cleaned;

  const header: string[] = [];
  if (result.title) header.push(`Title: ${result.title}`);
  if (result.url) header.push(`URL: ${result.url}`);
  header.push('(source: live webview DOM)');

  let out = `${header.join('\n')}\n\n${body}`;
  if (truncated) out += '\n\n[…content truncated]';
  return out;
}

export function setupWebviewRegistryIpc(): void {
  ipcMain.handle(
    'iframe:register-webview',
    (_event, payload: WebviewRegistrationRequest) => {
      if (
        !payload?.workspaceId
        || !payload?.nodeId
        || typeof payload.webContentsId !== 'number'
        || (payload.surfaceKind !== undefined && !isWebviewSurfaceKind(payload.surfaceKind))
      ) {
        console.warn('[webview-registry] rejected register:', payload);
        return { ok: false };
      }
      register(
        { workspaceId: payload.workspaceId, nodeId: payload.nodeId },
        payload.webContentsId,
        payload.surfaceKind ?? DEFAULT_WEBVIEW_SURFACE_KIND,
        payload.ready === true,
      );
      console.log(
        `[webview-registry] registered ${payload.workspaceId}::${payload.nodeId} → wc#${payload.webContentsId} (${registry.size} total)`,
      );
      return { ok: true };
    },
  );

  ipcMain.handle(
    'iframe:unregister-webview',
    (_event, payload: { workspaceId: string; nodeId: string; webContentsId: number }) => {
      if (
        !payload?.workspaceId
        || !payload?.nodeId
        || typeof payload.webContentsId !== 'number'
      ) return { ok: false };
      const removed = unregister(
        { workspaceId: payload.workspaceId, nodeId: payload.nodeId },
        payload.webContentsId,
      );
      console.log(
        `[webview-registry] ${removed ? 'unregistered' : 'ignored stale unregister for'} ` +
        `${payload.workspaceId}::${payload.nodeId} wc#${payload.webContentsId} (${registry.size} remaining)`,
      );
      return { ok: true };
    },
  );

  ipcMain.handle(
    'iframe:pick-dom-element',
    async (_event, payload: { workspaceId: string; nodeId: string }) => {
      if (!payload?.workspaceId || !payload?.nodeId) {
        return { ok: false, error: 'workspaceId and nodeId are required' };
      }
      return pickDomElementForNode(payload.workspaceId, payload.nodeId);
    },
  );

  ipcMain.handle(
    'iframe:cancel-dom-element-pick',
    async (_event, payload: { workspaceId: string; nodeId: string }) => {
      if (!payload?.workspaceId || !payload?.nodeId) {
        return { ok: false, error: 'workspaceId and nodeId are required' };
      }
      return cancelDomElementPickForNode(payload.workspaceId, payload.nodeId);
    },
  );

  /**
   * Background throttle for off-canvas-viewport webviews.
   *
   * Renderer detects when a webview-bearing node has been outside the visible
   * canvas viewport for long enough (see useWebviewBackgroundThrottle) and
   * asks main to drop its `setFrameRate`. The webview's guest process stays
   * alive — only the paint cadence drops, so JS execution, timers, and
   * network continue at normal speed and no in-page state is lost. When the
   * node returns to the viewport renderer asks main to restore 60fps.
   *
   * Frame rate is clamped to Electron's [1, 240] range. Calls for unknown
   * (workspaceId, nodeId) pairs (or already-destroyed webContents) silently
   * resolve to {ok:false} — this happens normally during teardown when the
   * IO observer fires after webview unregistration.
   */
  ipcMain.handle(
    'iframe:set-frame-rate',
    (
      _event,
      payload: WebviewInstanceIdentity & { frameRate: number },
    ) => {
      if (
        !payload?.workspaceId ||
        !payload?.nodeId ||
        typeof payload.webContentsId !== 'number' ||
        typeof payload.frameRate !== 'number'
      ) {
        return { ok: false };
      }
      const wc = getWebContentsForInstance(payload);
      if (!wc) return { ok: false };
      const clamped = Math.max(1, Math.min(240, Math.round(payload.frameRate)));
      try {
        wc.setFrameRate(clamped);
        return { ok: true, frameRate: clamped };
      } catch (err) {
        console.warn(
          `[webview-registry] setFrameRate(${clamped}) failed for ${payload.workspaceId}::${payload.nodeId}: ${(err as Error).message}`,
        );
        return { ok: false };
      }
    },
  );

  ipcMain.handle(
    'iframe:set-lifecycle',
    async (
      _event,
      payload: WebviewInstanceIdentity & { state: WebviewLifecycleState },
    ): Promise<SetWebviewLifecycleResult> => {
      if (
        !payload?.workspaceId ||
        !payload?.nodeId ||
        typeof payload.webContentsId !== 'number' ||
        (payload.state !== 'active' && payload.state !== 'frozen')
      ) {
        return { ok: false, retryable: false, error: 'invalid lifecycle payload' };
      }
      const wc = getWebContentsForInstance(payload);
      const key = webviewInstanceKey(payload);
      const request = beginLifecycleRequest(payload.webContentsId);
      if (payload.state === 'frozen') {
        const exemption = getWebviewFreezeExemption(wc ?? null);
        if (exemption) {
          request.finish();
          return exemption;
        }
      }
      if (payload.state === 'frozen' && wc && getFrozenSince(wc) === undefined) {
        const [imageDataUrl, probe] = await Promise.all([
          captureBoundedSnapshot(wc),
          probeFreezeState(wc),
        ]);
        if (!request.isCurrent() || getWebContentsForInstance(payload) !== wc) {
          request.finish();
          return { ok: false, retryable: false, skipped: 'destroyed' };
        }
        let url = '';
        try {
          url = wc.getURL();
        } catch {
          // setWebviewLifecycle reports teardown below
        }
        rememberFreezeSnapshot(key, buildFreezeRecord(url, imageDataUrl, probe));
      }
      const result = await serializeLifecycleTransition<SetWebviewLifecycleResult>(payload.webContentsId, async () => {
        if (!request.isCurrent() || getWebContentsForInstance(payload) !== wc) {
          return { ok: false, retryable: false, skipped: 'destroyed' } as const;
        }
        const transitioned = await setWebviewLifecycle(wc ?? null, payload.state);
        if (
          payload.state === 'frozen'
          && transitioned.ok
          && (!request.isCurrent() || getWebContentsForInstance(payload) !== wc)
        ) {
          await setWebviewLifecycle(wc ?? null, 'active');
          return { ok: false, retryable: false, skipped: 'destroyed' } as const;
        }
        return transitioned;
      });
      if (payload.state === 'active' || (payload.state === 'frozen' && !result.ok)) {
        forgetFreezeSnapshot(key);
      }
      if (!result.ok && result.error) {
        console.warn(
          `[webview-registry] setLifecycle(${payload.state}) failed for ${payload.workspaceId}::${payload.nodeId}: ${result.error}`,
        );
      }
      request.finish();
      return result;
    },
  );
}
