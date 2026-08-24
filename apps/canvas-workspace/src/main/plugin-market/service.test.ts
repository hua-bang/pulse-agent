import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, resolve } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_PLUGIN_MCP_V1_SCHEMA,
  AGENT_PLUGIN_V1_SCHEMA,
  type PluginMarketMutationResult,
  type PluginMarketSource,
} from '../../shared/plugin-market';

const fakes = vi.hoisted(() => ({
  userData: '',
  registeredRoots: new Set<string>(),
  nativePolicy: new Map<string, boolean>(),
  configuredPlugins: [] as Array<{ id: string; dir: string }>,
  dialog: vi.fn(),
  addWithPolicy: vi.fn(),
  addWithoutPolicy: vi.fn(),
  setPolicy: vi.fn(),
  remove: vi.fn(),
  getStatus: vi.fn(),
  getPolicy: vi.fn(),
  reloadMain: vi.fn(),
  reloadMcp: vi.fn(),
  connectOauth: vi.fn(),
  connectedOauth: new Set<string>(),
}));

vi.mock('electron', () => ({
  app: { getPath: () => fakes.userData },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: { showOpenDialog: fakes.dialog },
}));

vi.mock('../settings/canvas-plugins-config', () => ({
  addCanvasPluginDirectory: vi.fn(async (root: string) => {
    fakes.registeredRoots.add(resolve(root));
    return fakes.getStatus();
  }),
  addCanvasPluginDirectoryWithNativePolicy: fakes.addWithPolicy,
  addCanvasPluginDirectoryWithoutNativePolicy: fakes.addWithoutPolicy,
  getCanvasPluginExplicitNativePolicySync: (root: string) => fakes.nativePolicy.get(resolve(root)),
  getCanvasPluginNativePolicySync: fakes.getPolicy,
  getCanvasPluginsStatus: fakes.getStatus,
  removeCanvasPluginDirectory: fakes.remove,
  setCanvasPluginNativePolicy: fakes.setPolicy,
}));

vi.mock('../agent/ipc', () => ({
  getCanvasAgentService: () => ({ reloadMcp: fakes.reloadMcp }),
}));

vi.mock('../agent/mcp/oauth', () => ({
  connectCanvasMcpOAuth: fakes.connectOauth,
  getCanvasMcpOAuthStatus: async (serverName: string) => ({
    connected: fakes.connectedOauth.has(serverName),
    hasClientInformation: false,
  }),
}));

vi.mock('../../plugins/main', () => ({
  reloadConfiguredExternalMainPlugins: fakes.reloadMain,
}));

let pluginRoots: string[] = [];

function canvasStatus() {
  return {
    path: join(fakes.userData, 'canvas-plugins.json'),
    pluginDirs: [...fakes.registeredRoots],
    plugins: fakes.configuredPlugins.map((plugin) => ({
      ...plugin,
      manifestPath: join(plugin.dir, 'plugin.json'),
      nodes: [],
      rendererSpecs: [],
    })),
    rendererSpecs: [],
  };
}

async function createPlugin(name: string, withInvalidMcp = false): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plugin-market-service-'));
  pluginRoots.push(root);
  await writeFile(join(root, 'plugin.json'), JSON.stringify({
    $schema: AGENT_PLUGIN_V1_SCHEMA,
    name,
  }), 'utf8');
  if (withInvalidMcp) {
    await writeFile(join(root, 'mcp.json'), JSON.stringify({
      $schema: AGENT_PLUGIN_MCP_V1_SCHEMA,
      mcpServers: { broken: { type: 'stdio', command: '' } },
    }), 'utf8');
  }
  return realpath(root);
}

async function createLegacyPlugin(name: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'plugin-market-legacy-service-'));
  pluginRoots.push(root);
  await writeFile(join(root, 'manifest.json'), JSON.stringify({ id: name }), 'utf8');
  return realpath(root);
}

async function createRemotePlugin(name: string): Promise<string> {
  const root = await createPlugin(name);
  await writeFile(join(root, 'mcp.json'), JSON.stringify({
    $schema: AGENT_PLUGIN_MCP_V1_SCHEMA,
    mcpServers: {
      remote: { type: 'streamable-http', url: 'https://plugins.example.test/mcp' },
    },
  }), 'utf8');
  return root;
}

async function choose(
  service: { chooseDirectory: () => Promise<PluginMarketMutationResult> },
  root: string,
) {
  fakes.dialog.mockResolvedValueOnce({ canceled: false, filePaths: [root] });
  return service.chooseDirectory();
}

