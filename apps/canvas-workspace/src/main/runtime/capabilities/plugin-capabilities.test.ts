import { describe, expect, it, vi } from 'vitest';

import { CapabilityRuntime } from './runtime';
import { createPluginCapabilities } from './plugin-capabilities';

const context = { workspaceId: 'ws-1', actor: { kind: 'pulse-cli' as const } };

describe('Plugin capabilities', () => {
  it('installs an absolute plugin folder for external agents', async () => {
    const install = vi.fn(async () => ({ ok: true, name: 'weread', nativeEnabled: false }));
    const runtime = new CapabilityRuntime(createPluginCapabilities({ install, guide: async () => '' }));

    expect(runtime.list({ kind: 'pulse-cli' }).map(({ name, risk }) => `${name}:${risk}`))
      .toEqual(['plugins.guide:read', 'plugins.install:operate']);
    await expect(runtime.call('plugins.install', { dir: ' /tmp/weread ' }, context))
      .resolves.toEqual({ ok: true, value: { ok: true, name: 'weread', nativeEnabled: false } });
    expect(install).toHaveBeenCalledWith('/tmp/weread');

    await expect(runtime.call('plugins.install', { dir: 'weread' }, context)).resolves.toMatchObject({
      ok: false,
      error: { code: 'invalid_input', message: 'dir must be an absolute path' },
    });
    expect(install).toHaveBeenCalledTimes(1);
  });

  it('returns the in-app guide with the CLI mapping first', async () => {
    const runtime = new CapabilityRuntime(createPluginCapabilities({
      install: vi.fn(),
      guide: async () => '# create-canvas-plugin',
    }));

    const result = await runtime.call('plugins.guide', {}, context);
    expect(result.ok).toBe(true);
    const guide = (result as { value: { guide: string } }).value.guide;
    expect(guide).toContain('run `pulse-canvas plugin install <dir>` instead');
    expect(guide.endsWith('# create-canvas-plugin')).toBe(true);
  });
});
