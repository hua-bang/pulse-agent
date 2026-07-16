import { z } from 'zod';
import { getWebContentsForDockTab, listDockTabWebviews } from '../../webview/registry';
import { readA11y, readDOM } from '../../webview/reader';
import type { CanvasTool } from './types';

const READINESS_HINT =
  'This is a point-in-time read of live right-dock browser tabs. If expected rows, numbers, or page sections are missing, the tab may still be loading; wait and call canvas_read_tabs again before answering.';

type TabReadStrategy = 'auto' | 'dom' | 'a11y';

export function createTabTools(): Record<string, CanvasTool> {
  return {
    canvas_read_tabs: {
      name: 'canvas_read_tabs',
      defer_loading: true,
      description:
        'Read one or more browser tabs currently open in the right dock. ' +
        'Use this when the user references existing dock tabs or asks you to compare/summarize multiple opened pages. ' +
        'Defaults to all registered link tabs; pass tabIds to read specific tabs. Returns live page title, URL, and extracted text for each tab.',
      inputSchema: z.object({
        tabIds: z
          .array(z.string().min(1))
          .optional()
          .describe('Right-dock tab ids to read. Omit to read all currently registered link tabs.'),
        strategy: z
          .enum(['auto', 'dom', 'a11y'])
          .optional()
          .describe('Reading strategy. Defaults to auto: DOM first, then accessibility tree if DOM is sparse.'),
        maxTabs: z
          .number()
          .int()
          .positive()
          .max(20)
          .optional()
          .describe('Maximum number of tabs to read when tabIds is omitted. Defaults to 8.'),
        maxCharsPerTab: z
          .number()
          .int()
          .positive()
          .max(50_000)
          .optional()
          .describe('Maximum DOM text characters returned for each tab. Defaults to 8 000.'),
        sparseThreshold: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('Minimum DOM text length considered useful in auto mode. Defaults to 200.'),
      }),
      execute: async (input) => {
        const strategy = (input.strategy as TabReadStrategy | undefined) ?? 'auto';
        const maxTabs = (input.maxTabs as number | undefined) ?? 8;
        const maxCharsPerTab = (input.maxCharsPerTab as number | undefined) ?? 8_000;
        const sparseThreshold = (input.sparseThreshold as number | undefined) ?? 200;
        const requestedIds = Array.isArray(input.tabIds)
          ? (input.tabIds as string[]).map((id) => id.trim()).filter(Boolean)
          : undefined;

        const available = listDockTabWebviews();
        const selected: Array<{ tabId: string; title?: string; url?: string }> = requestedIds
          ? requestedIds.map((id) => {
              const tab = available.find((item) => item.tabId === id);
              return { tabId: id, title: tab?.title, url: tab?.url };
            })
          : available.slice(0, maxTabs).map((tab) => ({ tabId: tab.tabId, title: tab.title, url: tab.url }));

        if (selected.length === 0) {
          return JSON.stringify({
            ok: false,
            tabs: [],
            error: 'No right-dock browser tabs are currently registered. Open or activate the tab, wait for it to load, then retry.',
          });
        }

        const tabs = await Promise.all(selected.map(async (tab) => {
          const wc = getWebContentsForDockTab(tab.tabId);
          if (!wc) {
            return {
              ok: false,
              tabId: tab.tabId,
              title: tab.title ?? '',
              url: tab.url ?? '',
              error: 'Tab webview is not registered or has been destroyed.',
            };
          }

          if (strategy === 'dom' || strategy === 'auto') {
            const r = await readDOM(wc, maxCharsPerTab);
            if (strategy === 'dom') {
              return r.ok
                ? {
                    ok: true,
                    tabId: tab.tabId,
                    strategy: 'dom',
                    title: r.title || tab.title || '',
                    url: r.url || tab.url || '',
                    text: r.text,
                    textLength: r.text.trim().length,
                    hint: READINESS_HINT,
                  }
                : {
                    ok: false,
                    tabId: tab.tabId,
                    strategy: 'dom',
                    title: tab.title ?? '',
                    url: tab.url ?? '',
                    error: r.error,
                  };
            }
            if (r.ok && r.text.trim().length >= sparseThreshold) {
              return {
                ok: true,
                tabId: tab.tabId,
                strategy: 'dom',
                title: r.title || tab.title || '',
                url: r.url || tab.url || '',
                text: r.text,
                textLength: r.text.trim().length,
                hint: READINESS_HINT,
              };
            }
          }

          const a11y = await readA11y(wc);
          return a11y.ok
            ? {
                ok: true,
                tabId: tab.tabId,
                strategy: 'a11y',
                title: tab.title ?? '',
                url: tab.url ?? '',
                text: a11y.text,
                textLength: a11y.text.trim().length,
                hint: READINESS_HINT,
              }
            : {
                ok: false,
                tabId: tab.tabId,
                strategy: 'a11y',
                title: tab.title ?? '',
                url: tab.url ?? '',
                error: a11y.error,
              };
        }));

        return JSON.stringify({ ok: tabs.some((tab) => tab.ok), tabs });
      },
    },
  };
}