function gitSource(value: Omit<PluginMarketSource, 'kind'>): PluginMarketSource {
  return { kind: 'git', ...value };
}

beforeEach(async () => {
  vi.resetModules();
  fakes.userData = await mkdtemp(join(tmpdir(), 'plugin-market-state-'));
  pluginRoots = [];
  fakes.registeredRoots.clear();
  fakes.nativePolicy.clear();
  fakes.configuredPlugins.length = 0;
  fakes.connectedOauth.clear();
  vi.clearAllMocks();
  fakes.getStatus.mockImplementation(async () => canvasStatus());
  fakes.getPolicy.mockImplementation((root: string, format: string) => (
    fakes.nativePolicy.get(resolve(root)) ?? format === 'legacy-canvas'
  ));
  fakes.addWithPolicy.mockImplementation(async (root: string, enabled: boolean) => {
    fakes.registeredRoots.add(resolve(root));
    fakes.nativePolicy.set(resolve(root), enabled);
    return canvasStatus();
  });
  fakes.addWithoutPolicy.mockImplementation(async (root: string) => {
    fakes.registeredRoots.add(resolve(root));
    fakes.nativePolicy.delete(resolve(root));
    return canvasStatus();
  });
  fakes.setPolicy.mockImplementation(async (root: string, enabled: boolean) => {
    if (!fakes.registeredRoots.has(resolve(root))) throw new Error('not registered');
    fakes.nativePolicy.set(resolve(root), enabled);
    return canvasStatus();
  });
  fakes.remove.mockImplementation(async (root: string) => {
    fakes.registeredRoots.delete(resolve(root));
    fakes.nativePolicy.delete(resolve(root));
    return canvasStatus();
  });
  fakes.reloadMain.mockResolvedValue(undefined);
  fakes.reloadMcp.mockResolvedValue(undefined);
  fakes.connectOauth.mockImplementation(async (serverName: string) => {
    fakes.connectedOauth.add(serverName);
  });
});

afterEach(async () => {
  await Promise.all([
    rm(fakes.userData, { recursive: true, force: true }),
    ...pluginRoots.map((root) => rm(root, { recursive: true, force: true })),
  ]);
});

describe('normalizedGitSource', () => {
  it('normalizes a credential-free HTTPS source, ref, and contained subdirectory', async () => {
    const { normalizedGitSource } = await import('./service');

    expect(normalizedGitSource(gitSource({
      url: ' https://github.com/example/plugin ',
      ref: ' release/v1 ',
      subdir: './packages/demo',
    }))).toEqual({
      kind: 'git',
      url: 'https://github.com/example/plugin',
      ref: 'release/v1',
      subdir: 'packages/demo',
    });
  });

  it.each([
    ['non-HTTPS URL', gitSource({ url: 'git://github.com/example/plugin.git' })],
    ['embedded username', gitSource({ url: 'https://user@github.com/example/plugin.git' })],
    ['embedded password', gitSource({ url: 'https://user:secret@github.com/example/plugin.git' })],
  ])('rejects a %s', async (_label, source) => {
    const { normalizedGitSource } = await import('./service');

    expect(() => normalizedGitSource(source)).toThrow(
      'Only credential-free HTTPS Git repository URLs are supported',
    );
  });

  it.each([
    'https://github.com/example/plugin.git?access_token=secret',
    'https://github.com/example/plugin.git#credential',
  ])('rejects credential-bearing URL components: %s', async (url) => {
    const { normalizedGitSource } = await import('./service');
    expect(() => normalizedGitSource(gitSource({ url })))
      .toThrow('Git repository URL cannot contain a query or fragment');
  });

  it('rejects refs that Git could interpret as an option', async () => {
    const { normalizedGitSource } = await import('./service');

    expect(() => normalizedGitSource(gitSource({
      url: 'https://github.com/example/plugin.git',
      ref: '--upload-pack=malicious',
    }))).toThrow('Git ref cannot start with a dash');
  });

  it.each([
    '/absolute/path',
    '../outside',
    'packages/../../outside',
    '..\\outside',
    'C:\\outside',
  ])('rejects an escaping plugin subdirectory: %s', async (subdir) => {
    const { normalizedGitSource } = await import('./service');

    expect(() => normalizedGitSource(gitSource({
      url: 'https://github.com/example/plugin.git',
      subdir,
    }))).toThrow('Plugin subdirectory must stay inside the repository');
  });

  it.each([
    { kind: 'directory', path: '/tmp/plugin' } satisfies PluginMarketSource,
    { kind: 'git', url: 'not a URL' } satisfies PluginMarketSource,
    { kind: 'git' } satisfies PluginMarketSource,
  ])('rejects a source that is not a valid Git repository URL', async (source) => {
    const { normalizedGitSource } = await import('./service');

    expect(() => normalizedGitSource(source)).toThrow();
  });
});

