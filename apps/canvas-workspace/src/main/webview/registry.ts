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
import { createDomPickerScript } from './dom-snapshot-script';
import {
  getFrozenSince,
  getWebviewFreezeExemption,
  setWebviewLifecycle,
} from './lifecycle';
import { forgetFreezeSnapshot, rememberFreezeSnapshot } from './discard-monitor';
import { captureBoundedSnapshot } from './snapshot';
import { buildFreezeRecord, probeFreezeState } from './freeze-probe';

interface RegistryKey {
  workspaceId: string;
  nodeId: string;
}

function keyOf(k: RegistryKey): string {
  return `${k.workspaceId}::${k.nodeId}`;
}

const registry = new Map<string, number>();
let welcomePerfRecorded = false;

const recordWelcomeReadyForPerf = (k: RegistryKey): void => {
  if (!process.env.PULSE_CANVAS_PERF || welcomePerfRecorded) return;
  if (k.nodeId !== 'node-welcome-download') return;
  welcomePerfRecorded = true;
  console.log(`[perf] welcome-webview ${JSON.stringify({ at: Math.round(performance.now()) })}`);
};

function register(k: RegistryKey, webContentsId: number, ready = false): void {
  const registryKey = keyOf(k);
  const previousId = registry.get(registryKey);
  registry.set(registryKey, webContentsId);
  if (previousId !== webContentsId) {
    // Self-cleaning entry: a guest that dies without a renderer unregister
    // (crash, discard, silent teardown) must not linger in the registry.
    // The compare-and-delete below keeps THIS generation's hook from
    // evicting a newer webContents that reused the node key.
    const wc = allWebContents.fromId(webContentsId);
    wc?.once('destroyed', () => unregister(k, webContentsId));
  }
  if (ready) recordWelcomeReadyForPerf(k);
}

/**
 * Compare-and-delete: when `expectedWebContentsId` is given, the entry is
 * only removed if it still points at that id — a stale renderer teardown
 * (or a destroyed-hook from an old guest) can never evict a newer
 * generation's registration.
 */
function unregister(k: RegistryKey, expectedWebContentsId?: number): boolean {
  const registryKey = keyOf(k);
  if (
    expectedWebContentsId !== undefined
    && registry.get(registryKey) !== expectedWebContentsId
  ) return false;
  return registry.delete(registryKey);
}

