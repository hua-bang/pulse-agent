import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { join } from 'path';
import type {
  CodexPluginConnectResult,
  CodexPluginConnectStep,
  CodexPluginStatus,
} from '../../shared/settings-config';

/**
 * Connects the bundled `pulse-canvas` agent plugin to the user's Codex CLI.
 *
 * Only ever runs on an explicit Settings action (never at startup — the old
 * MCP auto-registration that silently edited Codex config was removed). The
 * app copies the plugin it ships into a stable local marketplace under the
 * tooling root, so the plugin always matches the installed app, works
 * offline, and survives the app bundle moving:
 *
 *   <installRoot>/tooling/codex-marketplace/
 *     .agents/plugins/marketplace.json
 *     plugins/pulse-canvas/...
 *
 * then runs `codex plugin marketplace add <dir>` and
 * `codex plugin add pulse-canvas@<marketplace>`.
 */

export const CODEX_PLUGIN_NAME = 'pulse-canvas';
export const CODEX_MARKETPLACE_NAME = 'pulse-canvas-app';
/** `codex plugin add` first shipped in Codex 0.153.0. */
export const MIN_CODEX_VERSION = '0.153.0';

const COMMAND_TIMEOUT_MS = 60_000;

export interface CodexCommandResult {
  code: number | null;
  stdout: string;
  stderr: string;
  /** Set when the executable itself could not be started. */
  missing?: boolean;
}

export type CodexRunner = (args: string[]) => Promise<CodexCommandResult>;

export interface CodexPluginOptions {
  /** Plugin directory shipped with the app (contains plugin.json). */
  pluginSource: string;
  /** ~/.pulse-coder, the agent tooling install root. */
  installRoot: string;
  platform?: NodeJS.Platform;
  run?: CodexRunner;
}

/** Runs `codex` from the PATH the app hydrated from the login shell at startup. */
export const runCodex: CodexRunner = args => new Promise(resolve => {
  const options = { timeout: COMMAND_TIMEOUT_MS, env: process.env, maxBuffer: 4 * 1024 * 1024 };
  execFile('codex', args, options, (error, stdout, stderr) => {
    // execFile reports exit status as a numeric `code`, spawn failures as a string.
    const code = (error as { code?: unknown } | null)?.code;
    resolve({
      code: !error ? 0 : typeof code === 'number' ? code : null,
      stdout: String(stdout ?? ''),
      stderr: String(stderr || error?.message || ''),
      missing: code === 'ENOENT',
    });
  });
});

export function marketplaceDir(installRoot: string): string {
  return join(installRoot, 'tooling', 'codex-marketplace');
}

export function parseCodexVersion(output: string): string | null {
  return output.match(/(\d+)\.(\d+)\.(\d+)/)?.[0] ?? null;
}

export function isVersionAtLeast(version: string, minimum: string): boolean {
  const a = version.split('.').map(Number);
  const b = minimum.split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0);
  }
  return true;
}

/**
 * `codex plugin list --json` shapes are not documented as stable, so look
 * for any object naming our plugin rather than one exact path; a plugin
 * explicitly reported as disabled does not count as connected.
 */
export function listIncludesPlugin(output: string, name = CODEX_PLUGIN_NAME): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(output);
  } catch {
    return new RegExp(`(^|[^\\w-])${name}([@\\s]|$)`, 'm').test(output);
  }
  const visit = (value: unknown): boolean => {
    if (Array.isArray(value)) return value.some(visit);
    if (!value || typeof value !== 'object') return false;
    const record = value as Record<string, unknown>;
    const id = record.name ?? record.id ?? record.plugin;
    if (typeof id === 'string' && (id === name || id.startsWith(`${name}@`))) {
      return record.enabled !== false;
    }
    return Object.values(record).some(visit);
  };
  return visit(parsed);
}

export function manualCommands(installRoot: string): string[] {
  return [
    `codex plugin marketplace add "${marketplaceDir(installRoot)}"`,
    `codex plugin add ${CODEX_PLUGIN_NAME}@${CODEX_MARKETPLACE_NAME}`,
  ];
}

const output = (result: CodexCommandResult): string =>
  [result.stdout.trim(), result.stderr.trim()].filter(Boolean).join('\n');

