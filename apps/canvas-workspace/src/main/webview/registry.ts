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
import type { AgentContextDomSelectionRef } from '../../shared/agent-chat';

interface RegistryKey {
  workspaceId: string;
  nodeId: string;
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
const PICK_TIMEOUT_MS = 45_000;
const DOM_SELECTION_MAX_TEXT = 4_000;
const DOM_SELECTION_MAX_HTML = 8_000;

function domSelectionScript(workspaceId: string, nodeId: string): string {
  return `
    (function () {
      var WORKSPACE_ID = ${JSON.stringify(workspaceId)};
      var NODE_ID = ${JSON.stringify(nodeId)};
      var TIMEOUT_MS = ${PICK_TIMEOUT_MS};
      var MAX_TEXT = ${DOM_SELECTION_MAX_TEXT};
      var MAX_HTML = ${DOM_SELECTION_MAX_HTML};

      if (window.__pulseDomPickerCancel) {
        try { window.__pulseDomPickerCancel('replaced by a new picker'); } catch (_) {}
      }

      return new Promise(function (resolve) {
        var doc = document;
        var activeElement = null;
        var settled = false;
        var style = doc.createElement('style');
        style.textContent = [
          '.pulse-dom-picker-outline {',
          '  position: fixed;',
          '  z-index: 2147483646;',
          '  pointer-events: none;',
          '  border: 2px solid #2383e2;',
          '  background: rgba(35, 131, 226, 0.10);',
          '  box-shadow: 0 0 0 99999px rgba(15, 23, 42, 0.08);',
          '  border-radius: 4px;',
          '}',
          '.pulse-dom-picker-label {',
          '  position: fixed;',
          '  z-index: 2147483647;',
          '  pointer-events: none;',
          '  max-width: min(420px, calc(100vw - 24px));',
          '  padding: 5px 7px;',
          '  border-radius: 5px;',
          '  background: #111827;',
          '  color: #fff;',
          '  font: 12px/1.3 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;',
          '  box-shadow: 0 8px 24px rgba(15, 23, 42, 0.22);',
          '  white-space: nowrap;',
          '  overflow: hidden;',
          '  text-overflow: ellipsis;',
          '}'
        ].join('');
        var outline = doc.createElement('div');
        outline.className = 'pulse-dom-picker-outline';
        var label = doc.createElement('div');
        label.className = 'pulse-dom-picker-label';
        label.textContent = 'Click an element to add it to AI Chat · Esc to cancel';
        doc.documentElement.appendChild(style);
        doc.documentElement.appendChild(outline);
        doc.documentElement.appendChild(label);

        function cleanText(value, max) {
          value = String(value || '').replace(/\\s+/g, ' ').trim();
          return value.length > max ? value.slice(0, max) + '\\n\\n[...truncated]' : value;
        }

        function escapeCss(value) {
          if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(value);
          return String(value).replace(/[^a-zA-Z0-9_-]/g, function (ch) {
            var hex = ch.charCodeAt(0).toString(16);
            return '\\\\' + hex + ' ';
          });
        }

        function uniqueSelector(el) {
          if (!(el instanceof Element)) return '';
          if (el.id) {
            var byId = '#' + escapeCss(el.id);
            try {
              if (doc.querySelectorAll(byId).length === 1) return byId;
            } catch (_) {}
          }
          var preferredAttrs = ['data-testid', 'data-test', 'data-cy', 'aria-label', 'name'];
          for (var ai = 0; ai < preferredAttrs.length; ai += 1) {
            var attr = preferredAttrs[ai];
            var val = el.getAttribute(attr);
            if (!val) continue;
            var candidate = el.tagName.toLowerCase() + '[' + attr + '=' + JSON.stringify(val) + ']';
            try {
              if (doc.querySelectorAll(candidate).length === 1) return candidate;
            } catch (_) {}
          }
          var parts = [];
          var cur = el;
          while (cur && cur.nodeType === 1 && cur !== doc.documentElement) {
            var part = cur.tagName.toLowerCase();
            if (cur.id) {
              part += '#' + escapeCss(cur.id);
              parts.unshift(part);
              break;
            }
            var cls = Array.prototype.slice.call(cur.classList || [])
              .filter(function (name) { return name && !/^\\d/.test(name); })
              .slice(0, 2)
              .map(function (name) { return '.' + escapeCss(name); })
              .join('');
            if (cls) part += cls;
            var parent = cur.parentElement;
            if (parent) {
              var siblings = Array.prototype.filter.call(parent.children, function (child) {
                return child.tagName === cur.tagName;
              });
              if (siblings.length > 1) part += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
            }
            parts.unshift(part);
            var selector = parts.join(' > ');
            try {
              if (doc.querySelectorAll(selector).length === 1) return selector;
            } catch (_) {}
            cur = parent;
          }
          return parts.join(' > ');
        }

        function labelFor(el) {
          var attr = el.getAttribute('aria-label')
            || el.getAttribute('title')
            || el.getAttribute('alt')
            || el.getAttribute('placeholder')
            || el.getAttribute('data-testid')
            || el.getAttribute('name')
            || '';
          var text = cleanText(attr || el.innerText || el.textContent || '', 96);
          var tag = el.tagName ? el.tagName.toLowerCase() : 'element';
          if (text) return tag + ': ' + text;
          if (el.id) return tag + '#' + el.id;
          if (el.className && typeof el.className === 'string') {
            return tag + '.' + el.className.trim().split(/\\s+/).slice(0, 2).join('.');
          }
          return tag;
        }

        function details(el) {
          var rect = el.getBoundingClientRect();
          return {
            id: 'dom-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8),
            label: labelFor(el),
            workspaceId: WORKSPACE_ID,
            nodeId: NODE_ID,
            url: location.href,
            selector: uniqueSelector(el),
            tagName: el.tagName ? el.tagName.toLowerCase() : '',
            rect: {
              x: Math.round(rect.left),
              y: Math.round(rect.top),
              width: Math.round(rect.width),
              height: Math.round(rect.height),
              scrollX: Math.round(window.scrollX || 0),
              scrollY: Math.round(window.scrollY || 0)
            },
            text: cleanText(el.innerText || el.textContent || '', MAX_TEXT),
            html: cleanText(el.outerHTML || '', MAX_HTML)
          };
        }

        function setBox(el) {
          if (!(el instanceof Element)) return;
          activeElement = el;
          var r = el.getBoundingClientRect();
          outline.style.left = Math.max(0, r.left) + 'px';
          outline.style.top = Math.max(0, r.top) + 'px';
          outline.style.width = Math.max(1, r.width) + 'px';
          outline.style.height = Math.max(1, r.height) + 'px';
          var top = Math.max(8, r.top - 30);
          if (r.top < 36) top = Math.min(window.innerHeight - 28, r.bottom + 6);
          label.style.left = Math.max(8, Math.min(r.left, window.innerWidth - 24)) + 'px';
          label.style.top = top + 'px';
          label.textContent = labelFor(el);
        }

        function finish(result) {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(result);
        }

        function cleanup() {
          clearTimeout(timer);
          doc.removeEventListener('mousemove', onMove, true);
          doc.removeEventListener('mousedown', onMouseDown, true);
          doc.removeEventListener('mouseup', onMouseUp, true);
          doc.removeEventListener('click', onClick, true);
          doc.removeEventListener('keydown', onKeyDown, true);
          window.removeEventListener('scroll', onScroll, true);
          try { outline.remove(); } catch (_) {}
          try { label.remove(); } catch (_) {}
          try { style.remove(); } catch (_) {}
          if (window.__pulseDomPickerCancel === cancel) delete window.__pulseDomPickerCancel;
        }

        function cancel(reason) {
          finish({ ok: false, cancelled: true, error: reason || 'cancelled' });
        }

        function onMove(event) {
          var target = event.target;
          if (target instanceof Element) setBox(target);
        }

        function onScroll() {
          if (activeElement) setBox(activeElement);
        }

        function block(event) {
          event.preventDefault();
          event.stopPropagation();
          if (typeof event.stopImmediatePropagation === 'function') event.stopImmediatePropagation();
        }

        function onMouseDown(event) {
          block(event);
        }

        function onMouseUp(event) {
          block(event);
        }

        function onClick(event) {
          block(event);
          var target = activeElement || event.target;
          if (!(target instanceof Element)) {
            finish({ ok: false, error: 'No element under pointer' });
            return;
          }
          finish({ ok: true, selection: details(target) });
        }

        function onKeyDown(event) {
          if (event.key === 'Escape') {
            block(event);
            cancel('cancelled');
          }
        }

        var timer = setTimeout(function () {
          finish({ ok: false, error: 'DOM picker timed out' });
        }, TIMEOUT_MS);
        window.__pulseDomPickerCancel = cancel;
        doc.addEventListener('mousemove', onMove, true);
        doc.addEventListener('mousedown', onMouseDown, true);
        doc.addEventListener('mouseup', onMouseUp, true);
        doc.addEventListener('click', onClick, true);
        doc.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('scroll', onScroll, true);
        setBox(doc.body || doc.documentElement);
      });
    })();
  `;
}

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
    const result = await wc.executeJavaScript(domSelectionScript(workspaceId, nodeId), true) as {
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

  ipcMain.handle(
    'iframe:pick-dom-element',
    async (_event, payload: { workspaceId: string; nodeId: string }) => {
      if (!payload?.workspaceId || !payload?.nodeId) {
        return { ok: false, error: 'workspaceId and nodeId are required' };
      }
      return pickDomElementForNode(payload.workspaceId, payload.nodeId);
    },
  );
}
