import { mkdir, mkdtemp, realpath, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AGENT_PLUGIN_V1_SCHEMA,
  PULSE_CANVAS_EXTENSION_NAMESPACE,
  type CanvasPluginInstallReport,
} from '../../../../shared/plugin-market';

const installDirectory = vi.fn();
const send = vi.fn();
const getCanvasPluginLoadError = vi.fn();

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [{ isDestroyed: () => false, webContents: { send } }] },
}));

vi.mock('../../../plugin-market/service', () => ({
  getPluginMarketService: () => ({ installDirectory }),
}));

vi.mock('../../../../plugins/main', () => ({ getCanvasPluginLoadError }));

const { createPluginInstallTools } = await import('./install');

let root = '';

async function writePlugin(renderer: Record<string, string>, main?: Record<string, string>): Promise<string> {
  await writeFile(join(root, 'plugin.json'), JSON.stringify({
    $schema: AGENT_PLUGIN_V1_SCHEMA,
    name: 'session-stats',
    version: '0.1.0',
    extensions: { [PULSE_CANVAS_EXTENSION_NAMESPACE]: { renderer, ...(main ? { main } : {}) } },
  }), 'utf8');
  if (main) await writeFile(join(root, 'main.mjs'), 'export default {};', 'utf8');
  await mkdir(join(root, 'renderer'), { recursive: true });
  await writeFile(join(root, 'renderer', 'remoteEntry.js'), '(function () {})();', 'utf8');
  return realpath(root);
}

async function run(dir: string): Promise<CanvasPluginInstallReport> {
  const tool = createPluginInstallTools().canvas_plugin_install;
  return JSON.parse(await tool.execute({ dir })) as CanvasPluginInstallReport;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'plugin-install-tool-'));
  installDirectory.mockReset();
  send.mockReset();
  getCanvasPluginLoadError.mockReset();
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('canvas_plugin_install', () => {
  it('rejects a relative directory without installing', async () => {
    const report = await run('plugins/session-stats');

    expect(report).toMatchObject({ ok: false, error: 'dir must be an absolute path' });
    expect(installDirectory).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it('reports an installed plugin whose native code waits for the user', async () => {
    const canonical = await writePlugin({ remoteName: 'pulse_plugin_session_stats', entry: 'renderer/remoteEntry.js' });
    installDirectory.mockResolvedValue({
      ok: true,
      snapshot: {
        updatedAt: 1,
        listings: [{ id: 'personal:session-stats:abc', name: 'session-stats', installState: 'installed', nativeEnabled: false }],
      },
    });

    const report = await run(root);

    expect(installDirectory).toHaveBeenCalledWith(canonical);
    expect(report).toMatchObject({
      ok: true,
      listingId: 'personal:session-stats:abc',
      name: 'session-stats',
      hasNativeCode: true,
      nativeEnabled: false,
      contents: { renderer: true, main: false, nodeTypes: [], skills: [], mcpServers: [] },
      diagnostics: [],
    });
    expect(report.nextStep).toContain('Enable and open');
    // Open windows sync their plugins, which hot-reloads changed files.
    expect(send).toHaveBeenCalledWith('canvas-plugins:changed');
  });

  it('reports an enabled plugin whose main.mjs failed to load', async () => {
    await writePlugin(
      { remoteName: 'pulse_plugin_session_stats', entry: 'renderer/remoteEntry.js' },
      { entry: 'main.mjs', format: 'esm', runtime: 'electron-main' },
    );
    installDirectory.mockResolvedValue({
      ok: true,
      snapshot: {
        updatedAt: 1,
        listings: [{ id: 'personal:session-stats:abc', name: 'session-stats', installState: 'installed', nativeEnabled: true }],
      },
    });
    getCanvasPluginLoadError.mockReturnValue('SyntaxError: Unexpected token');

    const report = await run(root);

    expect(getCanvasPluginLoadError).toHaveBeenCalledWith('session-stats');
    expect(report.ok).toBe(false);
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'main.load-failed', componentId: 'main' }),
    ]);
    expect(report.diagnostics[0].message).toContain('SyntaxError: Unexpected token');
  });

  it('flags a renderer that the host would skip', async () => {
    await writePlugin({ entry: 'renderer/remoteEntry.js' });
    installDirectory.mockResolvedValue({ ok: true, snapshot: { updatedAt: 1, listings: [] } });

    const report = await run(root);

    expect(report.ok).toBe(false);
    expect(report.diagnostics).toEqual([
      expect.objectContaining({ severity: 'error', code: 'renderer.incomplete', componentId: 'renderer' }),
    ]);
  });

  it('returns reader diagnostics for a folder without plugin.json', async () => {
    const report = await run(root);

    expect(report.ok).toBe(false);
    expect(report.diagnostics.length).toBeGreaterThan(0);
    expect(installDirectory).not.toHaveBeenCalled();
  });
});