describe('assertManagedPackageTree', () => {
  it('accepts a small ordinary package while ignoring Git metadata', async () => {
    const root = await createPlugin('bounded-package');
    await mkdir(join(root, '.git'), { recursive: true });
    await writeFile(join(root, '.git', 'large-pack'), Buffer.alloc(256), 'utf8');
    const { assertManagedPackageTree } = await import('./service');

    await expect(assertManagedPackageTree(root, {
      entries: 4,
      files: 2,
      singleFileBytes: 128,
      totalFileBytes: 256,
      relativePathBytes: 128,
    })).resolves.toBeUndefined();
  });

  it('rejects oversized files and symbolic links in managed Git packages', async () => {
    const oversized = await createPlugin('oversized-package');
    await writeFile(join(oversized, 'payload.bin'), Buffer.alloc(64), 'utf8');
    const outside = await createPlugin('outside-package');
    const linked = await createPlugin('linked-package');
    await symlink(join(outside, 'plugin.json'), join(linked, 'linked.json'));
    const { assertManagedPackageTree } = await import('./service');
    const limits = {
      entries: 8,
      files: 8,
      singleFileBytes: 32,
      totalFileBytes: 256,
      relativePathBytes: 128,
    };

    await expect(assertManagedPackageTree(oversized, limits)).rejects.toThrow('file is too large');
    await expect(assertManagedPackageTree(linked, limits)).rejects.toThrow('symbolic links');
  });
});