export function createCodexPluginService(options: CodexPluginOptions) {
  const run = options.run ?? runCodex;
  const platform = options.platform ?? process.platform;
  const base = (): Omit<CodexPluginStatus, 'state'> => ({
    codexVersion: null,
    minCodexVersion: MIN_CODEX_VERSION,
    manualCommands: manualCommands(options.installRoot),
  });

  async function probe(): Promise<CodexPluginStatus> {
    // The plugin's launcher is a POSIX shell script.
    if (platform === 'win32') return { ...base(), state: 'unsupported-platform' };
    const version = await run(['--version']);
    if (version.missing) return { ...base(), state: 'codex-missing' };
    const codexVersion = parseCodexVersion(output(version));
    if (version.code !== 0 || !codexVersion) {
      return { ...base(), state: 'error', error: output(version) || 'codex --version failed' };
    }
    if (!isVersionAtLeast(codexVersion, MIN_CODEX_VERSION)) {
      return { ...base(), codexVersion, state: 'codex-outdated' };
    }
    const list = await run(['plugin', 'list', '--json']);
    if (list.code !== 0) {
      return { ...base(), codexVersion, state: 'error', error: output(list) || 'codex plugin list failed' };
    }
    return {
      ...base(),
      codexVersion,
      state: listIncludesPlugin(list.stdout) ? 'connected' : 'disconnected',
    };
  }

  async function stageMarketplace(): Promise<void> {
    await fs.access(join(options.pluginSource, 'plugin.json'));
    const root = marketplaceDir(options.installRoot);
    const pluginDir = join(root, 'plugins', CODEX_PLUGIN_NAME);
    await fs.rm(pluginDir, { recursive: true, force: true });
    await fs.mkdir(join(root, 'plugins'), { recursive: true });
    await fs.cp(options.pluginSource, pluginDir, { recursive: true });
    // Packaging may drop the executable bit; Codex execs this directly.
    await fs.chmod(join(pluginDir, 'bin', 'pulse-canvas-mcp'), 0o755);
    await fs.mkdir(join(root, '.agents', 'plugins'), { recursive: true });
    await fs.writeFile(join(root, '.agents', 'plugins', 'marketplace.json'), `${JSON.stringify({
      name: CODEX_MARKETPLACE_NAME,
      plugins: [{
        name: CODEX_PLUGIN_NAME,
        source: { source: 'local', path: `./plugins/${CODEX_PLUGIN_NAME}` },
        policy: { installation: 'AVAILABLE' },
        category: 'Productivity',
      }],
    }, null, 2)}\n`, 'utf8');
  }

  async function connect(): Promise<CodexPluginConnectResult> {
    const steps: CodexPluginConnectStep[] = [];
    const before = await probe();
    if (before.state !== 'connected' && before.state !== 'disconnected') {
      return { ...before, ok: false, steps };
    }
    try {
      await stageMarketplace();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ...before, state: 'plugin-missing', error: message, ok: false, steps };
    }

    const root = marketplaceDir(options.installRoot);
    const addMarketplace = await run(['plugin', 'marketplace', 'add', root]);
    // Re-adding a registered marketplace is fine; the copy above refreshed it.
    const marketplaceOk = addMarketplace.code === 0 || /already/i.test(output(addMarketplace));
    steps.push({ command: `codex plugin marketplace add ${root}`, ok: marketplaceOk, output: output(addMarketplace) });

    if (marketplaceOk) {
      const pluginId = `${CODEX_PLUGIN_NAME}@${CODEX_MARKETPLACE_NAME}`;
      const addPlugin = await run(['plugin', 'add', pluginId]);
      const pluginOk = addPlugin.code === 0 || /already/i.test(output(addPlugin));
      steps.push({ command: `codex plugin add ${pluginId}`, ok: pluginOk, output: output(addPlugin) });
    }

    const after = await probe();
    const ok = after.state === 'connected';
    const failed = steps.find(step => !step.ok);
    return {
      ...after,
      ...(ok || after.error ? {} : { error: failed?.output || 'Codex did not list the plugin after installing it.' }),
      ok,
      steps,
    };
  }

  return { status: probe, connect };
}
