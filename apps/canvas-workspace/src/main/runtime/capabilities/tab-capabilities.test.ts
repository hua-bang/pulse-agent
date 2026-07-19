import { describe, expect, it, vi } from 'vitest';

import { CapabilityRuntime } from './runtime';
import { createTabCapabilities } from './tab-capabilities';

function createRuntime() {
  const tabs = [
    { id: 'link:1', kind: 'link' as const, title: 'Docs', workspaceId: 'ws-1', url: 'https://example.com' },
  ];
  const dependencies = {
    getDockTabs: vi.fn(() => tabs),
    activateDockTab: vi.fn(async () => true),
    findDockLinkTab: vi.fn(() => undefined),
    openDockTab: vi.fn(() => true),
    log: vi.fn(),
  };
  return {
    runtime: new CapabilityRuntime(createTabCapabilities(dependencies)),
    dependencies,
  };
}

const context = { workspaceId: 'ws-1', actor: { kind: 'test' as const } };

describe('browser tab capabilities', () => {
  it('reads the live dock tab projection', async () => {
    const { runtime } = createRuntime();

    await expect(runtime.call('browser.tabs.list', {}, context)).resolves.toEqual({
      ok: true,
      value: {
        count: 1,
        tabs: [expect.objectContaining({ id: 'link:1', kind: 'link', title: 'Docs' })],
      },
    });
  });

  it('activates only a tab present in the workspace projection', async () => {
    const { runtime, dependencies } = createRuntime();

    await expect(runtime.call('browser.tabs.activate', { tabId: 'link:1' }, context)).resolves.toEqual({
      ok: true,
      value: { tabId: 'link:1', kind: 'link', title: 'Docs' },
    });
    expect(dependencies.activateDockTab).toHaveBeenCalledWith('ws-1', 'link:1');

    const stale = await runtime.call('browser.tabs.activate', { tabId: 'missing' }, context);
    expect(stale).toMatchObject({
      ok: false,
      error: { code: 'tab_not_found', message: expect.stringContaining('not open') },
    });
  });

  it('opens only http(s) URLs and reports whether the renderer received the command', async () => {
    const { runtime, dependencies } = createRuntime();

    await expect(runtime.call(
      'browser.tabs.open',
      { url: 'https://example.com/new' },
      context,
    )).resolves.toMatchObject({
      ok: true,
      value: { url: 'https://example.com/new' },
    });
    expect(dependencies.openDockTab).toHaveBeenCalledWith('https://example.com/new', undefined);

    const blocked = await runtime.call('browser.tabs.open', { url: 'file:///tmp/a' }, context);
    expect(blocked).toMatchObject({
      ok: false,
      error: { code: 'unsupported_url', message: expect.stringContaining('Only http(s)') },
    });
  });
});
