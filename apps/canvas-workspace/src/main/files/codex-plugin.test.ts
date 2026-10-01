import { afterEach, describe, expect, it } from 'vitest';
import { constants, promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import {
  CODEX_MARKETPLACE_NAME,
  createCodexPluginService,
  isVersionAtLeast,
  listIncludesPlugin,
  marketplaceDir,
  type CodexCommandResult,
} from './codex-plugin';

const pluginSource = join(__dirname, '..', '..', '..', '..', '..', 'plugins', 'pulse-canvas');
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true })));
});

const ok = (stdout = ''): CodexCommandResult => ({ code: 0, stdout, stderr: '' });

/** Fake `codex` that records calls and flips to "installed" after `plugin add`. */
function fakeCodex(overrides: { version?: CodexCommandResult; marketplaceAdd?: CodexCommandResult } = {}) {
  const calls: string[] = [];
  let installed = false;
  const run = async (args: string[]): Promise<CodexCommandResult> => {
    calls.push(args.join(' '));
    if (args[0] === '--version') return overrides.version ?? ok('codex-cli 0.160.2');
    if (args.join(' ') === 'plugin list --json') {
      return ok(JSON.stringify({ plugins: installed ? [{ name: 'pulse-canvas', marketplace: CODEX_MARKETPLACE_NAME, enabled: true }] : [] }));
    }
    if (args[1] === 'marketplace') return overrides.marketplaceAdd ?? ok();
    if (args[1] === 'add') {
      installed = true;
      return ok();
    }
    return { code: 1, stdout: '', stderr: `unexpected: ${args.join(' ')}` };
  };
  return { run, calls };
}

async function service(run: (args: string[]) => Promise<CodexCommandResult>, platform: NodeJS.Platform = 'darwin') {
  const installRoot = await fs.mkdtemp(join(tmpdir(), 'codex-plugin-'));
  roots.push(installRoot);
  return { installRoot, svc: createCodexPluginService({ pluginSource, installRoot, platform, run }) };
}

describe('codex plugin status', () => {
  it('reports missing, outdated, unsupported, and connection states', async () => {
    const missing = await service(async () => ({ code: null, stdout: '', stderr: 'spawn codex ENOENT', missing: true }));
    expect((await missing.svc.status()).state).toBe('codex-missing');

    const old = await service(fakeCodex({ version: ok('codex-cli 0.152.9') }).run);
    expect(await old.svc.status()).toMatchObject({ state: 'codex-outdated', codexVersion: '0.152.9', minCodexVersion: '0.153.0' });

    const windows = await service(fakeCodex().run, 'win32');
    expect((await windows.svc.status()).state).toBe('unsupported-platform');

    const fresh = await service(fakeCodex().run);
    const status = await fresh.svc.status();
    expect(status).toMatchObject({ state: 'disconnected', codexVersion: '0.160.2' });
    expect(status.manualCommands).toEqual([
      `codex plugin marketplace add "${marketplaceDir(fresh.installRoot)}"`,
      `codex plugin add pulse-canvas@${CODEX_MARKETPLACE_NAME}`,
    ]);
  });
});

describe('codex plugin connect', () => {
  it('stages the bundled plugin as a local marketplace and installs it', async () => {
    const codex = fakeCodex();
    const { installRoot, svc } = await service(codex.run);
    const result = await svc.connect();

    expect(result).toMatchObject({ ok: true, state: 'connected' });
    const root = marketplaceDir(installRoot);
    expect(codex.calls).toEqual([
      '--version',
      'plugin list --json',
      `plugin marketplace add ${root}`,
      `plugin add pulse-canvas@${CODEX_MARKETPLACE_NAME}`,
      '--version',
      'plugin list --json',
    ]);
    const marketplace = JSON.parse(await fs.readFile(join(root, '.agents', 'plugins', 'marketplace.json'), 'utf8'));
    expect(marketplace).toMatchObject({
      name: CODEX_MARKETPLACE_NAME,
      plugins: [{ name: 'pulse-canvas', source: { source: 'local', path: './plugins/pulse-canvas' } }],
    });
    const launcher = join(root, 'plugins', 'pulse-canvas', 'bin', 'pulse-canvas-mcp');
    await expect(fs.access(launcher, constants.X_OK)).resolves.toBeUndefined();
    await expect(fs.access(join(root, 'plugins', 'pulse-canvas', 'plugin.json'))).resolves.toBeUndefined();
  });

  it('treats an already registered marketplace as success', async () => {
    const codex = fakeCodex({ marketplaceAdd: { code: 1, stdout: '', stderr: 'marketplace already exists' } });
    const { svc } = await service(codex.run);
    expect((await svc.connect()).ok).toBe(true);
  });

  it('does not touch Codex when it is missing or too old', async () => {
    const codex = fakeCodex({ version: ok('codex-cli 0.120.0') });
    const { installRoot, svc } = await service(codex.run);
    const result = await svc.connect();
    expect(result).toMatchObject({ ok: false, state: 'codex-outdated', steps: [] });
    expect(codex.calls).toEqual(['--version']);
    await expect(fs.access(marketplaceDir(installRoot))).rejects.toThrow();
  });

  it('surfaces a failed plugin install with the command output', async () => {
    const codex = fakeCodex();
    const failing = async (args: string[]) => (args[1] === 'add'
      ? { code: 2, stdout: '', stderr: 'plugin not found in marketplace' }
      : codex.run(args));
    const { svc } = await service(failing);
    const result = await svc.connect();
    expect(result).toMatchObject({ ok: false, state: 'disconnected', error: 'plugin not found in marketplace' });
    expect(result.steps.map(step => step.ok)).toEqual([true, false]);
  });
});

describe('helpers', () => {
  it('compares versions numerically', () => {
    expect(isVersionAtLeast('0.153.0', '0.153.0')).toBe(true);
    expect(isVersionAtLeast('0.1000.0', '0.153.0')).toBe(true);
    expect(isVersionAtLeast('0.99.9', '0.153.0')).toBe(false);
  });

  it('finds the plugin in loosely shaped list output', () => {
    expect(listIncludesPlugin('[{"id":"pulse-canvas@pulse-canvas-app"}]')).toBe(true);
    expect(listIncludesPlugin('{"installed":{"items":[{"name":"pulse-canvas","enabled":false}]}}')).toBe(false);
    expect(listIncludesPlugin('pulse-canvas@pulse-canvas-app  1.0.0  enabled')).toBe(true);
    expect(listIncludesPlugin('pulse-canvas-extra 1.0.0')).toBe(false);
  });
});
