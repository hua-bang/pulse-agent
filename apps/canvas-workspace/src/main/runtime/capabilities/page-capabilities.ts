import { z } from 'zod';

import { getWebContentsForNode } from '../../webview/registry';
import { ensureOperable } from '../../webview/ensure-operable';
import { activateWorkspaceWindow } from '../../app/window-manager';
import { readA11y, readDOM, captureScreenshot } from '../../webview/reader';
import {
  cdpClickSelector,
  cdpFillSelector,
} from '../../../plugins/main/webview-page-control/cdp-actions';
import { evalInPage } from '../../../plugins/main/webview-page-control/js-primitives';
import {
  auditPageAction,
  resolvePageControlTarget,
} from '../../../plugins/main/webview-page-control/target';
import { CapabilityError, type AnyCapabilityDefinition } from './types';

export const PAGE_READINESS_HINT =
  'This is a point-in-time read of the live DOM — a "success" does not guarantee the data ' +
  'finished loading. If the specific content you need (table rows, numbers, list items) looks ' +
  'empty or missing, the page is likely still loading: call page_wait_for with a selector/' +
  'predicate for that content, then read again before answering.';

const pageReadInputSchema = z.object({
  nodeId: z.string().min(1).describe('Iframe canvas node id or right-dock link-tab id.'),
  strategy: z.enum(['auto', 'dom', 'a11y', 'screenshot']).optional(),
  maxChars: z.number().int().positive().optional(),
  sparseThreshold: z.number().int().nonnegative().optional(),
});

const pageClickInputSchema = z.object({
  nodeId: z.string().min(1).describe('Iframe canvas node id or right-dock link-tab id.'),
  selector: z.string().min(1).describe('CSS selector for the target element.'),
  button: z.enum(['left', 'middle', 'right']).optional(),
  clickCount: z.number().int().positive().optional(),
  modifiers: z.array(z.enum([
    'shift',
    'ctrl',
    'control',
    'meta',
    'cmd',
    'command',
    'alt',
  ])).optional(),
  timeoutMs: z.number().int().positive().optional(),
});

const pageFillInputSchema = z.object({
  nodeId: z.string().min(1).describe('Iframe canvas node id or right-dock link-tab id.'),
  selector: z.string().min(1).describe('CSS selector for an editable element.'),
  value: z.string().describe('Replacement text.'),
  clearFirst: z.boolean().optional(),
  timeoutMs: z.number().int().positive().optional(),
});

export const pageEvalInputSchema = z.object({
  nodeId: z
    .string()
    .describe('ID of the iframe canvas node (or dock link-tab id) whose page to script.'),
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
});

export type PageReadInput = z.infer<typeof pageReadInputSchema>;
export type PageClickInput = z.infer<typeof pageClickInputSchema>;
export type PageFillInput = z.infer<typeof pageFillInputSchema>;
export type PageEvalInput = z.infer<typeof pageEvalInputSchema>;

export interface PageCapabilityDependencies {
  readPage: (workspaceId: string, input: PageReadInput) => Promise<unknown>;
  clickPage: (workspaceId: string, input: PageClickInput) => Promise<unknown>;
  fillPage: (workspaceId: string, input: PageFillInput) => Promise<unknown>;
  evalPage: (workspaceId: string, input: PageEvalInput) => Promise<unknown>;
}

const defaultDependencies: PageCapabilityDependencies = {
  readPage: readLivePage,
  clickPage: clickLivePage,
  fillPage: fillLivePage,
  evalPage: evalLivePage,
};

export interface PageCapabilityOptions {
  includePageControl?: boolean;
}

export function createPageCapabilities(
  dependencies: PageCapabilityDependencies = defaultDependencies,
  options: PageCapabilityOptions = {},
): AnyCapabilityDefinition[] {
  const definitions: AnyCapabilityDefinition[] = [
    {
      name: 'browser.page.read',
      description: 'Read the rendered contents of an open iframe node or dock link tab.',
      risk: 'read',
      inputSchema: pageReadInputSchema,
      execute: (input, context) => dependencies.readPage(context.workspaceId, input),
    },
  ];
  if (options.includePageControl !== false) definitions.push(
    {
      name: 'browser.page.click',
      description: 'Click a CSS-selected element in an open iframe node or dock link tab.',
      risk: 'operate',
      inputSchema: pageClickInputSchema,
      execute: (input, context) => dependencies.clickPage(context.workspaceId, input),
    },
    {
      name: 'browser.page.fill',
      description: 'Fill a CSS-selected editable element in an open iframe node or dock link tab.',
      risk: 'operate',
      inputSchema: pageFillInputSchema,
      execute: (input, context) => dependencies.fillPage(context.workspaceId, input),
    },
    {
      name: 'browser.page.eval',
      description:
        'Execute arbitrary JavaScript in an open iframe node or dock link tab. Canvas Agent only.',
      risk: 'unsafe',
      inputSchema: pageEvalInputSchema,
      execute: (input, context) => dependencies.evalPage(context.workspaceId, input),
    },
  );
  return definitions;
}

