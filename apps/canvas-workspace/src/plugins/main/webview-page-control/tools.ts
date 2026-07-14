/**
 * Canvas-agent tools that **write** to webview pages — click, fill, press
 * keys, wait for selectors, run arbitrary JS.
 *
 * Registered as a canvas plugin (see `./index.ts`); gating on the
 * `webview-page-control` experimental flag is handled by the plugin's
 * `enabledWhen` — by the time this file's factory is called, the flag
 * is known to be on.
 *
 * Every tool follows the same shape:
 *   1. Resolve the live `WebContents` for the iframe node via the
 *      webview registry — fail with a structured error if the node has
 *      no mounted webview.
 *   2. Run `evaluateActionPolicy(wc.getURL())` — fail with the policy
 *      reason if the page isn't in scope.
 *   3. Invoke the primitive (CDP or JS) and serialise the result as a
 *      JSON string for the agent.
 *   4. Emit one `console.info('[webview-action] …')` audit line.
 *
 * Returns are JSON strings (matching the existing `canvas_*` tool
 * convention). Errors always have the same `{ ok: false, error }` shape
 * so the agent can branch reliably.
 */

import { z } from 'zod';
import { getWebContentsForNode } from '../../../main/webview/registry';
import { ensureOperable } from '../../../main/webview/ensure-operable';
import { activateWorkspaceWindow } from '../../../main/app/window-manager';
import {
  evalInPage,
  scrollPage,
  waitForCondition,
  type PageActionResult,
} from './js-primitives';
import {
  cdpClickAt,
  cdpClickSelector,
  cdpFillSelector,
  cdpPressKey,
} from './cdp-actions';
import { evaluateActionPolicy } from './policy';
import type { CanvasTool } from '../../../main/agent/tools';

interface ResolvedTarget {
  wc: NonNullable<ReturnType<typeof getWebContentsForNode>>;
  url: string;
}

async function resolveTarget(
  workspaceId: string,
  nodeId: string,
): Promise<{ ok: true; target: ResolvedTarget } | { ok: false; error: string }> {
  // These tools click/fill/screenshot, which need a *painted* surface — so
  // make the workspace active (un-hide its display:none container + show the
  // window inactively, without stealing focus) before resolving the node.
  const wc = await ensureOperable({
    lookup: () => getWebContentsForNode(workspaceId, nodeId),
    activate: () => activateWorkspaceWindow(workspaceId, nodeId),
    mode: 'operate',
  });
  if (!wc) {
    return {
      ok: false,
      error:
        `No active webview for node ${nodeId} in workspace ${workspaceId} ` +
        `(auto-activation attempted). Open the iframe node in URL mode and make sure it has finished loading.`,
    };
  }
  const url = wc.getURL();
  const decision = evaluateActionPolicy(url);
  if (!decision.allow) {
    return { ok: false, error: `policy blocked action on ${url}: ${decision.reason}` };
  }
  return { ok: true, target: { wc, url } };
}

function audit(action: string, nodeId: string, url: string, extra: Record<string, unknown> = {}): void {
  let host = '';
  try {
    host = new URL(url).hostname;
  } catch {
    host = '(invalid url)';
  }
  console.info(
    `[webview-action] ${action} node=${nodeId} host=${host} ${JSON.stringify(extra)}`,
  );
}

function serialise(action: string, nodeId: string, url: string, result: PageActionResult): string {
  audit(action, nodeId, url, { ok: result.ok, ...(result.error ? { error: result.error } : {}) });
  try {
    if (result.ok) {
      return JSON.stringify({ ok: true, action, url, ...result.data });
    }
    return JSON.stringify({
      ok: false,
      action,
      url,
      error: result.error,
      ...(result.timedOut ? { timedOut: true } : {}),
    });
  } catch (e) {
    // BigInt / cycle / Date / other non-JSON-friendly content snuck in.
    // evalInPage normally catches this earlier; this is the last-line
    // defense so the tool never throws into the engine.
    return JSON.stringify({
      ok: false,
      action,
      url,
      error: `result was not JSON-serialisable: ${e instanceof Error ? e.message : String(e)}`,
    });
  }
}

const baseDescription =
  'Experimental — requires the `webview-page-control` flag. ' +
  'Operates on iframe nodes whose <webview> is mounted in URL mode. ' +
  'Blocked on file://, chrome://, devtools://, view-source://, and a ' +
  'built-in sensitive-domain deny list (banks, payments, mainstream auth). ' +
  'Customize the policy via ~/.pulse-coder/canvas/webview-action-policy.json.';

