import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { saveRemoteWorkspaceConfig, type RemoteVpsWorkspaceConfig } from './config';

export interface SshExecResult {
  code: number | null;
  stdout: string;
  stderr: string;
}

export type SshRunner = (options: {
  sshHost: string;
  sshPort: number;
  remoteCommand: string;
  stdin?: Buffer | string;
  timeoutMs?: number;
}) => Promise<SshExecResult>;

export interface BootstrapVpsDaemonOptions {
  sshHost: string;
  sshPort?: number;
  remotePort?: number;
  /** Remote installation directory (default: `~/.pulse-vps-daemon`). */
  remoteDir?: string;
  /** Remote SQLite/files data directory (default: `~/.pulse-coder/canvas`). */
  dataDir?: string;
  /** Default working directory for terminals (default: `$HOME`). */
  workDir?: string;
  /** Override local path to `index.cjs` (defaults to bundled/workspace build). */
  daemonBundlePath?: string;
  /** Override local path to `canvas-cli/index.cjs` (optional). */
  cliBundlePath?: string;
  /** Skip syncing pulse-canvas CLI and skills (for isolated unit tests). */
  skipToolingSync?: boolean;
  /** Injectable SSH runner for tests. */
  sshRunner?: SshRunner;
}

export interface BootstrapVpsDaemonResult {
  token: string;
  remotePort: number;
  bundleHash: string;
  uploaded: boolean;
  installedDeps: boolean;
  restarted: boolean;
}

const DEFAULT_REMOTE_DIR = '$HOME/.pulse-vps-daemon';
const DEFAULT_DATA_DIR = '$HOME/.pulse-coder/canvas';

/**
 * Parse `~/.ssh/config` and return concrete `Host` aliases (excluding wildcards).
 * Useful for populating a UI dropdown without asking users to type raw IPs.
 */
export function parseSshConfigHosts(sshConfigPath = join(homedir(), '.ssh', 'config')): string[] {
  let text: string;
  try {
    text = readFileSync(sshConfigPath, 'utf8');
  } catch {
    return [];
  }
  const hosts = new Set<string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!/^Host\s+/i.test(line)) continue;
    const tokens = line.replace(/^Host\s+/i, '').split(/\s+/);
    for (const token of tokens) {
      if (!token || token.includes('*') || token.includes('?') || token.startsWith('!')) continue;
      hosts.add(token);
    }
  }
  return [...hosts];
}

/**
 * Locate the standalone `vps-daemon/index.cjs` bundle shipped with Pulse Canvas
 * (packaged `process.resourcesPath` first, then monorepo dev build).
 */
export function resolveBundledVpsDaemonPath(): string {
  const candidates: string[] = [];
  if (typeof process.resourcesPath === 'string' && process.resourcesPath) {
    candidates.push(join(process.resourcesPath, 'vps-daemon', 'index.cjs'));
  }
  candidates.push(
    resolve(__dirname, '..', '..', '..', '..', 'vps-daemon', 'dist', 'index.cjs'),
    resolve(process.cwd(), 'apps', 'vps-daemon', 'dist', 'index.cjs'),
    resolve(process.cwd(), '..', 'vps-daemon', 'dist', 'index.cjs'),
  );
  const found = candidates.find((p) => existsSync(p));
  if (!found) {
    throw new Error(
      'Bundled vps-daemon/index.cjs was not found. Run `pnpm --filter @pulse-coder/vps-daemon build` first.',
    );
  }
  return found;
}

