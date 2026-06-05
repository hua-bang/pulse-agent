import { z } from 'zod';
import { getWebContentsForNode } from '../../webview/registry';
import { readDOM, readA11y, captureScreenshot } from '../../webview/reader';
import type { CanvasTool } from './types';

/**
 * Standing reminder attached to every successful DOM/a11y read. A "success"
 * here only means we extracted *some* rendered text — it does not mean the
 * data the user asked for is present. SPAs frequently render their chrome
 * (nav, headers, an empty table skeleton) before the async data lands, so a
 * read can look fine while the rows/numbers are still missing. The hint nudges
 * the agent to verify the expected content and wait + re-read instead of
 * silently summarising an empty page.
 */
const READINESS_HINT =
  'This is a point-in-time read of the live DOM — a "success" does not guarantee the data ' +
  'finished loading. If the specific content you need (table rows, numbers, list items) looks ' +
  'empty or missing, the page is likely still loading: call page_wait_for with a selector/' +
  'predicate for that content, then read again before answering.';

export function createWebpageTools(workspaceId: string): Record<string, CanvasTool> {
  return {
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
      execute: async (input) => {
        const nodeId = input.nodeId as string;
        const strategy = (input.strategy as 'auto' | 'dom' | 'a11y' | 'screenshot') ?? 'auto';
        const maxChars = (input.maxChars as number) ?? 12_000;
        const sparseThreshold = (input.sparseThreshold as number) ?? 200;

        const wc = getWebContentsForNode(workspaceId, nodeId);
        if (!wc) {
          return JSON.stringify({
            ok: false,
            error: `No active webview for node ${nodeId} in workspace ${workspaceId}. Make sure the iframe node is open and loaded.`,
          });
        }

        // ── DOM ──────────────────────────────────────────────────────────
        if (strategy === 'dom' || strategy === 'auto') {
          const r = await readDOM(wc, maxChars);
          if (strategy === 'dom') {
            return JSON.stringify(r.ok
              ? { ok: true, strategy: 'dom', title: r.title, url: r.url, text: r.text,
                  textLength: r.text.trim().length, hint: READINESS_HINT }
              : { ok: false, strategy: 'dom', error: r.error });
          }
          if (r.ok && r.text.trim().length >= sparseThreshold) {
            return JSON.stringify({ ok: true, strategy: 'dom', title: r.title, url: r.url, text: r.text,
              textLength: r.text.trim().length, hint: READINESS_HINT });
          }
        }

        // ── a11y ─────────────────────────────────────────────────────────
        if (strategy === 'a11y' || strategy === 'auto') {
          const r = await readA11y(wc);
          if (strategy === 'a11y') {
            return JSON.stringify(r.ok
              ? { ok: true, strategy: 'a11y', text: r.text,
                  textLength: r.text.trim().length, hint: READINESS_HINT }
              : { ok: false, strategy: 'a11y', error: r.error });
          }
          if (r.ok && r.text.trim().length >= sparseThreshold) {
            return JSON.stringify({ ok: true, strategy: 'a11y', text: r.text,
              textLength: r.text.trim().length, hint: READINESS_HINT });
          }
        }

        // ── Screenshot ───────────────────────────────────────────────────
        // Reached in auto mode only when both DOM and a11y came back sparse —
        // a strong signal the page may still be loading, so flag it.
        const r = await captureScreenshot(wc);
        return JSON.stringify(r.ok
          ? { ok: true, strategy: 'screenshot', imagePath: r.imagePath,
              ...(strategy === 'auto'
                ? { sparseTextFallback: true, hint:
                    'DOM and a11y text were sparse, so this fell back to a screenshot. ' +
                    'The page may still be loading. ' +
                    'Call canvas_analyze_image({ imagePaths: [imagePath] }) to get a vision description; ' +
                    'if the expected content is missing, page_wait_for it and read again.' }
                : { hint: 'Call canvas_analyze_image({ imagePaths: [imagePath] }) to get a vision description.' }) }
          : { ok: false, strategy: 'screenshot', error: r.error });
      },
    },
  };
}
