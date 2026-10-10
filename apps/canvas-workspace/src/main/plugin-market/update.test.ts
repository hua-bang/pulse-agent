import { mkdir, mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AGENT_PLUGIN_V1_SCHEMA, AGENT_PLUGIN_MCP_V1_SCHEMA } from '../../shared/plugin-market';

const fakes = vi.hoisted(() => ({
  userData: '',
  clone: vi.fn(),
  reloadMain: vi.fn(),
  reloadMcp: vi.fn(),
  writeState: vi.fn(),
  updateConfig: vi.fn(),
}));
vi.mock('electron', () => ({
  app: { getPath: () => fakes.userData },
  BrowserWindow: { getFocusedWindow: () => null },
  dialog: { showOpenDialog: vi.fn() },
}));
vi.mock('./git/git-source', async (original) => ({
  ...await original<typeof import('./git/git-source')>(),
  gitClone: fakes.clone,
}));
vi.mock('./store', async (original) => {
  const store = await original<typeof import('./store')>();
  fakes.writeState.mockImplementation(store.writePluginMarketState);
  return { ...store, writePluginMarketState: fakes.writeState };
});
vi.mock('../../plugins/main', () => ({ reloadConfiguredExternalMainPlugins: fakes.reloadMain }));
vi.mock('./config', async (original) => {
  const config = await original<typeof import('./config')>();
  fakes.updateConfig.mockImplementation(config.updateCanvasPluginsConfig);
  return { ...config, updateCanvasPluginsConfig: fakes.updateConfig };
});

import { PluginMarketService } from './service';
import { setPluginMarketAgentPort } from './agent-port';
import { getCanvasPluginsStatus, getCanvasPluginNativePolicySync, setCanvasPluginConfigValue } from './config';
import { readPluginMarketState, pluginMarketDataDir } from './store';

const source = { kind: 'git' as const, url: 'https://github.com/example/plugin', ref: 'main', subdir: 'plugins/demo' };
let fixture: string;
const service = new PluginMarketService();

async function stage(commit: string, version = '1.0.0', name = 'demo-plugin') {
  const stagingDir = await mkdtemp(join(fixture, 'staging-'));
  const packageDir = join(stagingDir, 'package');
  await mkdir(packageDir);
  await writeFile(join(packageDir, 'plugin.json'), JSON.stringify({
    $schema: AGENT_PLUGIN_V1_SCHEMA, name, version,
    extensions: { 'com.pulsecanvas': { schemaVersion: 1, main: { entry: 'main.js' } } },
  }));
  await writeFile(join(packageDir, 'main.js'), 'export default {};');
  await writeFile(join(packageDir, 'mcp.json'), JSON.stringify({
    $schema: AGENT_PLUGIN_MCP_V1_SCHEMA,
    mcpServers: { demo: { type: 'stdio', command: 'node', args: ['${PLUGIN_ROOT}/server.js'] } },
  }));
  fakes.clone.mockResolvedValueOnce({ stagingDir, packageDir, commit });
  return { stagingDir, packageDir };
}

async function installed() {
  await stage('a'.repeat(40));
  const result = await service.addGit(source);
  expect(result.ok).toBe(true);
  return (await readPluginMarketState()).plugins[0];
}

beforeEach(async () => {
  fixture = await mkdtemp(join(tmpdir(), 'plugin-update-'));
  fakes.userData = join(fixture, 'userData');
  fakes.clone.mockReset();
  fakes.reloadMain.mockReset().mockResolvedValue(undefined);
  fakes.reloadMcp.mockReset().mockResolvedValue(undefined);
  fakes.writeState.mockClear();
  fakes.updateConfig.mockClear();
  setPluginMarketAgentPort({
    reloadMcp: fakes.reloadMcp,
    connectMcpOAuth: vi.fn(),
    getMcpStatuses: () => ({}),
  });
});
afterEach(async () => { await rm(fixture, { recursive: true, force: true }); });

