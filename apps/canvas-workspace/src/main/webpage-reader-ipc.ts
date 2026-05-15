/**
 * webpage-reader-ipc — multi-strategy web reader for Canvas Agent.
 *
 * Strategy cascade (cf's design):
 *   1. a11y   — Chrome DevTools Protocol Accessibility.getFullAXTree.
 *               Returns rich semantic structure (roles, names, descriptions).
 *   2. dom    — executeJavaScript innerText extraction from a live Chromium page.
 *   3. screenshot — capturePage() → base64 PNG, ready for vision models.
 *
 * All strategies load the target URL in a hidden BrowserWindow so JavaScript
 * runs and SPAs render before extraction.  The window is destroyed after
 * each call.
 */

import { BrowserWindow, ipcMain } from 'electron';
import { isSafeExternalUrl } from './shell-ipc';

// ---------------------------------------------------------------------------
// Domain → skill hint mapping
// ---------------------------------------------------------------------------
const DOMAIN_SKILL_MAP: Record<string, string> = {
  'github.com': 'github',
  'twitter.com': 'twitter-reader',
  'x.com': 'twitter-reader',
  't.co': 'twitter-reader',
};

function extractHostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function findSkillHint(hostname: string): string | undefined {
  if (DOMAIN_SKILL_MAP[hostname]) return DOMAIN_SKILL_MAP[hostname];
  const parts = hostname.split('.');
  for (let i = 1; i < parts.length - 1; i++) {
    const candidate = parts.slice(i).join('.');
    if (DOMAIN_SKILL_MAP[candidate]) return DOMAIN_SKILL_MAP[candidate];
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Hidden-window helpers
// ---------------------------------------------------------------------------

const LOAD_TIMEOUT_MS = 15_000;
const EXTRACT_TIMEOUT_MS = 8_000;

/** Create a hidden BrowserWindow, navigate to `url`, wait until loaded. */
async function openHiddenWindow(url: string): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    show: false,
    width: 1280,
    height: 900,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      javascript: true,
    },
  });

  await Promise.race([
    new Promise<void>((resolve, reject) => {
      win.webContents.once('did-finish-load', resolve);
      win.webContents.once('did-fail-load', (_e: unknown, code: number, desc: string) =>
        reject(new Error(`Page load failed: ${desc} (${code})`)),
      );
      win.loadURL(url).catch(reject);
    }),
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`Load timed out after ${LOAD_TIMEOUT_MS}ms`)), LOAD_TIMEOUT_MS),
    ),
  ]);

  // Give JS a moment to finish rendering (SPAs, dynamic content).
  await new Promise((r) => setTimeout(r, 800));

  return win;
}

// ---------------------------------------------------------------------------
// Strategy 1: Accessibility tree via CDP
// ---------------------------------------------------------------------------

interface A11yNode {
  role?: string;
  name?: string;
  description?: string;
  value?: string;
  children?: A11yNode[];
}

/** Recursively build a readable text representation of an AX tree. */
function flattenA11yNodes(
  nodes: Array<{ role?: { value?: string }; name?: { value?: string }; description?: { value?: string }; value?: { value?: string }; backendDOMNodeId?: number; childIds?: string[] }>,
  idMap: Map<string, (typeof nodes)[number]>,
  nodeId: string,
  depth = 0,
  lines: string[] = [],
): string[] {
  const node = idMap.get(nodeId);
  if (!node) return lines;

  const role = node.role?.value ?? '';
  const name = node.name?.value?.trim() ?? '';
  const desc = node.description?.value?.trim() ?? '';
  const value = node.value?.value?.trim() ?? '';

  if (role && role !== 'none' && role !== 'unknown' && role !== 'generic') {
    const parts: string[] = [role];
    if (name) parts.push(`"${name}"`);
    if (desc) parts.push(`(${desc})`);
    if (value) parts.push(`= ${value}`);
    lines.push(`${'  '.repeat(depth)}${parts.join(' ')}`);
  }

  for (const childId of node.childIds ?? []) {
    flattenA11yNodes(nodes, idMap, childId, depth + 1, lines);
  }

  return lines;
}

async function readA11y(url: string): Promise<{ ok: boolean; text: string; error?: string }> {
  let win: BrowserWindow | null = null;
  try {
    win = await openHiddenWindow(url);
    const wc = win.webContents;

    wc.debugger.attach('1.3');
    await wc.debugger.sendCommand('Accessibility.enable');

    const result = await Promise.race([
      wc.debugger.sendCommand('Accessibility.getFullAXTree') as Promise<{
        nodes: Array<{
          nodeId: string;
          role?: { value?: string };
          name?: { value?: string };
          description?: { value?: string };
          value?: { value?: string };
          childIds?: string[];
        }>;
      }>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('a11y extraction timed out')), EXTRACT_TIMEOUT_MS),
      ),
    ]);

    wc.debugger.detach();

    const { nodes } = result;
    const idMap = new Map(nodes.map((n) => [n.nodeId, n]));

    // Root is typically the first node
    const root = nodes[0];
    const lines = root ? flattenA11yNodes(nodes, idMap, root.nodeId) : [];
    const text = lines.join('\n');

    return { ok: true, text: text || '(empty a11y tree)' };
  } catch (err) {
    return { ok: false, text: '', error: err instanceof Error ? err.message : String(err) };
  } finally {
    win?.destroy();
  }
}

