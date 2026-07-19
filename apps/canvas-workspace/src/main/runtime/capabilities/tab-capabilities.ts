import { z } from 'zod';

import type { AgentContextTabRef } from '../../../shared/agent-chat';
import { activateDockTab, findDockLinkTab, openDockTab } from '../../dock/tab-actions';
import { getDockTabs } from '../../dock/tab-store';
import { CapabilityError, type AnyCapabilityDefinition } from './types';

export interface TabCapabilityDependencies {
  getDockTabs: (workspaceId: string) => AgentContextTabRef[];
  activateDockTab: (workspaceId: string, tabId: string) => Promise<boolean>;
  findDockLinkTab: (workspaceId: string, tabId: string) => AgentContextTabRef | undefined;
  openDockTab: (url: string, tabId?: string) => boolean;
  log: (message: string) => void;
}

const defaultDependencies: TabCapabilityDependencies = {
  getDockTabs,
  activateDockTab,
  findDockLinkTab,
  openDockTab,
  log: (message) => console.info(message),
};

export function createTabCapabilities(
  dependencies: TabCapabilityDependencies = defaultDependencies,
): AnyCapabilityDefinition[] {
  return [
    {
      name: 'browser.tabs.list',
      description: 'List live right-dock tabs for a Canvas workspace.',
      risk: 'read',
      inputSchema: z.object({}),
      execute: async (_input, context) => {
        const tabs = dependencies.getDockTabs(context.workspaceId);
        return { count: tabs.length, tabs };
      },
    },
    {
      name: 'browser.tabs.activate',
      description: 'Bring an existing right-dock tab to the front.',
      risk: 'operate',
      inputSchema: z.object({ tabId: z.string().min(1) }),
      execute: async ({ tabId }, context) => {
        const normalizedTabId = tabId.trim();
        const tab = dependencies
          .getDockTabs(context.workspaceId)
          .find((candidate) => candidate.id === normalizedTabId);
        if (!tab) {
          throw new CapabilityError(
            'tab_not_found',
            `Tab ${normalizedTabId} is not open in workspace ${context.workspaceId}. Call canvas_list_tabs to refresh stale ids.`,
          );
        }
        if (!await dependencies.activateDockTab(context.workspaceId, normalizedTabId)) {
          throw new CapabilityError(
            'window_unavailable',
            'No canvas window is open to activate the tab.',
          );
        }
        return { tabId: normalizedTabId, kind: tab.kind, title: tab.title };
      },
    },
    {
      name: 'browser.tabs.open',
      description: 'Open an http(s) URL in the right dock or navigate an existing link tab.',
      risk: 'operate',
      inputSchema: z.object({
        url: z.string(),
        tabId: z.string().optional(),
      }),
      execute: async ({ url: rawUrl, tabId: rawTabId }, context) => {
        const url = rawUrl.trim();
        const tabId = rawTabId?.trim() || undefined;
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(url);
        } catch {
          throw new CapabilityError('invalid_url', `Not a valid URL: ${url}`);
        }
        if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
          throw new CapabilityError(
            'unsupported_url',
            `Only http(s) URLs can be opened in a tab (got ${parsedUrl.protocol}).`,
          );
        }

        const knownTab = tabId
          ? dependencies.findDockLinkTab(context.workspaceId, tabId)
          : undefined;
        const sent = dependencies.openDockTab(url, tabId);
        dependencies.log(
          `[canvas-tab] open-tab url-host=${parsedUrl.hostname} tab=${tabId ?? '(new)'} sent=${sent}`,
        );
        if (!sent) {
          throw new CapabilityError(
            'window_unavailable',
            'No canvas window is open to receive the tab.',
          );
        }

        return {
          url,
          ...(tabId ? { tabId } : {}),
          ...(tabId && !knownTab
            ? {
                note:
                  'tabId was not in this workspace\'s tab list; the dock navigates it if it exists, otherwise it opens the URL as a new tab.',
              }
            : {}),
          hint:
            'Call canvas_list_tabs to get the tab id and confirm it is open, then canvas_read_tab to read the page.',
        };
      },
    },
  ];
}