async function readLivePage(workspaceId: string, input: PageReadInput): Promise<unknown> {
  const strategy = input.strategy ?? 'auto';
  const maxChars = input.maxChars ?? 12_000;
  const sparseThreshold = input.sparseThreshold ?? 200;
  const wc = await ensureOperable({
    lookup: () => getWebContentsForNode(workspaceId, input.nodeId),
    activate: () => activateWorkspaceWindow(workspaceId),
    mode: strategy === 'screenshot' ? 'operate' : 'read',
  });
  if (!wc) {
    throw new CapabilityError(
      'webview_not_found',
      `No active webview for node ${input.nodeId} in workspace ${workspaceId} ` +
        '(auto-activation attempted). Make sure the iframe node exists and is in URL mode.',
      { strategy },
    );
  }

  if (strategy === 'dom' || strategy === 'auto') {
    const result = await readDOM(wc, maxChars);
    if (strategy === 'dom') {
      if (!result.ok) throw pageReadError('dom', result.error);
      return {
        strategy: 'dom',
        title: result.title,
        url: result.url,
        text: result.text,
        textLength: result.text.trim().length,
        hint: PAGE_READINESS_HINT,
      };
    }
    if (result.ok && result.text.trim().length >= sparseThreshold) {
      return {
        strategy: 'dom',
        title: result.title,
        url: result.url,
        text: result.text,
        textLength: result.text.trim().length,
        hint: PAGE_READINESS_HINT,
      };
    }
  }

  if (strategy === 'a11y' || strategy === 'auto') {
    const result = await readA11y(wc);
    if (strategy === 'a11y') {
      if (!result.ok) throw pageReadError('a11y', result.error);
      return {
        strategy: 'a11y',
        text: result.text,
        textLength: result.text.trim().length,
        hint: PAGE_READINESS_HINT,
      };
    }
    if (result.ok && result.text.trim().length >= sparseThreshold) {
      return {
        strategy: 'a11y',
        text: result.text,
        textLength: result.text.trim().length,
        hint: PAGE_READINESS_HINT,
      };
    }
  }

  const screenshot = await captureScreenshot(wc);
  if (!screenshot.ok) throw pageReadError('screenshot', screenshot.error);
  return {
    strategy: 'screenshot',
    imagePath: screenshot.imagePath,
    ...(strategy === 'auto'
      ? {
          sparseTextFallback: true,
          hint:
            'DOM and a11y text were sparse, so this fell back to a screenshot. ' +
            'The page may still be loading. ' +
            'Call canvas_analyze_image({ imagePaths: [imagePath] }) to get a vision description; ' +
            'if the expected content is missing, page_wait_for it and read again.',
        }
      : {
          hint: 'Call canvas_analyze_image({ imagePaths: [imagePath] }) to get a vision description.',
        }),
  };
}

async function clickLivePage(workspaceId: string, input: PageClickInput): Promise<unknown> {
  const resolved = await resolvePageControlTarget(workspaceId, input.nodeId);
  if (!resolved.ok) throw pageActionError('page_click', resolved.error);
  const result = await cdpClickSelector(resolved.target.wc, input.selector, {
    button: input.button,
    clickCount: input.clickCount,
    modifiers: input.modifiers,
    timeoutMs: input.timeoutMs,
  });
  auditPageAction('page_click', input.nodeId, resolved.target.url, {
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
  });
  if (!result.ok) {
    throw pageActionError('page_click', result.error ?? 'page click failed', {
      url: resolved.target.url,
      timedOut: result.timedOut,
    });
  }
  return { action: 'page_click', url: resolved.target.url, ...result.data };
}

async function fillLivePage(workspaceId: string, input: PageFillInput): Promise<unknown> {
  const resolved = await resolvePageControlTarget(workspaceId, input.nodeId);
  if (!resolved.ok) throw pageActionError('page_fill', resolved.error);
  const result = await cdpFillSelector(
    resolved.target.wc,
    input.selector,
    input.value,
    { clearFirst: input.clearFirst, timeoutMs: input.timeoutMs },
  );
  auditPageAction('page_fill', input.nodeId, resolved.target.url, {
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
  });
  if (!result.ok) {
    throw pageActionError('page_fill', result.error ?? 'page fill failed', {
      url: resolved.target.url,
      timedOut: result.timedOut,
    });
  }
  return { action: 'page_fill', url: resolved.target.url, ...result.data };
}

async function evalLivePage(workspaceId: string, input: PageEvalInput): Promise<unknown> {
  const resolved = await resolvePageControlTarget(workspaceId, input.nodeId);
  if (!resolved.ok) throw pageActionError('page_eval', resolved.error);
  const result = await evalInPage(resolved.target.wc, input.code, input.timeoutMs);
  auditPageAction('page_eval', input.nodeId, resolved.target.url, {
    ok: result.ok,
    ...(result.error ? { error: result.error } : {}),
  });
  if (!result.ok) {
    throw pageActionError('page_eval', result.error ?? 'page script failed', {
      url: resolved.target.url,
      timedOut: result.timedOut,
    });
  }
  return {
    action: 'page_eval',
    url: resolved.target.url,
    ...result.data,
  };
}

function pageReadError(strategy: string, error?: string): CapabilityError {
  return new CapabilityError('page_read_failed', error ?? `${strategy} read failed`, { strategy });
}

function pageActionError(
  action: string,
  error: string,
  details: Record<string, unknown> = {},
): CapabilityError {
  return new CapabilityError('page_action_failed', error, { action, ...details });
}