export const defaultSshRunner: SshRunner = async ({
  sshHost,
  sshPort,
  remoteCommand,
  stdin,
  timeoutMs = 120_000,
}) => {
  const args = [
    '-o',
    'BatchMode=yes',
    '-o',
    'ConnectTimeout=10',
    '-p',
    String(sshPort),
    sshHost,
    remoteCommand,
  ];
  return await new Promise<SshExecResult>((resolveExec, rejectExec) => {
    const child = spawn('ssh', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        child.kill('SIGTERM');
      } catch {
        /* ignore */
      }
      rejectExec(new Error(`SSH command timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    timer.unref();

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectExec(err);
    });
    child.stdout.on('data', (c: Buffer) => stdoutChunks.push(c));
    child.stderr.on('data', (c: Buffer) => stderrChunks.push(c));
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolveExec({
        code,
        stdout: Buffer.concat(stdoutChunks).toString('utf8'),
        stderr: Buffer.concat(stderrChunks).toString('utf8'),
      });
    });

    if (stdin !== undefined) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
  });
};

function assertOk(result: SshExecResult, step: string): string {
  if (result.code !== 0) {
    const detail = (result.stderr || result.stdout).trim();
    throw new Error(`VPS bootstrap failed at "${step}" (exit ${result.code}): ${detail}`);
  }
  return result.stdout.trim();
}

/**
 * Automatically push, install native deps (first time only), generate a 600-mode
 * Bearer token, and start `pulse-vps-daemon` on a remote VPS over SSH — similar
 * to VS Code Remote-SSH, requiring zero manual server setup and no public npm publish.
 */
export async function bootstrapRemoteVpsDaemon(
  options: BootstrapVpsDaemonOptions,
): Promise<BootstrapVpsDaemonResult> {
  const sshPort = options.sshPort ?? 22;
  const remotePort = options.remotePort ?? 4770;
  const remoteDir = options.remoteDir ?? DEFAULT_REMOTE_DIR;
  const dataDir = options.dataDir ?? DEFAULT_DATA_DIR;
  const workDir = options.workDir ?? '$HOME';
  const run = options.sshRunner ?? defaultSshRunner;

  const bundlePath = options.daemonBundlePath ?? resolveBundledVpsDaemonPath();
  const bundleBytes = readFileSync(bundlePath);
  const bundleHash = createHash('sha256').update(bundleBytes).digest('hex').slice(0, 16);

  // 1. Probe remote Node, existing bundle hash, native deps, and health.
  const probeScript = [
    'set -e',
    `mkdir -p "${remoteDir}"`,
    'NODE_V=$(node -v 2>/dev/null || true)',
    `HASH=$(cat "${remoteDir}/bundle.sha" 2>/dev/null || true)`,
    `DEPS=$(test -d "${remoteDir}/node_modules/better-sqlite3" && test -d "${remoteDir}/node_modules/node-pty" && echo ok || echo missing)`,
    `HEALTH=$(curl -sf "http://127.0.0.1:${remotePort}/health" >/dev/null 2>&1 && echo up || echo down)`,
    'printf "%s\\n%s\\n%s\\n%s\\n" "$NODE_V" "$HASH" "$DEPS" "$HEALTH"',
    '',
  ].join('\n');

  const probeOut = assertOk(
    await run({ sshHost: options.sshHost, sshPort, remoteCommand: 'sh -s', stdin: probeScript }),
    'probe',
  );
  const [nodeVersion = '', remoteHash = '', depsState = 'missing', healthState = 'down'] =
    probeOut.split(/\r?\n/);

  const majorMatch = /^v(\d+)/.exec(nodeVersion.trim());
  if (!majorMatch || Number(majorMatch[1]) < 20) {
    throw new Error(`Remote VPS requires Node.js >= 20 (found "${nodeVersion.trim() || 'none'}").`);
  }

  let uploaded = false;
  let installedDeps = false;
  let restarted = false;

  // 2. Push the standalone index.cjs bundle over SSH stdin when missing or outdated.
  if (remoteHash.trim() !== bundleHash) {
    assertOk(
      await run({
        sshHost: options.sshHost,
        sshPort,
        remoteCommand: `mkdir -p "${remoteDir}" && cat > "${remoteDir}/index.cjs.tmp" && mv "${remoteDir}/index.cjs.tmp" "${remoteDir}/index.cjs" && printf "%s" "${bundleHash}" > "${remoteDir}/bundle.sha"`,
        stdin: bundleBytes,
      }),
      'upload-bundle',
    );
    uploaded = true;
  }

  // 3. Install native deps (better-sqlite3, node-pty) once on the VPS architecture.
  if (depsState.trim() !== 'ok') {
    const installScript = [
      'set -e',
      `cd "${remoteDir}"`,
      `printf '{"name":"pulse-vps-runtime","private":true}\\n' > package.json`,
      'npm install --omit=dev --no-audit --no-fund better-sqlite3@12.11.1 node-pty@1.1.0',
      '',
    ].join('\n');
    const installResult = await run({
      sshHost: options.sshHost,
      sshPort,
      remoteCommand: 'sh -s',
      stdin: installScript,
      timeoutMs: 300_000,
    });
    if (installResult.code !== 0) {
      const detail = (installResult.stderr || installResult.stdout).trim();
      const hint = /not found:\s*(make|g\+\+|cc)/i.test(detail)
        ? ' (Hint: install build tools on your VPS, e.g. `apt-get update && apt-get install -y build-essential`)'
        : '';
      throw new Error(
        `VPS bootstrap failed at "install-native-deps" (exit ${installResult.code})${hint}: ${detail}`,
      );
    }
    installedDeps = true;
  }

  // 4. Ensure a 600-permission random Bearer token exists on the VPS.
  const tokenScript = [
    'set -e',
    `TOKEN_FILE="${remoteDir}/token"`,
    'if [ ! -s "$TOKEN_FILE" ]; then',
    '  node -e "process.stdout.write(require(\'crypto\').randomBytes(24).toString(\'hex\'))" > "$TOKEN_FILE"',
    '  chmod 600 "$TOKEN_FILE"',
    'fi',
    'cat "$TOKEN_FILE"',
    '',
  ].join('\n');
  const token = assertOk(
    await run({ sshHost: options.sshHost, sshPort, remoteCommand: 'sh -s', stdin: tokenScript }),
    'ensure-token',
  );

  // 5. Start or restart the daemon on 127.0.0.1:<remotePort> if newly uploaded or not running.
  if (uploaded || installedDeps || healthState.trim() !== 'up') {
    const startScript = [
      'set -e',
      `cd "${remoteDir}"`,
      'if [ -f daemon.pid ]; then',
      '  kill "$(cat daemon.pid)" 2>/dev/null || true',
      '  sleep 0.3',
      'fi',
      'TOKEN="$(cat token)"',
      `PULSE_VPS_HOST="127.0.0.1" PULSE_VPS_PORT="${remotePort}" PULSE_VPS_TOKEN="$TOKEN" PULSE_VPS_DATA_DIR="${dataDir}" PULSE_VPS_WORKDIR="${workDir}" nohup node index.cjs > daemon.log 2>&1 < /dev/null &`,
      'echo $! > daemon.pid',
      'for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do',
      `  if curl -sf "http://127.0.0.1:${remotePort}/health" >/dev/null 2>&1; then exit 0; fi`,
      '  sleep 0.3',
      'done',
      'tail -n 30 daemon.log >&2',
      'exit 1',
      '',
    ].join('\n');
    assertOk(
      await run({
        sshHost: options.sshHost,
        sshPort,
        remoteCommand: 'sh -s',
        stdin: startScript,
        timeoutMs: 30_000,
      }),
      'start-daemon',
    );
    restarted = true;
  }

  if (!options.skipToolingSync) {
    const { syncRemoteCanvasTooling } = await import('./ssh-tooling');
    await syncRemoteCanvasTooling({
      sshHost: options.sshHost,
      sshPort,
      remoteDir,
      dataDir,
      run,
      ...(options.cliBundlePath ? { cliBundlePath: options.cliBundlePath } : {}),
    }).catch(() => undefined);
  }

  return { token, remotePort, bundleHash, uploaded, installedDeps, restarted };
}

/**
 * Convenience helper for one-click VPS workspace setup:
 * bootstraps the daemon over SSH and saves the workspace entry into `remote-workspaces.json`.
 */
export async function bootstrapAndSaveVpsWorkspace(
  workspaceId: string,
  options: BootstrapVpsDaemonOptions & {
    cwd?: string;
    storage?: 'vps' | 'local';
    runtime?: 'vps' | 'local';
    storeDir?: string;
  },
): Promise<{ config: RemoteVpsWorkspaceConfig; bootstrap: BootstrapVpsDaemonResult }> {
  const bootstrap = await bootstrapRemoteVpsDaemon(options);
  const config: RemoteVpsWorkspaceConfig = {
    kind: 'vps',
    sshHost: options.sshHost,
    ...(options.sshPort ? { sshPort: options.sshPort } : {}),
    remotePort: bootstrap.remotePort,
    token: bootstrap.token,
    remoteWorkspaceId: workspaceId,
    ...(options.cwd ? { cwd: options.cwd } : {}),
    storage: options.storage ?? 'vps',
    runtime: options.runtime ?? 'vps',
    autoBootstrap: true,
  };
  saveRemoteWorkspaceConfig(workspaceId, config, options.storeDir);
  return { config, bootstrap };
}