function lookup(k: RegistryKey): number | undefined {
  return registry.get(keyOf(k));
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
  if (!wc || wc.isDestroyed()) {
    // Self-heal: drop the dead entry so the key is clean for re-registration.
    unregister({ workspaceId, nodeId }, id);
    return null;
  }
  return wc;
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
  wc: NonNullable<ReturnType<typeof allWebContents.fromId>>;
}> {
  const out: Array<{
    workspaceId: string;
    nodeId: string;
    wc: NonNullable<ReturnType<typeof allWebContents.fromId>>;
  }> = [];
  for (const [key, webContentsId] of registry) {
    const separator = key.indexOf('::');
    if (separator < 0) continue;
    const wc = allWebContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) continue;
    out.push({
      workspaceId: key.slice(0, separator),
      nodeId: key.slice(separator + 2),
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

  // A frozen guest (L2) has script execution disabled — executeJavaScript
  // would only hit the timeout and the agent would see a diagnostic instead
  // of the rendered page. Thaw for the read, then re-freeze; the freeze-time
  // snapshot survives because only the iframe:set-lifecycle handler clears
  // it, and if re-freezing fails the renderer's resume path still sends
  // 'active' when the node re-enters the viewport.
  const wasFrozen = getFrozenSince(wc) !== undefined;
  if (wasFrozen) await setWebviewLifecycle(wc, 'active');
  let threw = false;
  try {
    result = await Promise.race([
      wc.executeJavaScript(script, /* userGesture */ false),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), EXTRACT_TIMEOUT_MS),
      ),
    ]);
  } catch {
    threw = true;
  } finally {
    if (wasFrozen && !wc.isDestroyed()) void setWebviewLifecycle(wc, 'frozen');
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
    (_event, payload: { workspaceId: string; nodeId: string; webContentsId: number; ready?: boolean }) => {
      if (!payload?.workspaceId || !payload?.nodeId || typeof payload.webContentsId !== 'number') {
        console.warn('[webview-registry] rejected register:', payload);
        return { ok: false };
      }
      register(
        { workspaceId: payload.workspaceId, nodeId: payload.nodeId },
        payload.webContentsId,
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
      payload: { workspaceId: string; nodeId: string; frameRate: number },
    ) => {
      if (
        !payload?.workspaceId ||
        !payload?.nodeId ||
        typeof payload.frameRate !== 'number'
      ) {
        return { ok: false };
      }
      const wc = getWebContentsForNode(payload.workspaceId, payload.nodeId);
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

  /**
   * Chrome-style freeze/resume for long-offscreen webviews (see
   * ./lifecycle.ts for the mechanism and exemptions). Renderer escalates a
   * node from the 1fps frame-rate throttle to 'frozen' after it has been
   * offscreen for minutes (useWebviewBackgroundThrottle), and resumes it
   * the moment it re-enters the viewport. Unknown nodes resolve to
   * {ok:false, skipped:'destroyed'} — normal during teardown races.
   */
  ipcMain.handle(
    'iframe:set-lifecycle',
    async (
      _event,
      payload: { workspaceId: string; nodeId: string; state: WebviewLifecycleState },
    ): Promise<SetWebviewLifecycleResult> => {
      if (
        !payload?.workspaceId ||
        !payload?.nodeId ||
        (payload.state !== 'active' && payload.state !== 'frozen')
      ) {
        return {
          ok: false,
          retryable: false,
          error: 'invalid lifecycle payload',
        };
      }
      const wc = getWebContentsForNode(payload.workspaceId, payload.nodeId);
      if (payload.state === 'frozen') {
        const exemption = getWebviewFreezeExemption(wc ?? null);
        if (exemption) return exemption;
      }
      const key = `${payload.workspaceId}::${payload.nodeId}`;
      if (payload.state === 'frozen' && wc && getFrozenSince(wc) === undefined) {
        // (Guarded against duplicate 'frozen' requests: an already-frozen
        // guest has scripts disabled, so the probe below would time out and
        // replace a good record with a fail-closed dirty one.)
        // Last chance to see the live guest: after freezing the renderer
        // hides the element (frozen guests stop painting) and script
        // execution is disabled, so neither a capture nor a probe would
        // work later. Everything a safe L3 discard + restore needs is
        // captured NOW — snapshot image, dirty-state, real URL, scroll —
        // and stays valid for as long as the page is frozen (scripts are
        // off; no new dirty state can appear). Both calls are time-bounded:
        // capturePage never settles on an already-hidden guest, and a
        // wedged executeJavaScript must not stall the renderer's freeze
        // path (observed in CI); a failed probe yields a dirty record,
        // which simply blocks discard (fail closed).
        const [imageDataUrl, probe] = await Promise.all([
          captureBoundedSnapshot(wc),
          probeFreezeState(wc),
        ]);
        let url = '';
        try {
          url = wc.getURL();
        } catch {
          // destroyed mid-freeze — setWebviewLifecycle below reports it
        }
        rememberFreezeSnapshot(key, buildFreezeRecord(url, imageDataUrl, probe));
      }
      const result = await setWebviewLifecycle(wc ?? null, payload.state);
      if (payload.state === 'active' || (payload.state === 'frozen' && !result.ok)) {
        forgetFreezeSnapshot(key);
      }
      if (!result.ok && result.error) {
        console.warn(
          `[webview-registry] setLifecycle(${payload.state}) failed for ${payload.workspaceId}::${payload.nodeId}: ${result.error}`,
        );
      }
      return result;
    },
  );
}