describe('Git plugin updates', () => {
  it('switches snapshots, preserves identity/config/data, and disables new native code', async () => {
    const before = await installed();
    await service.setNativeEnabled(before.listingId, true);
    await setCanvasPluginConfigValue(before.packageName, 'setting', 'saved value');
    const data = join(pluginMarketDataDir(), before.listingId.replace(/[^a-zA-Z0-9._-]+/g, '-'), 'keep.txt');
    await mkdir(dirname(data), { recursive: true });
    await writeFile(data, 'keep me');
    const oldAdapter = await readFile(before.runtimeMcpPath!, 'utf8');
    await stage('b'.repeat(40), '2.0.0');

    const result = await service.update(before.listingId);
    expect(result).toMatchObject({ ok: true, updateStatus: 'updated', nativeDisabled: true });
    const after = (await readPluginMarketState()).plugins[0];
    expect(after).toMatchObject({ listingId: before.listingId, source, installedAt: before.installedAt, nativeEnabled: false });
    expect(after.root).not.toBe(before.root);
    expect((await getCanvasPluginsStatus()).pluginDirs).toEqual([after.root]);
    const config = JSON.parse(await readFile(join(fakes.userData, 'canvas-plugins.json'), 'utf8'));
    expect(config.pluginConfig['demo-plugin'].setting).toBe(`plain:${Buffer.from('saved value').toString('base64')}`);
    expect(config.pluginNativePolicy).toEqual({ [after.root]: false });
    expect(await readFile(data, 'utf8')).toBe('keep me');
    expect(await readFile(before.runtimeMcpPath!, 'utf8')).toBe(oldAdapter);
    expect(await readFile(after.runtimeMcpPath!, 'utf8')).toContain(after.root);
    expect(result.snapshot?.listings.find((item) => item.id === before.listingId)?.version).toBe('2.0.0');
    expect(fakes.clone).toHaveBeenLastCalledWith(source);
  });

  it('does not reload or reset trust when the commit is unchanged, including pinned refs', async () => {
    const before = await installed();
    await service.setNativeEnabled(before.listingId, true);
    const state = await readPluginMarketState();
    state.plugins[0].source.ref = 'a'.repeat(40);
    await fakes.writeState(state);
    fakes.reloadMain.mockClear();
    fakes.reloadMcp.mockClear();
    await stage('a'.repeat(40));
    expect(await service.update(before.listingId)).toMatchObject({ ok: true, updateStatus: 'unchanged' });
    expect((await readPluginMarketState()).plugins[0]).toMatchObject({ root: before.root, nativeEnabled: true });
    expect(fakes.clone).toHaveBeenLastCalledWith({ ...source, ref: 'a'.repeat(40) });
    expect(fakes.reloadMain).not.toHaveBeenCalled();
    expect(fakes.reloadMcp).not.toHaveBeenCalled();
  });

  it.each(['download', 'manifest', 'mcp', 'identity'])('keeps the old installation on %s failure', async (failure) => {
    const before = await installed();
    const adapter = await readFile(before.runtimeMcpPath!, 'utf8');
    if (failure === 'download') fakes.clone.mockRejectedValueOnce(new Error('network unavailable'));
    else {
      const next = await stage('b'.repeat(40), '2.0.0', failure === 'identity' ? 'renamed' : 'demo-plugin');
      if (failure === 'manifest') await writeFile(join(next.packageDir, 'plugin.json'), '{}');
      if (failure === 'mcp') await writeFile(join(next.packageDir, 'mcp.json'), '{}');
    }
    expect((await service.update(before.listingId)).ok).toBe(false);
    expect((await readPluginMarketState()).plugins).toEqual([before]);
    expect((await getCanvasPluginsStatus()).pluginDirs).toEqual([before.root]);
    expect(await readFile(before.runtimeMcpPath!, 'utf8')).toBe(adapter);
  });

  it('restores registration and the old MCP adapter when saving state fails', async () => {
    const before = await installed();
    await service.setNativeEnabled(before.listingId, true);
    const previous = await readPluginMarketState();
    const adapter = await readFile(before.runtimeMcpPath!, 'utf8');
    await stage('b'.repeat(40), '2.0.0');
    fakes.writeState.mockRejectedValueOnce(new Error('disk full'));
    expect(await service.update(before.listingId)).toMatchObject({ ok: false, error: 'disk full' });
    expect(await readPluginMarketState()).toEqual(previous);
    const status = await getCanvasPluginsStatus();
    expect(status.pluginDirs).toEqual([before.root]);
    expect(getCanvasPluginNativePolicySync(before.root, 'agent-plugin')).toBe(true);
    expect(await readFile(before.runtimeMcpPath!, 'utf8')).toBe(adapter);
  });

  it('updates public listings from the installed package instead of stale catalog metadata', async () => {
    const { PUBLIC_PLUGIN_CATALOG } = await import('./catalog');
    const entry = PUBLIC_PLUGIN_CATALOG.find((item) => item.installState === 'available')!;
    await stage('a'.repeat(40));
    expect((await service.install(entry.id)).ok).toBe(true);
    await stage('b'.repeat(40), '2.0.0');
    const result = await service.update(entry.id);
    expect(result.snapshot?.listings.find((item) => item.id === entry.id))
      .toMatchObject({ version: '2.0.0', source: entry.source });
  });

  it('preserves the old native policy when config fails before the replacement runs', async () => {
    const before = await installed();
    await service.setNativeEnabled(before.listingId, true);
    await stage('b'.repeat(40));
    fakes.updateConfig.mockRejectedValueOnce(new Error('config unavailable'));
    expect(await service.update(before.listingId)).toMatchObject({ ok: false, error: 'config unavailable' });
    expect((await getCanvasPluginsStatus()).pluginDirs).toEqual([before.root]);
    expect(getCanvasPluginNativePolicySync(before.root, 'agent-plugin')).toBe(true);
  });

  it('retains both snapshots if restoring registration also fails', async () => {
    const before = await installed();
    await stage('b'.repeat(40));
    const apply = fakes.updateConfig.getMockImplementation()!;
    fakes.updateConfig.mockImplementationOnce(apply).mockRejectedValueOnce(new Error('rollback unavailable'));
    fakes.writeState.mockRejectedValueOnce(new Error('state unavailable'));
    const result = await service.update(before.listingId);
    expect(result.ok).toBe(false);
    expect(result.error).toContain('registration could not be restored');
    expect(await readFile(join(before.root, 'plugin.json'), 'utf8')).toContain('demo-plugin');
    const registeredRoot = (await getCanvasPluginsStatus()).pluginDirs[0];
    expect(registeredRoot).not.toBe(before.root);
    expect(await readFile(join(registeredRoot, 'plugin.json'), 'utf8')).toContain('demo-plugin');
  });

  it('rejects local directory and missing installations', async () => {
    expect(await service.update('missing')).toMatchObject({ ok: false });
    expect(fakes.clone).not.toHaveBeenCalled();
    const before = await installed();
    const state = await readPluginMarketState();
    state.plugins[0] = { ...before, managed: false, source: { kind: 'directory', path: before.root } };
    await fakes.writeState(state);
    fakes.clone.mockClear();
    expect(await service.update(before.listingId)).toMatchObject({ ok: false });
    expect(fakes.clone).not.toHaveBeenCalled();
  });

  it('reports a committed update honestly if runtime reload fails', async () => {
    const before = await installed();
    await stage('b'.repeat(40));
    fakes.reloadMcp.mockRejectedValueOnce(new Error('reload failed'));
    const result = await service.update(before.listingId);
    expect(result).toMatchObject({ ok: true, updateStatus: 'updated' });
    expect(result.diagnostics).toEqual(expect.arrayContaining([expect.objectContaining({ code: 'runtime.refresh-failed' })]));
    expect((await readPluginMarketState()).plugins[0].root).not.toBe(before.root);
  });
});
