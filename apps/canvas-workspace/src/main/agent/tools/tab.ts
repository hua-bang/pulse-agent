import { z } from 'zod';
import { getWebContentsForNode } from '../../webview/registry';
import { ensureOperable } from '../../webview/ensure-operable';
import { activateWorkspaceWindow } from '../../app/window-manager';
import { readDOM, readA11y, captureScreenshot } from '../../webview/reader';
import { getCurrentVersionContent } from '../../artifacts/store';
import { getSessionScrollback } from '../../terminal/scrollback';
import { execInSession } from '../../terminal/pty-manager';
import { getDockTabs } from '../../dock/tab-store';
import { activateDockTab, findDockLinkTab, openDockTab } from '../../dock/tab-actions';
import { searchHistory } from '../../dock/history-store';
import type { AgentContextTabRef } from '../../../shared/agent-chat';
import type { CanvasTool } from './types';

const READINESS_HINT =
  'This is a point-in-time read of a live tab. A "success" does not guarantee the ' +
  'content finished loading — if the data you need looks empty or missing, wait and read again.';

/**
 * Read the live content of a right-dock tab the user `@`-mentioned.
 *
 * Dispatches by tab kind, reusing the existing readers:
 *  - link      → the tab's embedded <webview> (registered under the tab id),
 *                read via the same dom → a11y → screenshot cascade as
 *                canvas_read_webpage.
 *  - artifact  → the current version content from the artifact store.
 *  - terminal  → the capped scrollback tail kept by the PTY manager.
 *  - node-detail → routed to canvas_read_node (a node-detail tab is a canvas
 *                node); this tool returns a pointer rather than duplicating the
 *                node-read path.
 *  - canvas    → routed to canvas_read_context for the previewed workspace.
 */
