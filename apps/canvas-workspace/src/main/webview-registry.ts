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
import { ipcMain, shell, webContents as allWebContents, type WebContents } from 'electron';
import { isSafeExternalUrl } from './shell-ipc';

interface RegistryKey {
  workspaceId: string;
  nodeId: string;
}

/**
 * Install the popup handler on a webview's webContents.
 *
 * Idempotent: Electron's `setWindowOpenHandler` only keeps the most recent
 * handler, so calling it again from another entry point (e.g. the renderer
 * registration IPC) just overwrites with the same logic.
 *
 * The handler must be installed *before* the embedded page runs JavaScript,
 * otherwise SPA-driven `window.open` calls (Feishu / Lark / Notion / etc.)
 * fire against the Electron default, which silently denies popups in
 * modern Electron — and to the user that looks like "the link does
 * nothing at all". `did-attach-webview` on the host BrowserWindow is the
 * earliest reliable hook for this; the IPC-driven registration path is a
 * safety net for any case where that event was missed.
 */
export function installWebviewPopupHandler(wc: WebContents): void {
  if (wc.isDestroyed()) return;
  wc.setWindowOpenHandler(({ url }) => {
    const safe = isSafeExternalUrl(url);
    console.log(
      `[webview-registry] window.open intercepted url=${url || '<empty>'} safe=${safe}`,
    );
    if (safe) {
      shell.openExternal(url).catch((err) => {
        console.warn(
          `[webview-registry] shell.openExternal failed for ${url}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }
    return { action: 'deny' };
  });
}

function keyOf(k: RegistryKey): string {
  return `${k.workspaceId}::${k.nodeId}`;
}

const registry = new Map<string, number>();

function register(k: RegistryKey, webContentsId: number): void {
  registry.set(keyOf(k), webContentsId);
}

function unregister(k: RegistryKey): void {
  registry.delete(keyOf(k));
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
  if (!wc || wc.isDestroyed()) return null;
  return wc;
}

const EXTRACT_TIMEOUT_MS = 8_000;
const EXTRACT_MAX_CHARS = 200_000;

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
    unregister({ workspaceId, nodeId });
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
    (_event, payload: { workspaceId: string; nodeId: string; webContentsId: number }) => {
      if (!payload?.workspaceId || !payload?.nodeId || typeof payload.webContentsId !== 'number') {
        console.warn('[webview-registry] rejected register:', payload);
        return { ok: false };
      }
      register(
        { workspaceId: payload.workspaceId, nodeId: payload.nodeId },
        payload.webContentsId,
      );
      const wc = allWebContents.fromId(payload.webContentsId);
      if (wc) installWebviewPopupHandler(wc);
      console.log(
        `[webview-registry] registered ${payload.workspaceId}::${payload.nodeId} → wc#${payload.webContentsId} (${registry.size} total)`,
      );
      return { ok: true };
    },
  );

  ipcMain.handle(
    'iframe:unregister-webview',
    (_event, payload: { workspaceId: string; nodeId: string }) => {
      if (!payload?.workspaceId || !payload?.nodeId) return { ok: false };
      unregister({ workspaceId: payload.workspaceId, nodeId: payload.nodeId });
      console.log(
        `[webview-registry] unregistered ${payload.workspaceId}::${payload.nodeId} (${registry.size} remaining)`,
      );
      return { ok: true };
    },
  );
}
