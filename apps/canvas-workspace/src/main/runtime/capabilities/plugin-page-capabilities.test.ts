import { describe, expect, it, vi } from 'vitest';

vi.mock('../../webview/plugin-pages/list', () => ({ listOpenPluginPages: () => [] }));

import { CapabilityRuntime } from './runtime';
import { createPluginPageCapabilities } from './plugin-page-capabilities';

describe('Plugin page capabilities', () => {
  it('lists open plugin pages for external agents', async () => {
    const page = {
      nodeId: 'plugin:weread/main',
      pluginId: 'weread',
      viewId: 'main',
      title: 'Reading',
      url: 'https://weread.test/',
    };
    const runtime = new CapabilityRuntime(createPluginPageCapabilities(() => [page]));

    expect(runtime.list({ kind: 'pulse-cli' }).map(({ name }) => name)).toEqual(['browser.plugin-pages.list']);
    await expect(runtime.call('browser.plugin-pages.list', {}, {
      workspaceId: 'ws-1',
      actor: { kind: 'pulse-cli' },
    })).resolves.toEqual({ ok: true, value: { count: 1, pages: [page] } });
  });
});
