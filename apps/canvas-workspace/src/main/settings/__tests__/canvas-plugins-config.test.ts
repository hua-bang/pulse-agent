import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { paths } = vi.hoisted(() => ({
  paths: {
    userData: '',
  },
}));

let pluginDirsToClean: string[] = [];

vi.mock('electron', () => ({
  app: {
    getPath: () => paths.userData,
  },
}));

async function loadConfigModule() {
  return import('../canvas-plugins-config');
}

async function createPluginDir(id: string, nodeType = `${id}.card`): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), `canvas-plugin-${id}-`));
  pluginDirsToClean.push(dir);
  await writeFile(
    join(dir, 'manifest.json'),
    JSON.stringify(
      {
        id,
        version: '1.2.3',
        main: {
          entry: 'dist/main.js',
          format: 'esm',
          runtime: 'electron-main',
          permissions: ['canvas'],
        },
        nodes: [
          {
            type: nodeType,
            title: `${id} Card`,
            capabilities: ['read', 'write', 'action'],
            actions: ['refresh'],
            renderer: {
              remoteName: `${id}_remote`,
              entry: 'renderer/remoteEntry.js',
              expose: './plugin',
              type: 'global',
            },
          },
        ],
      },
      null,
      2,
    ),
    'utf8',
  );
  return dir;
}

describe('canvas plugins config', () => {
  beforeEach(async () => {
    vi.resetModules();
    pluginDirsToClean = [];
    paths.userData = await mkdtemp(join(tmpdir(), 'canvas-plugins-config-'));
  });

  afterEach(async () => {
    if (paths.userData) {
      await rm(paths.userData, { recursive: true, force: true });
    }
    await Promise.all(pluginDirsToClean.map((dir) => rm(dir, { recursive: true, force: true })));
  });

  it('adds a plugin directory and resolves renderer specs from manifest.json', async () => {
    const pluginDir = await createPluginDir('demo', 'demo.widget');
    const {
      addCanvasPluginDirectory,
      canvasPluginsConfigPath,
    } = await loadConfigModule();

    const status = await addCanvasPluginDirectory(pluginDir);

    expect(status.path).toBe(canvasPluginsConfigPath());
    expect(status.pluginDirs).toEqual([resolve(pluginDir)]);
    expect(status.plugins).toHaveLength(1);
    expect(status.plugins[0]).toMatchObject({
      id: 'demo',
      version: '1.2.3',
      dir: resolve(pluginDir),
      main: {
        entry: resolve(pluginDir, 'dist/main.js'),
        format: 'esm',
        runtime: 'electron-main',
        permissions: ['canvas'],
      },
      nodes: [
        {
          type: 'demo.widget',
          title: 'demo Card',
          capabilities: ['read', 'write', 'action'],
          actions: ['refresh'],
        },
      ],
    });
    expect(status.rendererSpecs).toEqual([
      expect.objectContaining({
        id: 'demo',
        name: 'demo_remote',
        expose: './plugin',
        type: 'global',
        entryGlobalName: 'demo_remote',
        version: '1.2.3',
      }),
    ]);
    expect(status.rendererSpecs[0].entry).toMatch(
      /^pulse-canvas:\/\/local\/.+\/renderer\/remoteEntry\.js$/,
    );

    const stored = JSON.parse(await readFile(canvasPluginsConfigPath(), 'utf8')) as {
      pluginDirs: string[];
    };
    expect(stored.pluginDirs).toEqual([resolve(pluginDir)]);
  });

  it('imports JSON config, reports duplicates, and removes directories', async () => {
    const alpha = await createPluginDir('alpha');
    const beta = await createPluginDir('beta');
    const {
      importCanvasPluginsConfigJson,
      removeCanvasPluginDirectory,
    } = await loadConfigModule();

    const imported = await importCanvasPluginsConfigJson(JSON.stringify({
      pluginDirs: [alpha, beta, alpha],
    }));

    expect(imported.entries).toEqual([
      { dir: resolve(alpha), status: 'added' },
      { dir: resolve(beta), status: 'added' },
      { dir: resolve(alpha), status: 'existing' },
    ]);
    expect(imported.status.pluginDirs).toEqual([resolve(alpha), resolve(beta)]);
    expect(imported.status.rendererSpecs.map((spec) => spec.id).sort()).toEqual(['alpha', 'beta']);

    const removed = await removeCanvasPluginDirectory(alpha);

    expect(removed.pluginDirs).toEqual([resolve(beta)]);
    expect(removed.plugins.map((plugin) => plugin.id)).toEqual(['beta']);
  });
});
