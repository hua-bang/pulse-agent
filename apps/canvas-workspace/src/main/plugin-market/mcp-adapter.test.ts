import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NormalizedPluginPackage } from '../../shared/plugin-market';

const { paths } = vi.hoisted(() => ({
  paths: {
    userData: '',
  },
}));

vi.mock('electron', () => ({
  app: {
    getPath: () => paths.userData,
  },
}));

function pluginPackage(root: string): NormalizedPluginPackage {
  return {
    format: 'agent-plugin',
    root,
    manifestPath: join(root, 'plugin.json'),
    name: 'acme/demo plugin',
    keywords: [],
    skills: [],
    mcp: {
      path: join(root, 'mcp.json'),
      servers: [
        {
          name: 'local',
          type: 'stdio',
          command: './bin/server',
          resolvedCommand: join(root, 'bin', 'server'),
          args: ['--root', '${PLUGIN_ROOT}', '--cache=${PLUGIN_DATA}/cache'],
          env: {
            ROOT_PATH: '${PLUGIN_ROOT}',
            CACHE_PATH: '${PLUGIN_DATA}/cache',
          },
          cwd: '${PLUGIN_DATA}/work',
        },
        {
          name: 'remote',
          type: 'streamable-http',
          url: 'https://plugins.example.test/mcp',
          headers: { 'x-exa-source': 'agent-plugin' },
        },
        {
          name: 'events',
          type: 'sse',
          url: 'https://plugins.example.test/events',
        },
      ],
    },
  };
}

describe('writePluginMcpAdapter', () => {
  beforeEach(async () => {
    vi.resetModules();
    paths.userData = await mkdtemp(join(tmpdir(), 'plugin-mcp-adapter-'));
  });

  afterEach(async () => {
    await rm(paths.userData, { recursive: true, force: true });
  });

  it('writes Pulse MCP transports and expands plugin runtime variables', async () => {
    const pluginRoot = join(paths.userData, 'source ${PLUGIN_DATA} plugin');
    const { writePluginMcpAdapter } = await import('./mcp-adapter');

    const adapterPath = await writePluginMcpAdapter(
      'market/example plugin',
      pluginPackage(pluginRoot),
    );

    const dataDir = join(paths.userData, 'plugin-market', 'data', 'market-example-plugin');
    const parsed = JSON.parse(await readFile(adapterPath!, 'utf8')) as {
      servers: Record<string, unknown>;
    };
    expect(adapterPath).toBe(
      join(paths.userData, 'plugin-market', 'runtime', 'market-example-plugin', 'mcp.json'),
    );
    expect(parsed).toEqual({
      servers: {
        'acme-demo-plugin.local': {
          transport: 'stdio',
          command: join(pluginRoot, 'bin', 'server'),
          args: ['--root', pluginRoot, `--cache=${dataDir}/cache`],
          env: {
            ROOT_PATH: pluginRoot,
            CACHE_PATH: `${dataDir}/cache`,
            PLUGIN_ROOT: pluginRoot,
            PLUGIN_DATA: dataDir,
          },
          cwd: `${dataDir}/work`,
        },
        'acme-demo-plugin.remote': {
          transport: 'http',
          url: 'https://plugins.example.test/mcp',
          auth: 'oauth',
          headers: { 'x-exa-source': 'agent-plugin' },
        },
        'acme-demo-plugin.events': {
          transport: 'sse',
          url: 'https://plugins.example.test/events',
          auth: 'oauth',
        },
      },
    });
  });

  it('does not create an adapter for a package without MCP servers', async () => {
    const plugin = pluginPackage(join(paths.userData, 'source'));
    plugin.mcp = { path: join(plugin.root, 'mcp.json'), servers: [] };
    const { writePluginMcpAdapter } = await import('./mcp-adapter');

    await expect(writePluginMcpAdapter('empty', plugin)).resolves.toBeUndefined();
  });
});
