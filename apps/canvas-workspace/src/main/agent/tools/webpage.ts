import { z } from 'zod';
import { getWebContentsForNode } from '../../webview/registry';
import { ensureOperable } from '../../webview/ensure-operable';
import { activateWorkspaceWindow } from '../../app/window-manager';
import { readDOMElement } from '../../webview/reader';
import {
  getCanvasCapabilityRuntime,
  PAGE_READINESS_HINT,
} from '../../runtime/capabilities';
import type { CanvasTool } from './types';

export function createWebpageTools(workspaceId: string): Record<string, CanvasTool> {
  return {
    canvas_read_dom_selection: {
      name: 'canvas_read_dom_selection',
      defer_loading: true,
      description:
        'Read one DOM element inside a canvas iframe/webview node or right-dock web tab using a CSS selector. ' +
        'Use this when the user picked a DOM region and the current request is about that specific region. ' +
        'The selector usually comes from the domSelections block in the request context. Returns text, capped HTML, rect, structured descendant tree, controls, title, and URL.',
      inputSchema: z.object({
        nodeId: z.string().describe('ID of the iframe canvas node or right-dock web tab.'),
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
        const wc = await ensureOperable({
          lookup: () => getWebContentsForNode(targetWorkspaceId, nodeId),
          activate: () => activateWorkspaceWindow(targetWorkspaceId),
          mode: 'read',
        });
        if (!wc) {
          return JSON.stringify({
            ok: false,
            error:
              `No active webview for node ${nodeId} in workspace ${targetWorkspaceId} ` +
              `(auto-activation attempted). Make sure the iframe node or web tab still exists and is loaded.`,
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

    canvas_read_webpage: {
      name: 'canvas_read_webpage',
      defer_loading: true,
      description:
        'Read a webpage that is currently open in a canvas iframe node using the richest available strategy.\n' +
        'Requires the iframe node to be mounted and loaded in the canvas.\n' +
        'This is a point-in-time snapshot: if the data you need (e.g. table rows) looks empty, the page may ' +
        'still be loading — use page_wait_for for that content, then read again rather than reporting an empty result.\n\n' +
        'Strategy options (default: auto):\n' +
        '- auto: tries dom first; if content is too sparse, upgrades to a11y; final fallback is screenshot.\n' +
        '- dom: innerText extraction — fast, safe, works for any text-heavy page.\n' +
        '- a11y: Chrome accessibility tree (roles, names, descriptions) — richer semantic structure.\n' +
        '- screenshot: saves the exact viewport as a PNG file and returns imagePath. ' +
        'Then call canvas_analyze_image({ imagePaths: [imagePath] }) to get a vision description.\n\n' +
        'Prefer this over canvas_read_node for iframe nodes when you need a11y structure or a screenshot.',
      inputSchema: z.object({
        nodeId: z.string().describe('ID of the iframe canvas node to read.'),
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
      execute: async (input, context) => {
        const { workspaceId: inputWorkspaceId, ...capabilityInput } = input;
        const targetWorkspaceId = (inputWorkspaceId as string) || workspaceId;
        const result = await getCanvasCapabilityRuntime().call(
          'browser.page.read',
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
      },
    },
  };
}
