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
import { activateWorkspaceWindow } from '../app/window-manager';
import { createDomPickerScript } from './dom-snapshot-script';
import { ensureOperable } from './ensure-operable';

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
    const wc = allWebContents.fromId(webContentsId);
    wc?.once('destroyed', () => unregister(k, webContentsId));
  }
  if (ready) recordWelcomeReadyForPerf(k);
}

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
    unregister({ workspaceId, nodeId }, id);
    return null;
  }
  return wc;
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
  const wc = await ensureOperable({
    lookup: () => getWebContentsForNode(workspaceId, nodeId),
    activate: () => activateWorkspaceWindow(workspaceId, nodeId),
    mode: 'operate',
  });
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

  try {
    result = await Promise.race([
      wc.executeJavaScript(script, /* userGesture */ false),
      new Promise<null>((resolve) =>
        setTimeout(() => resolve(null), EXTRACT_TIMEOUT_MS),
      ),
    ]);
  } catch {
    return null;
  }

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
        `[webview-registry] ${removed ? 'unregistered' : 'ignored stale unregister for'} ${payload.workspaceId}::${payload.nodeId} wc#${payload.webContentsId} (${registry.size} remaining)`,
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

}