describe('PluginMarketService mutations', () => {
  it('retains component diagnostics on a successful install', async () => {
    const root = await createPlugin('diagnostic-plugin', true);
    const { PluginMarketService } = await import('./service');

    const result = await choose(new PluginMarketService(), root);

    expect(result).toMatchObject({ ok: true });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'mcp-server.invalid', componentId: 'broken' }),
    ]);
  });

  it('rejects the same package name from a different root', async () => {
    const [firstRoot, secondRoot] = await Promise.all([
      createPlugin('duplicate-name'),
      createPlugin('duplicate-name'),
    ]);
    const { PluginMarketService } = await import('./service');
    const service = new PluginMarketService();

    expect(await choose(service, firstRoot)).toMatchObject({ ok: true });
    expect(await choose(service, secondRoot)).toMatchObject({
      ok: false,
      error: expect.stringContaining('already installed from another location'),
    });
    expect(fakes.registeredRoots).toEqual(new Set([firstRoot]));
  });

  it('rolls state back when the execution config cannot be committed', async () => {
    const root = await createPlugin('config-failure');
    fakes.addWithPolicy.mockRejectedValueOnce(new Error('config write failed'));
    const { PluginMarketService } = await import('./service');

    expect(await choose(new PluginMarketService(), root)).toMatchObject({
      ok: false,
      error: 'config write failed',
    });
    const { readPluginMarketState } = await import('./store');
    await expect(readPluginMarketState()).resolves.toMatchObject({ plugins: [] });
    expect(fakes.registeredRoots.has(root)).toBe(false);
  });

  it('restores the execution config when the state commit fails', async () => {
    const root = await createPlugin('state-failure');
    fakes.addWithPolicy.mockImplementationOnce(async (pluginRoot: string, enabled: boolean) => {
      fakes.registeredRoots.add(resolve(pluginRoot));
      fakes.nativePolicy.set(resolve(pluginRoot), enabled);
      await mkdir(join(fakes.userData, 'plugin-market', 'plugin-market.json'), { recursive: true });
      return canvasStatus();
    });
    const { PluginMarketService } = await import('./service');

    expect(await choose(new PluginMarketService(), root)).toMatchObject({ ok: false });
    expect(fakes.registeredRoots.has(root)).toBe(false);
    expect(fakes.nativePolicy.has(root)).toBe(false);
  });

  it('restores an existing legacy registration without inventing a native policy', async () => {
    const root = await createLegacyPlugin('legacy-state-failure');
    fakes.registeredRoots.add(root);
    fakes.addWithPolicy.mockImplementationOnce(async (pluginRoot: string, enabled: boolean) => {
      fakes.registeredRoots.add(resolve(pluginRoot));
      fakes.nativePolicy.set(resolve(pluginRoot), enabled);
      await mkdir(join(fakes.userData, 'plugin-market', 'plugin-market.json'), { recursive: true });
      return canvasStatus();
    });
    const { PluginMarketService } = await import('./service');

    expect(await choose(new PluginMarketService(), root)).toMatchObject({ ok: false });
    expect(fakes.registeredRoots.has(root)).toBe(true);
    expect(fakes.addWithoutPolicy).toHaveBeenCalledTimes(1);
    expect(fakes.addWithoutPolicy).toHaveBeenCalledWith(root);
    expect(fakes.nativePolicy.has(root)).toBe(false);
  });

  it('keeps committed state and config when runtime refresh fails', async () => {
    const root = await createPlugin('refresh-failure');
    fakes.reloadMcp.mockRejectedValueOnce(new Error('reload failed'));
    const { PluginMarketService } = await import('./service');

    const result = await choose(new PluginMarketService(), root);

    expect(result).toMatchObject({ ok: true });
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'runtime.refresh-failed' }),
    ]);
    expect(fakes.registeredRoots.has(root)).toBe(true);
    expect(fakes.nativePolicy.get(root)).toBe(false);
    const state = JSON.parse(await readFile(
      join(fakes.userData, 'plugin-market', 'plugin-market.json'),
      'utf8',
    )) as { plugins: Array<{ root: string }> };
    expect(state.plugins.map((plugin) => plugin.root)).toEqual([root]);
  });

  it('serializes concurrent directory mutations', async () => {
    const [firstRoot, secondRoot] = await Promise.all([
      createPlugin('serialized-first'),
      createPlugin('serialized-second'),
    ]);
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolveGate) => { releaseFirst = resolveGate; });
    fakes.dialog
      .mockResolvedValueOnce({ canceled: false, filePaths: [firstRoot] })
      .mockResolvedValueOnce({ canceled: false, filePaths: [secondRoot] });
    fakes.addWithPolicy.mockImplementationOnce(async (root: string, enabled: boolean) => {
      await firstGate;
      fakes.registeredRoots.add(resolve(root));
      fakes.nativePolicy.set(resolve(root), enabled);
      return canvasStatus();
    });
    const { PluginMarketService } = await import('./service');
    const service = new PluginMarketService();

    const first = service.chooseDirectory();
    const second = service.chooseDirectory();
    await vi.waitFor(() => expect(fakes.dialog).toHaveBeenCalledTimes(1));
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ ok: true }),
      expect.objectContaining({ ok: true }),
    ]);
    expect(fakes.dialog).toHaveBeenCalledTimes(2);
  });

  it('commits native trust to the execution config and state mirror', async () => {
    const root = await createPlugin('native-toggle');
    const { PluginMarketService } = await import('./service');
    const service = new PluginMarketService();
    const installed = await choose(service, root);
    const listingId = installed.snapshot?.listings.find(
      (listing) => listing.name === 'native-toggle',
    )?.id;

    expect(listingId).toBeTruthy();
    expect(await service.setNativeEnabled(listingId!, true)).toMatchObject({ ok: true });
    expect(fakes.nativePolicy.get(root)).toBe(true);
    const state = JSON.parse(await readFile(
      join(fakes.userData, 'plugin-market', 'plugin-market.json'),
      'utf8',
    )) as { plugins: Array<{ nativeEnabled: boolean }> };
    expect(state.plugins).toEqual([expect.objectContaining({ nativeEnabled: true })]);
  });

  it('connects the next unauthenticated remote MCP server and refreshes its state', async () => {
    const root = await createRemotePlugin('remote-auth');
    const { PluginMarketService } = await import('./service');
    const service = new PluginMarketService();
    const installed = await choose(service, root);
    const listingId = installed.snapshot?.listings.find(
      (listing) => listing.name === 'remote-auth',
    )?.id;

    expect(listingId).toBeTruthy();
    expect(installed.snapshot?.listings.find((listing) => listing.id === listingId)?.mcpAuthState)
      .toBe('connectable');
    const connected = await service.connectMcp(listingId!);

    expect(fakes.connectOauth).toHaveBeenCalledWith(
      'remote-auth.remote',
      'https://plugins.example.test/mcp',
    );
    expect(connected.snapshot?.listings.find((listing) => listing.id === listingId)?.mcpAuthState)
      .toBe('connected');
  });
});
