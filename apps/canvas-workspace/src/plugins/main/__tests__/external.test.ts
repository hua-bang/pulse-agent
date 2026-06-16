import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasPluginEntry } from '../../../shared/settings-config';

vi.mock('../../../main/settings/canvas-plugins-config', () => ({
  getCanvasPluginsStatus: vi.fn(async () => ({
    path: '/tmp/canvas-plugins.json',
    pluginDirs: [],
    plugins: [],
    rendererSpecs: [],
  })),
}));

async function writeModule(source: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'canvas-main-plugin-'));
  const file = join(dir, `plugin-${Date.now()}-${Math.random().toString(16).slice(2)}.mjs`);
  await writeFile(file, source, 'utf8');
  return file;
}

function pluginEntry(id: string, entry: string): CanvasPluginEntry {
  return {
    id,
    dir: join(tmpdir(), id),
    manifestPath: join(tmpdir(), id, 'manifest.json'),
    main: {
      entry,
      format: 'esm',
      runtime: 'electron-main',
    },
    nodes: [],
    rendererSpecs: [],
  };
}

describe('external main plugin loader', () => {
  it('loads a valid default export from a manifest main entry', async () => {
    const { loadExternalMainPluginEntries } = await import('../external');
    const entry = await writeModule(`
      export default {
        id: 'demo-main',
        activate(ctx) {
          ctx.registerCanvasTool(() => ({ demo_tool: { name: 'demo_tool' } }));
        }
      };
    `);

    const plugins = await loadExternalMainPluginEntries([pluginEntry('demo-main', entry)]);

    expect(plugins).toHaveLength(1);
    expect(plugins[0].id).toBe('demo-main');
    expect(typeof plugins[0].activate).toBe('function');
  });

  it('skips main exports whose id does not match the manifest id', async () => {
    const { loadExternalMainPluginEntries } = await import('../external');
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const entry = await writeModule(`
      export const plugin = {
        id: 'different-id',
        activate() {}
      };
    `);

    const plugins = await loadExternalMainPluginEntries([pluginEntry('manifest-id', entry)]);

    expect(plugins).toEqual([]);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('main export id "different-id" does not match manifest id'),
    );
    warnSpy.mockRestore();
  });
});
