import { mkdtemp, utimes, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { describe, expect, it, vi } from 'vitest';
import type { CanvasPluginEntry } from '../../../shared/settings-config';

// createMainCtx builds a plugin store from app.getPath eagerly.
vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), removeHandler: vi.fn() },
  app: { getPath: () => '/tmp/canvas-external-plugin-test' },
}));

const configured = vi.hoisted(() => ({ plugins: [] as unknown[] }));

vi.mock('../../../main/plugin-market/config', () => ({
  getCanvasPluginsStatus: vi.fn(async () => ({
    path: '/tmp/canvas-plugins.json',
    pluginDirs: [],
    plugins: configured.plugins,
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

  it('reloads an active plugin when its main entry changes on disk', async () => {
    const { reloadConfiguredExternalMainPlugins } = await import('../external');
    const { deactivateCanvasPlugin } = await import('../registry');
    const hits = globalThis as { __hotMainLoads?: string[] };
    hits.__hotMainLoads = [];
    const source = (label: string) => `
      export default {
        id: 'hot-main',
        activate() { globalThis.__hotMainLoads.push('${label}'); }
      };
    `;
    const entry = await writeModule(source('v1'));
    configured.plugins = [pluginEntry('hot-main', entry)];

    await reloadConfiguredExternalMainPlugins();
    await reloadConfiguredExternalMainPlugins();
    expect(hits.__hotMainLoads).toEqual(['v1']);

    await writeFile(entry, source('v2'), 'utf8');
    const later = new Date(Date.now() + 5_000);
    await utimes(entry, later, later);
    await reloadConfiguredExternalMainPlugins();

    expect(hits.__hotMainLoads).toEqual(['v1', 'v2']);
    configured.plugins = [];
    await deactivateCanvasPlugin('hot-main');
  });
});