/**
 * Build the webview-page-control tool map for a workspace. Called by
 * the plugin's `registerCanvasTool` factory at canvas-agent boot — the
 * plugin's `enabledWhen` has already gated activation, so by the time
 * we get here the experimental flag is on.
 */
export function createWebviewPageControlTools(
  workspaceId: string,
): Record<string, CanvasTool> {
  return {
    page_eval: {
      name: 'page_eval',
      defer_loading: true,
      description:
        'Run arbitrary JavaScript inside the iframe node\'s page and return its result. ' +
        'The code body should `return` a JSON-serialisable value (or a Promise that resolves to one). ' +
        'Use sparingly — prefer page_click / page_fill / page_press / page_wait_for for structured actions. ' +
        baseDescription,
      inputSchema: z.object({
        nodeId: z.string().describe('ID of the iframe canvas node whose page to script.'),
        code: z
          .string()
          .describe(
            'JS function body to run inside the page. Use `return` to send a value back. ' +
              'Example: "return document.querySelectorAll(\'a\').length"',
          ),
        timeoutMs: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Max time to wait for the script to settle. Default 5000.'),
      }),
      execute: async (input) => {
        const r = await resolveTarget(workspaceId, input.nodeId as string);
        if (!r.ok) return JSON.stringify({ ok: false, action: 'page_eval', error: r.error });
        const result = await evalInPage(r.target.wc, input.code as string, input.timeoutMs as number | undefined);
        return serialise('page_eval', input.nodeId as string, r.target.url, result);
      },
    },

    page_click: {
      name: 'page_click',
      defer_loading: true,
      description:
        'Click an element matching a CSS selector via CDP — produces a real ' +
        'mousePressed/mouseReleased pair through Chromium\'s input router (not a JS ' +
        '`el.click()`), so hover handlers, pointer events, user-activation-gated APIs ' +
        '(clipboard write, popup, fullscreen) all behave as if a human clicked. ' +
        'Scrolls the element into view first. Accepts modifiers (shift / ctrl / meta / alt) ' +
        'and button (left / middle / right). ' +
        baseDescription,
      inputSchema: z.object({
        nodeId: z.string().describe('ID of the iframe canvas node.'),
        selector: z.string().describe('CSS selector for the element to click.'),
        button: z.enum(['left', 'middle', 'right']).optional().describe('Mouse button. Default "left".'),
        clickCount: z.number().int().positive().optional().describe('1 for click, 2 for double-click.'),
        modifiers: z
          .array(z.enum(['shift', 'ctrl', 'control', 'meta', 'cmd', 'command', 'alt']))
          .optional()
          .describe('Keyboard modifiers held during the click.'),
        timeoutMs: z.number().int().positive().optional(),
      }),
      execute: async (input) => {
        const r = await resolveTarget(workspaceId, input.nodeId as string);
        if (!r.ok) return JSON.stringify({ ok: false, action: 'page_click', error: r.error });
        const result = await cdpClickSelector(r.target.wc, input.selector as string, {
          button: input.button as 'left' | 'middle' | 'right' | undefined,
          clickCount: input.clickCount as number | undefined,
          modifiers: input.modifiers as string[] | undefined,
          timeoutMs: input.timeoutMs as number | undefined,
        });
        return serialise('page_click', input.nodeId as string, r.target.url, result);
      },
    },

    page_click_at: {
      name: 'page_click_at',
      defer_loading: true,
      description:
        'Click at absolute viewport coordinates (x, y) via CDP. Use this when paired ' +
        'with `canvas_read_webpage({ strategy: "screenshot" })` + vision — the agent ' +
        'sees a screenshot, picks a pixel, then clicks there. Coordinates are in CSS ' +
        'pixels relative to the visual viewport top-left. ' +
        baseDescription,
      inputSchema: z.object({
        nodeId: z.string().describe('ID of the iframe canvas node.'),
        x: z.number().describe('Viewport x coordinate (CSS pixels).'),
        y: z.number().describe('Viewport y coordinate (CSS pixels).'),
        button: z.enum(['left', 'middle', 'right']).optional(),
        clickCount: z.number().int().positive().optional(),
        modifiers: z
          .array(z.enum(['shift', 'ctrl', 'control', 'meta', 'cmd', 'command', 'alt']))
          .optional(),
        timeoutMs: z.number().int().positive().optional(),
      }),
      execute: async (input) => {
        const r = await resolveTarget(workspaceId, input.nodeId as string);
        if (!r.ok) return JSON.stringify({ ok: false, action: 'page_click_at', error: r.error });
        const result = await cdpClickAt(
          r.target.wc,
          input.x as number,
          input.y as number,
          {
            button: input.button as 'left' | 'middle' | 'right' | undefined,
            clickCount: input.clickCount as number | undefined,
            modifiers: input.modifiers as string[] | undefined,
            timeoutMs: input.timeoutMs as number | undefined,
          },
        );
        return serialise('page_click_at', input.nodeId as string, r.target.url, result);
      },
    },

    page_fill: {
      name: 'page_fill',
      defer_loading: true,
      description:
        'Fill an <input>, <textarea>, or contenteditable element with `value`. ' +
        'Focuses the element, clears the existing value (React-safe via the native ' +
        'setter), then inserts the new value via CDP `Input.insertText` — single atomic ' +
        'insert, like a paste. Does NOT submit forms — follow up with page_press({ key: "Enter" }) ' +
        'or page_click on a submit button. ' +
        baseDescription,
      inputSchema: z.object({
        nodeId: z.string().describe('ID of the iframe canvas node.'),
        selector: z.string().describe('CSS selector for the editable element.'),
        value: z.string().describe('Replacement value. Replaces the entire current value by default.'),
        clearFirst: z
          .boolean()
          .optional()
          .describe('If false, appends instead of replacing. Default true.'),
        timeoutMs: z.number().int().positive().optional(),
      }),
      execute: async (input) => {
        const r = await resolveTarget(workspaceId, input.nodeId as string);
        if (!r.ok) return JSON.stringify({ ok: false, action: 'page_fill', error: r.error });
        const result = await cdpFillSelector(
          r.target.wc,
          input.selector as string,
          input.value as string,
          {
            clearFirst: input.clearFirst as boolean | undefined,
            timeoutMs: input.timeoutMs as number | undefined,
          },
        );
        return serialise('page_fill', input.nodeId as string, r.target.url, result);
      },
    },

    page_press: {
      name: 'page_press',
      defer_loading: true,
      description:
        'Dispatch a keyDown + keyUp pair via CDP — real keyboard events with proper ' +
        '`isTrusted=true` and user-activation, so React shortcuts (Cmd+K, Ctrl+S, etc.) ' +
        'and native form-submit-on-Enter work. ' +
        'Supports modifiers (shift / ctrl / meta / alt). ' +
        'Supported keys: Enter, Tab, Escape, Backspace, Delete, ArrowUp/Down/Left/Right, ' +
        'Home, End, PageUp, PageDown, Space, or any single character. ' +
        'For multi-character text input, prefer page_fill. ' +
        baseDescription,
      inputSchema: z.object({
        nodeId: z.string().describe('ID of the iframe canvas node.'),
        key: z.string().describe('Key name (e.g. "Enter", "ArrowDown") or a single character.'),
        selector: z
          .string()
          .optional()
          .describe('Optional element to focus before pressing. Defaults to the currently focused element.'),
        modifiers: z
          .array(z.enum(['shift', 'ctrl', 'control', 'meta', 'cmd', 'command', 'alt']))
          .optional()
          .describe('Keyboard modifiers (e.g. ["meta"] for Cmd+key, ["ctrl","shift"] for Ctrl+Shift+key).'),
        timeoutMs: z.number().int().positive().optional(),
      }),
      execute: async (input) => {
        const r = await resolveTarget(workspaceId, input.nodeId as string);
        if (!r.ok) return JSON.stringify({ ok: false, action: 'page_press', error: r.error });
        const result = await cdpPressKey(r.target.wc, input.key as string, {
          selector: input.selector as string | undefined,
          modifiers: input.modifiers as string[] | undefined,
          timeoutMs: input.timeoutMs as number | undefined,
        });
        return serialise('page_press', input.nodeId as string, r.target.url, result);
      },
    },

    page_scroll: {
      name: 'page_scroll',
      defer_loading: true,
      description:
        'Scroll the page. Provide exactly one of: ' +
        '`top: true` (scroll to start), `bottom: true` (scroll to end), ' +
        '`selector` (scrollIntoView on the matching element), or ' +
        '`by: { x, y }` (relative scroll in pixels — positive y scrolls down). ' +
        'Returns the post-scroll position plus atTop / atBottom booleans so ' +
        'the agent can decide whether to scroll again (e.g. infinite-scroll pagination). ' +
        baseDescription,
      inputSchema: z
        .object({
          nodeId: z.string().describe('ID of the iframe canvas node.'),
          top: z.boolean().optional().describe('Scroll to the top of the page.'),
          bottom: z.boolean().optional().describe('Scroll to the bottom of the page.'),
          selector: z
            .string()
            .optional()
            .describe('CSS selector — scrollIntoView() this element.'),
          by: z
            .object({
              x: z.number().optional(),
              y: z.number().optional(),
            })
            .optional()
            .describe('Relative scroll in pixels. Positive y scrolls down.'),
          block: z
            .enum(['start', 'center', 'end', 'nearest'])
            .optional()
            .describe(
              'scrollIntoView block alignment when using `selector`. Default "center".',
            ),
          timeoutMs: z.number().int().positive().optional(),
        })
        .refine(
          (v) =>
            !!v.top ||
            !!v.bottom ||
            !!v.selector ||
            (!!v.by && (typeof v.by.x === 'number' || typeof v.by.y === 'number')),
          { message: 'Provide one of: top, bottom, selector, or by{x,y}.' },
        ),
      execute: async (input) => {
        const r = await resolveTarget(workspaceId, input.nodeId as string);
        if (!r.ok) return JSON.stringify({ ok: false, action: 'page_scroll', error: r.error });
        const result = await scrollPage(
          r.target.wc,
          {
            top: input.top as boolean | undefined,
            bottom: input.bottom as boolean | undefined,
            selector: input.selector as string | undefined,
            by: input.by as { x?: number; y?: number } | undefined,
            block: input.block as 'start' | 'center' | 'end' | 'nearest' | undefined,
          },
          input.timeoutMs as number | undefined,
        );
        return serialise('page_scroll', input.nodeId as string, r.target.url, result);
      },
    },

    page_wait_for: {
      name: 'page_wait_for',
      defer_loading: true,
      description:
        'Poll the page until a condition is met or timeout. Provide EITHER `selector` ' +
        '(waits for a visible element matching the CSS selector) OR `predicate` (a JS ' +
        'function body that should `return` truthy when ready, e.g. ' +
        '"return location.pathname === \'/dashboard\'"). ' +
        'Use this after page_click or page_fill to wait for navigations / dynamic content. ' +
        baseDescription,
      inputSchema: z
        .object({
          nodeId: z.string().describe('ID of the iframe canvas node.'),
          selector: z.string().optional().describe('CSS selector to wait for.'),
          predicate: z
            .string()
            .optional()
            .describe('JS function body returning a truthy value when ready.'),
          timeoutMs: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Max wait time in ms. Default 5000.'),
          intervalMs: z
            .number()
            .int()
            .positive()
            .optional()
            .describe('Poll interval in ms. Default 100.'),
        })
        .refine((v) => !!v.selector || !!v.predicate, {
          message: 'Provide either selector or predicate.',
        }),
      execute: async (input) => {
        const r = await resolveTarget(workspaceId, input.nodeId as string);
        if (!r.ok) return JSON.stringify({ ok: false, action: 'page_wait_for', error: r.error });
        const result = await waitForCondition(r.target.wc, {
          selector: input.selector as string | undefined,
          predicate: input.predicate as string | undefined,
          timeoutMs: input.timeoutMs as number | undefined,
          intervalMs: input.intervalMs as number | undefined,
          // Re-validate policy on every probe — pages can redirect during
          // a long wait (neutral page → login). If the live URL becomes
          // blocked, abort the wait with the policy reason instead of
          // continuing to inject probe scripts on the new origin.
          abortCheck: () => {
            try {
              const liveUrl = r.target.wc.getURL();
              const decision = evaluateActionPolicy(liveUrl);
              if (!decision.allow) {
                return `policy blocked action on ${liveUrl}: ${decision.reason}`;
              }
              return null;
            } catch (e) {
              return `failed to re-validate URL policy: ${e instanceof Error ? e.message : String(e)}`;
            }
          },
        });
        return serialise('page_wait_for', input.nodeId as string, r.target.url, result);
      },
    },
  };
}
