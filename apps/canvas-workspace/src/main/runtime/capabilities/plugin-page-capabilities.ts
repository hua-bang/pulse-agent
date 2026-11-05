import { z } from 'zod';

import { listOpenPluginPages, type OpenPluginPage } from '../../webview/plugin-pages/list';
import type { AnyCapabilityDefinition } from './types';

export function createPluginPageCapabilities(
  listPages: () => OpenPluginPage[] = listOpenPluginPages,
): AnyCapabilityDefinition[] {
  return [{
    name: 'browser.plugin-pages.list',
    description:
      'List the web pages that installed plugins show right now. '
      + 'Pass a returned nodeId to browser.page.read or browser.page.selection.',
    risk: 'read',
    inputSchema: z.object({}),
    execute: async () => {
      const pages = listPages();
      return { count: pages.length, pages };
    },
  }];
}
