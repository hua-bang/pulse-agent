import { spawn } from 'child_process';
import { cpus } from 'os';
import { buildSharedDependencyEnv } from './dependency-env.js';
import type { WorktreeRecordView } from './manager.js';

export type WorktreeRunBackend = 'host' | 'docker';

export interface WorktreeRunDockerOptions {
  image?: string;
  user?: string;
  network?: string;
  env?: Record<string, string>;
  extraArgs?: string[];
}

export interface WorktreeRunInput {
  backend?: WorktreeRunBackend;
  command?: string;
  args?: string[];
  shell?: string;
  timeoutMs?: number;
  env?: Record<string, string>;
  docker?: WorktreeRunDockerOptions;
}

export interface WorktreeRunResult {
  ok: boolean;
  backend: WorktreeRunBackend;
  cwd: string;
  command: string;
  args: string[];
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
}

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;
const MAX_TIMEOUT_MS = 60 * 60 * 1000;
const MAX_OUTPUT_BYTES = 256 * 1024;
const DEFAULT_DOCKER_IMAGE = 'node:22-bookworm';
const WORKSPACE_MOUNT_PATH = '/workspace';

export async function runWorktreeCommand(
  worktree: WorktreeRecordView,
  input: WorktreeRunInput,
): Promise<WorktreeRunResult> {
  const backend = normalizeBackend(input.backend);
  const timeoutMs = normalizeTimeout(input.timeoutMs);
  const commandSpec = buildCommandSpec(worktree, backend, input);
  const startedAt = Date.now();

  try {
    const result = await runProcess(commandSpec, timeoutMs);
    const durationMs = Date.now() - startedAt;
    return {
      ok: result.exitCode === 0 && !result.timedOut,
      backend,
      cwd: commandSpec.cwd,
      command: commandSpec.command,
      args: commandSpec.args,
      exitCode: result.exitCode,
      signal: result.signal,
      timedOut: result.timedOut,
      durationMs,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (err) {
    const durationMs = Date.now() - startedAt;
    return {
      ok: false,
      backend,
      cwd: commandSpec.cwd,
      command: commandSpec.command,
      args: commandSpec.args,
      exitCode: null,
      signal: null,
      timedOut: false,
      durationMs,
      stdout: '',
      stderr: '',
      error: formatError(err),
    };
  }
}

interface CommandSpec {
  command: string;
  args: string[];
  cwd: string;
  env?: NodeJS.ProcessEnv;
}

interface ProcessResult {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
}

function buildCommandSpec(
  worktree: WorktreeRecordView,
  backend: WorktreeRunBackend,
  input: WorktreeRunInput,
): CommandSpec {
  if (backend === 'docker') {
    return buildDockerCommand(worktree, input);
  }

  if (input.shell?.trim()) {
    return {
      command: '/bin/bash',
      args: ['-lc', input.shell.trim()],
      cwd: worktree.worktreePath,
      env: buildHostEnv(input.env),
    };
  }

  const command = input.command?.trim();
  if (!command) {
    throw new Error('command or shell is required');
  }

  return {
    command,
    args: normalizeArgs(input.args),
    cwd: worktree.worktreePath,
    env: { ...process.env, ...normalizeEnv(input.env) },
  };
}

function buildDockerCommand(worktree: WorktreeRecordView, input: WorktreeRunInput): CommandSpec {
  const image = input.docker?.image?.trim() || process.env.PULSE_CODER_DOCKER_IMAGE?.trim() || DEFAULT_DOCKER_IMAGE;
  const dockerArgs = [
    'run',
    '--rm',
    '-v',
    `${worktree.worktreePath}:${WORKSPACE_MOUNT_PATH}`,
    '-w',
    WORKSPACE_MOUNT_PATH,
  ];

  const user = input.docker?.user?.trim() || defaultDockerUser();
  if (user) {
    dockerArgs.push('--user', user);
  }

  const network = input.docker?.network?.trim() || process.env.PULSE_CODER_DOCKER_NETWORK?.trim();
  if (network) {
    dockerArgs.push('--network', network);
  }

  for (const [key, value] of Object.entries(normalizeEnv(input.docker?.env))) {
    dockerArgs.push('-e', `${key}=${value}`);
  }

  dockerArgs.push(...normalizeArgs(input.docker?.extraArgs));
  dockerArgs.push(image);

  if (input.shell?.trim()) {
    dockerArgs.push('/bin/bash', '-lc', input.shell.trim());
  } else {
    const command = input.command?.trim();
    if (!command) {
      throw new Error('command or shell is required');
    }
    dockerArgs.push(command, ...normalizeArgs(input.args));
  }

  return {
    command: 'docker',
    args: dockerArgs,
    cwd: worktree.repoRoot,
    env: process.env,
  };
}

function runProcess(spec: CommandSpec, timeoutMs: number): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(spec.command, spec.args, {
      cwd: spec.cwd,
      env: spec.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let settled = false;
    let timedOut = false;

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!settled) {
          child.kill('SIGKILL');
        }
      }, 5000).unref();
    }, timeoutMs);
    timeout.unref();

    child.stdout?.on('data', (chunk) => {
      stdout = appendOutput(stdout, chunk);
    });

    child.stderr?.on('data', (chunk) => {
      stderr = appendOutput(stderr, chunk);
    });

    child.on('error', (err) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });

    child.on('close', (exitCode, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve({ exitCode, signal, timedOut, stdout, stderr });
    });
  });
}

function normalizeBackend(value?: WorktreeRunBackend): WorktreeRunBackend {
  return value === 'docker' ? 'docker' : 'host';
}

function normalizeTimeout(value?: number): number {
  if (!Number.isFinite(value) || !value || value <= 0) {
    return DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.floor(value), MAX_TIMEOUT_MS);
}

function buildHostEnv(inputEnv?: Record<string, string>): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...buildSharedDependencyEnv(process.env),
    ...normalizeEnv(inputEnv),
  };
}

function normalizeArgs(value?: string[]): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value.filter((item): item is string => typeof item === 'string');
}

function normalizeEnv(value?: Record<string, string>): Record<string, string> {
  if (!value || typeof value !== 'object') {
    return {};
  }

  const env: Record<string, string> = {};
  for (const [key, rawValue] of Object.entries(value)) {
    if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) && typeof rawValue === 'string') {
      env[key] = rawValue;
    }
  }
  return env;
}

function defaultDockerUser(): string | undefined {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  const gid = typeof process.getgid === 'function' ? process.getgid() : undefined;
  if (uid === undefined || gid === undefined) {
    return undefined;
  }
  return `${uid}:${gid}`;
}

function appendOutput(current: string, chunk: Buffer): string {
  const next = current + chunk.toString('utf8');
  if (Buffer.byteLength(next, 'utf8') <= MAX_OUTPUT_BYTES) {
    return next;
  }

  const keepBytes = Math.max(MAX_OUTPUT_BYTES - 128, Math.floor(MAX_OUTPUT_BYTES / Math.max(cpus().length, 1)));
  const truncated = Buffer.from(next, 'utf8').subarray(-keepBytes).toString('utf8');
  return `[output truncated to last ${keepBytes} bytes]\n${truncated}`;
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    return err.message;
  }
  return String(err);
}