export function createTabTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_list_tabs: {
      name: 'canvas_list_tabs',
      defer_loading: true,
      description:
        'List the right-dock tabs currently open for this workspace (the browser-like tabs at the top of the dock): ' +
        'open web pages (link), node detail, artifacts, canvas previews, and workspace terminals. ' +
        'Returns each tab with the fields to pass to `canvas_read_tab` (or `canvas_read_node` for node-detail). ' +
        'A link tab id can also be used with `canvas_open_tab` (navigate it) and — when the webview-page-control ' +
        'flag is on — with the page_* tools (click/fill/press/scroll/eval on the live page). ' +
        'Use this to discover what the user is looking at without waiting for them to `@`-mention a tab.',
      inputSchema: z.object({}),
      execute: async (input) => {
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        const tabs = getDockTabs(targetWorkspaceId);
        return JSON.stringify({ ok: true, count: tabs.length, tabs });
      },
    },

    canvas_activate_tab: {
      name: 'canvas_activate_tab',
      defer_loading: true,
      description:
        'Bring an existing right-dock content tab to the front. Pass a tabId returned by canvas_list_tabs. ' +
        'Works for link, artifact, node-detail, canvas-preview, and terminal tabs. This changes focus only; ' +
        'it does not modify, close, rename, or reorder the tab.',
      inputSchema: z.object({
        tabId: z.string().min(1).describe('Open dock tab id from canvas_list_tabs.'),
      }),
      execute: async (input) => {
        const tabId = (input.tabId as string).trim();
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        const tab = getDockTabs(targetWorkspaceId).find((candidate) => candidate.id === tabId);
        if (!tab) {
          return JSON.stringify({
            ok: false,
            error: `Tab ${tabId} is not open in workspace ${targetWorkspaceId}. Call canvas_list_tabs to refresh stale ids.`,
          });
        }
        if (!activateDockTab(targetWorkspaceId, tabId)) {
          return JSON.stringify({ ok: false, error: 'No canvas window is open to activate the tab.' });
        }
        return JSON.stringify({ ok: true, tabId, kind: tab.kind, title: tab.title });
      },
    },

    canvas_open_tab: {
      name: 'canvas_open_tab',
      defer_loading: true,
      description:
        'Open a URL as a web (link) tab in the right dock, or navigate an existing link tab to a new URL.\n' +
        '- Without `tabId`: opens the URL as a dock tab (an already-open tab with the exact same URL is re-activated instead of duplicated).\n' +
        '- With `tabId` (a link tab id from `canvas_list_tabs`): navigates that tab in place, keeping its identity.\n' +
        'Only http(s) URLs are allowed. The new tab id becomes visible via `canvas_list_tabs` once the page starts loading; ' +
        'read the page with `canvas_read_tab` and (when the webview-page-control flag is on) operate it with the page_* tools using the tab id.',
      inputSchema: z.object({
        url: z.string().describe('The http(s) URL to open.'),
        tabId: z
          .string()
          .optional()
          .describe('Existing link tab to navigate (from canvas_list_tabs). Omit to open a new tab.'),
      }),
      execute: async (input) => {
        const url = (input.url as string | undefined)?.trim() ?? '';
        const tabId = (input.tabId as string | undefined)?.trim() || undefined;
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        let protocol = '';
        try {
          protocol = new URL(url).protocol;
        } catch {
          return JSON.stringify({ ok: false, error: `Not a valid URL: ${url}` });
        }
        if (protocol !== 'https:' && protocol !== 'http:') {
          return JSON.stringify({ ok: false, error: `Only http(s) URLs can be opened in a tab (got ${protocol}).` });
        }
        // Unknown tab ids are not an error: the renderer falls back to opening
        // a new tab, but tell the agent so it re-lists instead of assuming.
        // (The main-side tab mirror is per-workspace, so an id can be real yet
        // invisible here — only claim certainty when the mirror confirms it.)
        const knownTab = tabId ? findDockLinkTab(targetWorkspaceId, tabId) : undefined;
        const sent = openDockTab(url, tabId);
        console.info(`[canvas-tab] open-tab url-host=${new URL(url).hostname} tab=${tabId ?? '(new)'} sent=${sent}`);
        if (!sent) {
          return JSON.stringify({ ok: false, error: 'No canvas window is open to receive the tab.' });
        }
        return JSON.stringify({
          ok: true,
          url,
          ...(tabId ? { tabId } : {}),
          ...(tabId && !knownTab
            ? { note: 'tabId was not in this workspace\'s tab list; the dock navigates it if it exists, otherwise it opens the URL as a new tab.' }
            : {}),
          hint: 'Call canvas_list_tabs to get the tab id and confirm it is open, then canvas_read_tab to read the page.',
        });
      },
    },

    canvas_search_history: {
      name: 'canvas_search_history',
      defer_loading: true,
      description:
        'Search the browsing history of the right-dock web tabs (pages the user opened or navigated to in this app). ' +
        'Terms match URL and page title (case-insensitive, all terms must match); results are most-recent first with ' +
        'visit counts and timestamps. Empty query returns the most recently visited pages. ' +
        'Combine with canvas_open_tab to re-open a previously visited page.',
      inputSchema: z.object({
        query: z
          .string()
          .optional()
          .describe('Space-separated terms matched against URL + title. Omit for the most recent pages.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(200)
          .optional()
          .describe('Maximum entries to return. Defaults to 20.'),
      }),
      execute: async (input) => {
        const entries = await searchHistory(
          (input.query as string | undefined) ?? '',
          input.limit as number | undefined,
        );
        return JSON.stringify({ ok: true, count: entries.length, entries });
      },
    },

    canvas_execute_terminal_tab: {
      name: 'canvas_execute_terminal_tab',
      defer_loading: true,
      description:
        'Execute a shell command in an existing right-dock terminal tab and return the captured output. ' +
        'The tab must be open in the current workspace; pass its tabId from canvas_list_tabs. ' +
        'This acts in the tab\'s live PTY session, preserving its cwd and environment.',
      inputSchema: z.object({
        tabId: z.string().min(1).describe('Open terminal tab id from canvas_list_tabs.'),
        command: z.string().min(1).describe('Shell command to execute in the terminal tab.'),
        timeoutMs: z.number().int().positive().max(120_000).optional()
          .describe('Maximum time to collect output. Defaults to 30 seconds; maximum 120 seconds.'),
      }),
      execute: async (input) => {
        const tabId = (input.tabId as string).trim();
        const command = input.command as string;
        const timeoutMs = input.timeoutMs as number | undefined;
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        const tab = getDockTabs(targetWorkspaceId).find((candidate) => candidate.id === tabId);
        if (!tab) {
          return JSON.stringify({
            ok: false,
            error: `Tab ${tabId} is not open in workspace ${targetWorkspaceId}. Call canvas_list_tabs to refresh stale ids.`,
          });
        }
        if (tab.kind !== 'terminal') {
          return JSON.stringify({ ok: false, error: `Tab ${tabId} is not a terminal tab (kind: ${tab.kind}).` });
        }
        if (!tab.sessionId) {
          return JSON.stringify({ ok: false, error: `Terminal tab ${tabId} has no active PTY session.` });
        }
        const result = await execInSession(tab.sessionId, command, { timeout: timeoutMs ?? 30_000 });
        return JSON.stringify(result.ok
          ? { ok: true, kind: 'terminal', tabId, output: result.output ?? '' }
          : { ok: false, kind: 'terminal', tabId, error: result.error ?? 'Terminal command failed.' });
      },
    },

    canvas_read_tab: {
      name: 'canvas_read_tab',
      defer_loading: true,
      description:
        'Read the live content of a right-dock tab the user `@`-mentioned (the browser-like tabs at the top of the dock).\n' +
        'The "Referenced Tabs" block in the request context lists each mentioned tab with the exact parameters to pass here.\n\n' +
        'By `kind`:\n' +
        '- link: reads the open web page inside the tab (auto strategy: dom → a11y → screenshot). Pass `tabId` (and `strategy`/`maxChars` if needed).\n' +
        '- artifact: returns the current version content. Pass `artifactId`.\n' +
        '- terminal: returns the terminal scrollback (recent output). Pass `sessionId`.\n' +
        '- node-detail: a node-detail tab is a canvas node — call `canvas_read_node({ nodeId })` instead.\n' +
        '- canvas: a canvas-preview tab is a workspace — call `canvas_read_context({ workspaceId })` instead.\n\n' +
        'For a `screenshot` result, call canvas_analyze_image({ imagePaths: [imagePath] }) to get a vision description.',
      inputSchema: z.object({
        kind: z
          .enum(['link', 'artifact', 'terminal', 'node-detail', 'canvas'])
          .describe('Tab kind, taken from the Referenced Tabs block.'),
        tabId: z.string().optional().describe('For kind="link": the dock tab id (also the webview registry key).'),
        url: z.string().optional().describe('For kind="link": the current page URL (informational).'),
        artifactId: z.string().optional().describe('For kind="artifact": the artifact id.'),
        sessionId: z.string().optional().describe('For kind="terminal": the PTY session id.'),
        nodeId: z.string().optional().describe('For kind="node-detail": the canvas node id (use canvas_read_node instead).'),
        strategy: z
          .enum(['auto', 'dom', 'a11y', 'screenshot'])
          .optional()
          .describe('For kind="link": reading strategy. Defaults to "auto".'),
        maxChars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('For kind="link"/"terminal": max characters of text. Defaults to 12 000 (link) / all (terminal).'),
      }),
      execute: async (input) => {
        const kind = input.kind as AgentContextTabRef['kind'];
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;

        if (kind === 'node-detail') {
          const nodeId = (input.nodeId as string) || '';
          return JSON.stringify({
            ok: false,
            kind,
            error:
              'A node-detail tab is a canvas node. ' +
              `Call canvas_read_node({ nodeId: "${nodeId}"${targetWorkspaceId ? `, workspaceId: "${targetWorkspaceId}"` : ''} }) to read it.`,
          });
        }

        if (kind === 'canvas') {
          return JSON.stringify({
            ok: false,
            kind,
            error:
              'A canvas-preview tab represents a workspace. ' +
              `Call canvas_read_context({ workspaceId: "${targetWorkspaceId}" }) to inspect it.`,
          });
        }

        if (kind === 'artifact') {
          const artifactId = (input.artifactId as string) || '';
          if (!artifactId) return JSON.stringify({ ok: false, kind, error: 'artifactId is required for an artifact tab.' });
          const artifact = await getCurrentVersionContent(targetWorkspaceId, artifactId);
          if (!artifact) return JSON.stringify({ ok: false, kind, error: `Artifact not found: ${artifactId}` });
          return JSON.stringify({
            ok: true,
            kind,
            artifactType: artifact.type,
            title: artifact.title,
            content: artifact.content,
          });
        }

        if (kind === 'terminal') {
          const sessionId = (input.sessionId as string) || '';
          if (!sessionId) return JSON.stringify({ ok: false, kind, error: 'sessionId is required for a terminal tab.' });
          const maxChars = input.maxChars as number | undefined;
          const result = maxChars ? getSessionScrollback(sessionId, maxChars) : getSessionScrollback(sessionId);
          return JSON.stringify(result.ok
            ? { ok: true, kind, sessionId, text: result.text, textLength: (result.text ?? '').length }
            : { ok: false, kind, error: result.error });
        }

        // kind === 'link'
        const tabId = (input.tabId as string) || '';
        if (!tabId) return JSON.stringify({ ok: false, kind, error: 'tabId is required for a link tab.' });
        const strategy = (input.strategy as 'auto' | 'dom' | 'a11y' | 'screenshot') ?? 'auto';
        const maxChars = (input.maxChars as number) ?? 12_000;
        const sparseThreshold = 200;

        const wc = await ensureOperable({
          lookup: () => getWebContentsForNode(targetWorkspaceId, tabId),
          activate: () => activateWorkspaceWindow(targetWorkspaceId),
          mode: strategy === 'screenshot' ? 'operate' : 'read',
        });
        if (!wc) {
          return JSON.stringify({
            ok: false,
            kind,
            error:
              `No active webview for link tab ${tabId} in workspace ${targetWorkspaceId}. ` +
              'Make sure the tab is open in the dock and has finished loading.',
          });
        }

        if (strategy === 'dom' || strategy === 'auto') {
          const r = await readDOM(wc, maxChars);
          if (strategy === 'dom') {
            return JSON.stringify(r.ok
              ? { ok: true, kind, strategy: 'dom', title: r.title, url: r.url, text: r.text, textLength: r.text.trim().length, hint: READINESS_HINT }
              : { ok: false, kind, strategy: 'dom', error: r.error });
          }
          if (r.ok && r.text.trim().length >= sparseThreshold) {
            return JSON.stringify({ ok: true, kind, strategy: 'dom', title: r.title, url: r.url, text: r.text, textLength: r.text.trim().length, hint: READINESS_HINT });
          }
        }

        if (strategy === 'a11y' || strategy === 'auto') {
          const r = await readA11y(wc);
          if (strategy === 'a11y') {
            return JSON.stringify(r.ok
              ? { ok: true, kind, strategy: 'a11y', text: r.text, textLength: r.text.trim().length, hint: READINESS_HINT }
              : { ok: false, kind, strategy: 'a11y', error: r.error });
          }
          if (r.ok && r.text.trim().length >= sparseThreshold) {
            return JSON.stringify({ ok: true, kind, strategy: 'a11y', text: r.text, textLength: r.text.trim().length, hint: READINESS_HINT });
          }
        }

        const r = await captureScreenshot(wc);
        return JSON.stringify(r.ok
          ? { ok: true, kind, strategy: 'screenshot', imagePath: r.imagePath,
              hint: 'Call canvas_analyze_image({ imagePaths: [imagePath] }) to get a vision description.' }
          : { ok: false, kind, strategy: 'screenshot', error: r.error });
      },
    },
  };
}
