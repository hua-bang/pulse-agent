import { randomUUID } from 'crypto';
import { z } from 'zod';
import { getWebContentsForNode } from '../../webview/registry';
import { ensureOperable } from '../../webview/ensure-operable';
import { activateWorkspaceWindow } from '../../app/window-manager';
import { readDOM, readA11y, captureScreenshot } from '../../webview/reader';
import { getCurrentVersionContent } from '../../artifacts/store';
import { getSessionScrollback } from '../../terminal/scrollback';
import { execInSession } from '../../terminal/pty-manager';
import { getDockTabs } from '../../dock/tab-store';
import { searchHistory } from '../../dock/history-store';
import {
  executeCapabilityAsCanvasTool,
  getCanvasCapabilityRuntime,
} from '../../runtime/capabilities';
import type { AgentContextTabRef } from '../../../shared/agent-chat';
import type { CanvasTool, CanvasToolExecutionContext } from './types';

const READINESS_HINT =
  'This is a point-in-time read of a live tab. A "success" does not guarantee the ' +
  'content finished loading — if the data you need looks empty or missing, wait and read again.';

async function confirmTerminalExecution(
  command: string,
  ctx?: CanvasToolExecutionContext,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (ctx?.runContext?.executionMode !== 'ask') return { ok: true };
  const ask = ctx.onClarificationRequest;
  if (!ask) {
    return { ok: false, error: 'Terminal command requires confirmation in ask mode, but confirmation is unavailable.' };
  }
  const answer = await ask({
    id: randomUUID(),
    question: `Run this command in the Dock terminal? ${command}`,
    context: 'Terminal commands can modify files, start processes, or access the network.',
    timeout: 0,
  });
  const affirmative = /^(?:y|yes|ok|okay|confirm|confirmed|go|run|可以|好|好的|确认|同意|执行|运行)[.!。！\s]*$/i.test(answer.trim());
  return affirmative
    ? { ok: true }
    : { ok: false, error: 'Terminal command was not confirmed by the user.' };
}

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
        'List open right-dock tabs: link, node-detail, artifact, canvas preview, and terminal. ' +
        'Returns ids for `canvas_read_tab`, `canvas_activate_tab`, and resource-specific tools. ' +
        'For a link tab already open here, read it with `canvas_read_tab` (or drive it with enabled page_* controls).',
      inputSchema: z.object({}),
      execute: async (input, ctx) => {
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        return executeCapabilityAsCanvasTool(
          getCanvasCapabilityRuntime(),
          'browser.tabs.list',
          targetWorkspaceId,
          input,
          ctx,
        );
      },
    },

    canvas_activate_tab: {
      name: 'canvas_activate_tab',
      defer_loading: true,
      description:
        'Bring an open right-dock tab to the front by tabId from canvas_list_tabs. ' +
        'This changes focus only; it cannot close, rename, or reorder tabs.',
      inputSchema: z.object({
        tabId: z.string().min(1).describe('Open dock tab id from canvas_list_tabs.'),
      }),
      execute: async (input, ctx) => {
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        return executeCapabilityAsCanvasTool(
          getCanvasCapabilityRuntime(),
          'browser.tabs.activate',
          targetWorkspaceId,
          input,
          ctx,
        );
      },
    },

    canvas_open_tab: {
      name: 'canvas_open_tab',
      defer_loading: true,
      description:
        'Open an http(s) URL as a visible right-dock link tab in the user\'s dock (spawns a live webview). ' +
        'This is a user-facing UI action — use it ONLY when the user explicitly asks to open/show a page, ' +
        'or when they want to interact with a live page (page_* click/fill/navigate) that is not open yet. ' +
        'To merely read or research a URL, do NOT open a tab: use tavily_extract / tavily, or canvas_read_webpage / canvas_read_tab for pages already open. ' +
        'Omit tabId to open or reactivate by URL; pass a link tabId from canvas_list_tabs to navigate that tab in place.',
      inputSchema: z.object({
        url: z.string().describe('The http(s) URL to open.'),
        tabId: z
          .string()
          .optional()
          .describe('Existing link tab to navigate (from canvas_list_tabs). Omit to open a new tab.'),
      }),
      execute: async (input, ctx) => {
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        return executeCapabilityAsCanvasTool(
          getCanvasCapabilityRuntime(),
          'browser.tabs.open',
          targetWorkspaceId,
          input,
          ctx,
        );
      },
    },

    canvas_search_history: {
      name: 'canvas_search_history',
      defer_loading: true,
      description:
        'Search right-dock web-tab history by URL/title. All terms match case-insensitively; ' +
        'results are newest first. Empty query returns recent pages. ' +
        'If the user explicitly wants a result reopened in their dock, use canvas_open_tab.',
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
        'Run a shell command in an open right-dock terminal tab from canvas_list_tabs. ' +
        'Uses its live PTY (preserving cwd/environment) and returns captured output.',
      inputSchema: z.object({
        tabId: z.string().min(1).describe('Open terminal tab id from canvas_list_tabs.'),
        command: z.string().min(1).describe('Shell command to execute in the terminal tab.'),
        timeoutMs: z.number().int().positive().max(120_000).optional()
          .describe('Maximum time to collect output. Defaults to 30 seconds; maximum 120 seconds.'),
      }),
      execute: async (input, ctx) => {
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
        const confirmation = await confirmTerminalExecution(command, ctx);
        if (!confirmation.ok) {
          return JSON.stringify({ ok: false, kind: 'terminal', tabId, error: confirmation.error });
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
        'Read live right-dock tab content. Use fields from Referenced Tabs or canvas_list_tabs. ' +
        'link requires tabId (dom/a11y/screenshot); artifact requires artifactId; terminal requires sessionId. ' +
        'For node-detail use canvas_read_node, and for canvas preview use canvas_read_context. ' +
        'Analyze screenshot results with canvas_analyze_image.',
      inputSchema: z.object({
        kind: z
          .enum(['link', 'artifact', 'terminal', 'node-detail', 'canvas'])
          .describe('Tab kind, taken from the Referenced Tabs block.'),
        tabId: z.string().optional().describe('For kind="link": the dock tab id (also the webview registry key).'),
        url: z.string().optional().describe('For kind="link": the current page URL (informational).'),
        artifactId: z.string().optional().describe('For kind="artifact": the artifact id.'),
        sessionId: z.string().optional().describe('For kind="terminal": the PTY session id.'),
        nodeId: z.string().optional().describe('For kind="node-detail": the canvas node id (use canvas_read_node instead).'),
        workspaceId: z.string().optional().describe('Content workspace for canvas/node/artifact tabs. Defaults to the current workspace.'),
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