// ---------------------------------------------------------------------------
// Strategy 2: DOM text via executeJavaScript
// ---------------------------------------------------------------------------

async function readDOM(url: string, maxChars: number): Promise<{ ok: boolean; text: string; title: string; error?: string }> {
  let win: BrowserWindow | null = null;
  try {
    win = await openHiddenWindow(url);
    const wc = win.webContents;

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

    const raw = await Promise.race([
      wc.executeJavaScript(script, false) as Promise<{
        ok: boolean;
        title?: string;
        text?: string;
        url?: string;
        error?: string;
      }>,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('DOM extraction timed out')), EXTRACT_TIMEOUT_MS),
      ),
    ]);

    if (!raw.ok) return { ok: false, text: '', title: '', error: raw.error };

    const cleaned = (raw.text ?? '').replace(/\s+/g, ' ').trim();
    const truncated = maxChars > 0 && cleaned.length > maxChars;
    const text = truncated ? cleaned.slice(0, maxChars) + '\n\n[…content truncated]' : cleaned;

    return { ok: true, text, title: raw.title ?? '' };
  } catch (err) {
    return { ok: false, text: '', title: '', error: err instanceof Error ? err.message : String(err) };
  } finally {
    win?.destroy();
  }
}

// ---------------------------------------------------------------------------
// Strategy 3: Screenshot
// ---------------------------------------------------------------------------

async function captureScreenshot(url: string): Promise<{ ok: boolean; dataUrl: string; error?: string }> {
  let win: BrowserWindow | null = null;
  try {
    win = await openHiddenWindow(url);
    const image = await win.webContents.capturePage();
    const dataUrl = image.toDataURL();
    return { ok: true, dataUrl };
  } catch (err) {
    return { ok: false, dataUrl: '', error: err instanceof Error ? err.message : String(err) };
  } finally {
    win?.destroy();
  }
}

// ---------------------------------------------------------------------------
// IPC payload types
// ---------------------------------------------------------------------------

export type WebReadStrategy = 'auto' | 'a11y' | 'dom' | 'screenshot';

export interface WebReadInput {
  url: string;
  strategy?: WebReadStrategy;
  maxChars?: number;
  sparseThreshold?: number;
}

export type WebReadResult =
  | { ok: true;  url: string; strategy: 'skill_hint'; skillHint: string }
  | { ok: true;  url: string; strategy: 'a11y';       text: string }
  | { ok: true;  url: string; strategy: 'dom';        text: string; title: string }
  | { ok: true;  url: string; strategy: 'screenshot'; dataUrl: string }
  | { ok: false; url: string; strategy: WebReadStrategy; error: string };

// ---------------------------------------------------------------------------
// IPC setup
// ---------------------------------------------------------------------------

export function setupWebpageReaderIpc(): void {
  ipcMain.handle(
    'web:read',
    async (_event: unknown, payload: WebReadInput): Promise<WebReadResult> => {
      const rawUrl = payload?.url?.trim() ?? '';

      // Normalise + validate
      const url = rawUrl.startsWith('http://') || rawUrl.startsWith('https://')
        ? rawUrl
        : `https://${rawUrl}`;

      if (!isSafeExternalUrl(url)) {
        return { ok: false, url, strategy: payload?.strategy ?? 'auto', error: 'Invalid or unsafe URL' };
      }

      const strategy: WebReadStrategy = payload?.strategy ?? 'auto';
      const maxChars = payload?.maxChars ?? 12_000;
      const sparseThreshold = payload?.sparseThreshold ?? 200;
      const hostname = extractHostname(url);

      // ── Skill hint (auto only) ────────────────────────────────────────────
      if (strategy === 'auto') {
        const hint = findSkillHint(hostname);
        if (hint) {
          return { ok: true, url, strategy: 'skill_hint', skillHint: hint };
        }
      }

      // ── a11y ─────────────────────────────────────────────────────────────
      if (strategy === 'a11y' || strategy === 'auto') {
        const result = await readA11y(url);
        if (strategy === 'a11y') {
          return result.ok
            ? { ok: true, url, strategy: 'a11y', text: result.text }
            : { ok: false, url, strategy: 'a11y', error: result.error! };
        }
        // auto: use if non-sparse
        if (result.ok && result.text.trim().length >= sparseThreshold) {
          return { ok: true, url, strategy: 'a11y', text: result.text };
        }
      }

      // ── DOM text ─────────────────────────────────────────────────────────
      if (strategy === 'dom' || strategy === 'auto') {
        const result = await readDOM(url, maxChars);
        if (strategy === 'dom') {
          return result.ok
            ? { ok: true, url, strategy: 'dom', text: result.text, title: result.title }
            : { ok: false, url, strategy: 'dom', error: result.error! };
        }
        // auto: use if non-sparse
        if (result.ok && result.text.trim().length >= sparseThreshold) {
          return { ok: true, url, strategy: 'dom', text: result.text, title: result.title };
        }
      }

      // ── Screenshot ───────────────────────────────────────────────────────
      const result = await captureScreenshot(url);
      return result.ok
        ? { ok: true, url, strategy: 'screenshot', dataUrl: result.dataUrl }
        : { ok: false, url, strategy: 'screenshot', error: result.error! };
    },
  );
}
