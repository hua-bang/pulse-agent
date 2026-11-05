import { z } from 'zod';
import { getWebContentsForNode } from '../../../webview/registry';
import { ensureOperable } from '../../../webview/ensure-operable';
import { findDockLinkTab } from '../../../dock/tab-actions';
import { readDOMElement } from '../../../webview/reader';
import { PAGE_READINESS_HINT } from '../../../../shared/page-readiness';
import {
  PLUGIN_PAGE_WORKSPACE_ID,
  parsePluginPageTargetId,
  webviewRegistryKeyFor,
} from '../../../../shared/webview-registration';
import { getAgentCapabilityPort } from '../../capability-port';
import type { CanvasTool } from '../types';
import { getCanvasWindowPort } from '../../window-port';

export function createWebpageTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    browser_read_dom_selection: {
      name: 'browser_read_dom_selection',
      defer_loading: true,
      description:
        'Read one DOM element inside a canvas iframe/webview node or right-dock web tab using a CSS selector. ' +
        'Use this when the user picked a DOM region and the current request is about that specific region. ' +
        'The selector usually comes from the domSelections block in the request context. Returns text, capped HTML, rect, structured descendant tree, controls, title, and URL.',
      inputSchema: z.object({
        nodeId: z.string().describe('ID of the iframe canvas node, right-dock web tab, or plugin page.'),
        selector: z.string().describe('CSS selector for the selected DOM element.'),
        maxChars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum characters for text output. Defaults to 12 000.'),
      }),
      execute: async (input) => {
        const nodeId = input.nodeId as string;
        const targetWorkspaceId = (input.workspaceId as string) || workspaceId;
        const selector = input.selector as string;
        const maxChars = (input.maxChars as number) ?? 12_000;
        const key = webviewRegistryKeyFor(targetWorkspaceId, nodeId);
        const dockTab = findDockLinkTab(targetWorkspaceId, nodeId);
        const isDockTab = key.isPluginPage || Boolean(dockTab || nodeId.startsWith('link:'));
        // Dock tabs and plugin pages are app-level surfaces. If the guest is
        // being remounted, report the stale target instead of activating a
        // workspace and changing the user's current route just to read it.
        const wc = isDockTab
          ? getWebContentsForNode(key.workspaceId, key.nodeId)
          : await ensureOperable({
              lookup: () => getWebContentsForNode(targetWorkspaceId, nodeId),
              activate: () => getCanvasWindowPort().activateWorkspaceWindow(targetWorkspaceId),
              mode: 'read',
            });
        if (!wc) {
          return JSON.stringify({
            ok: false,
            error:
              `No live webview for ${isDockTab ? 'dock link tab' : 'node'} ${nodeId} in workspace ${targetWorkspaceId}. ` +
              (isDockTab
                ? 'The tab is not mounted or is being restored; retry after it finishes loading.'
                : '(auto-activation attempted). Make sure the iframe node still exists and is loaded.'),
          });
        }
        const r = await readDOMElement(wc, selector, maxChars);
        return JSON.stringify(r.ok
          ? {
              ok: true,
              strategy: 'dom-selection',
              title: r.title,
              url: r.url,
              selector: r.selector,
              tagName: r.tagName,
              rect: r.rect,
              text: r.text,
              html: r.html,
              htmlPreview: r.htmlPreview,
              tree: r.tree,
              controls: r.controls,
              accessibility: r.accessibility,
              snapshot: r.snapshot,
              textLength: r.text.trim().length,
              hint: PAGE_READINESS_HINT,
            }
          : { ok: false, strategy: 'dom-selection', selector: r.selector, error: r.error });
      },
    },

    browser_read_page: {
      name: 'browser_read_page',
      defer_loading: true,
      description:
        'Read a webpage that is currently open in a canvas iframe node or a plugin page using the richest available strategy.\n' +
        'Requires the iframe node to be mounted and loaded in the canvas, or the plugin page to be open.\n' +
        'This is a point-in-time snapshot: if the data you need (e.g. table rows) looks empty, the page may ' +
        'still be loading — use page_wait_for for that content, then read again rather than reporting an empty result.\n\n' +
        'Strategy options (default: auto):\n' +
        '- auto: tries dom first; if content is too sparse, upgrades to a11y; final fallback is screenshot.\n' +
        '- dom: innerText extraction — fast, safe, works for any text-heavy page.\n' +
        '- a11y: Chrome accessibility tree (roles, names, descriptions) — richer semantic structure.\n' +
        '- screenshot: saves the exact viewport as a PNG file and returns imagePath. ' +
        'Then call image_analyze({ imagePaths: [imagePath] }) to get a vision description.\n\n' +
        'Prefer this over canvas_read_node for iframe nodes when you need a11y structure or a screenshot.',
      inputSchema: z.object({
        nodeId: z.string().describe('ID of the iframe canvas node, or a plugin page id such as plugin:weread/main.'),
        strategy: z
          .enum(['auto', 'dom', 'a11y', 'screenshot'])
          .optional()
          .describe('Reading strategy. Defaults to "auto" (dom → a11y → screenshot).'),
        maxChars: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Maximum characters for DOM text output. Defaults to 12 000.'),
        sparseThreshold: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe(
            'Minimum character count for DOM/a11y output to be considered useful in auto mode. ' +
              'Falls back to the next strategy if below this threshold. Defaults to 200.',
          ),
      }),
      execute: (input, context) => callPageCapability('browser.page.read', input, workspaceId, context),
    },

    browser_read_selection: {
      name: 'browser_read_selection',
      defer_loading: true,
      description:
        'Read the text the user selected in a canvas iframe node, right-dock web tab, or plugin page, '
        + 'with a short piece of the text before and after it. Use it when the user says "this passage", '
        + '"what I selected", or similar. hasSelection is false when nothing is selected.',
      inputSchema: z.object({
        nodeId: z.string().describe('ID of the iframe canvas node, right-dock web tab, or plugin page.'),
        maxChars: z.number().int().positive().optional().describe('Maximum selected characters. Defaults to 8 000.'),
      }),
      execute: (input, context) => callPageCapability('browser.page.selection', input, workspaceId, context),
    },
  };
}

async function callPageCapability(
  name: string,
  input: Record<string, unknown>,
  workspaceId: string,
  context: { abortSignal?: AbortSignal } | undefined,
): Promise<string> {
  const { workspaceId: inputWorkspaceId, ...capabilityInput } = input;
  // A plugin page read needs no workspace; the reserved id satisfies the
  // runtime's workspace check when the chat has none (Global chat).
  const targetWorkspaceId = (inputWorkspaceId as string) || workspaceId
    || (parsePluginPageTargetId(String(input.nodeId ?? '')) ? PLUGIN_PAGE_WORKSPACE_ID : '');
  const result = await getAgentCapabilityPort().call(
    name,
    capabilityInput,
    {
      workspaceId: targetWorkspaceId,
      actor: { kind: 'canvas-agent' },
      abortSignal: context?.abortSignal,
    },
  );
  if (result.ok) return JSON.stringify({ ok: true, ...(result.value as object) });
  const details = result.error.details && typeof result.error.details === 'object'
    ? result.error.details as Record<string, unknown>
    : {};
  return JSON.stringify({
    ok: false,
    ...(result.error.code === 'page_read_failed' && typeof details.strategy === 'string'
      ? { strategy: details.strategy }
      : {}),
    error: result.error.message,
  });
}
