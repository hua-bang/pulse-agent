/**
 * PATH repair for child processes spawned by the app.
 *
 * A GUI-launched Electron app does not inherit the user's login-shell
 * environment: on macOS, opening from Finder/Dock gives roughly
 * `/usr/bin:/bin:/usr/sbin:/sbin`, so Homebrew, nvm, pnpm, cargo and anything
 * installed per-user is simply absent. Everything the app spawns inherits
 * that: the agent's `bash` tool (the engine spawns with no `env`, so it takes
 * `process.env` verbatim), MCP stdio servers, and the bundled CLI wrapper.
 * The symptom is always the same and never mentions PATH — `lark-cli: command
 * not found` from a chat that works fine in a real terminal.
 *
 * Two repairs, cheapest first:
 *   - `augmentProcessPath()` appends the well-known per-user bin dirs. Sync,
 *     no subprocess, safe to run before anything else.
 *   - `applyLoginShellPath()` asks the user's actual login shell what its PATH
 *     is, which is the only way to catch version managers and hand-rolled
 *     entries. Async and best-effort — it runs the user's rc files, so it is
 *     bounded by a timeout and every failure mode keeps the existing PATH.
 */

import { execFile } from 'child_process';
import { delimiter, join } from 'path';
import { homedir, platform } from 'os';
import { existsSync, readdirSync } from 'fs';

const LOGIN_SHELL_TIMEOUT_MS = 3000;

export const uniquePath = (parts: string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const part of parts) {
    if (!part || seen.has(part)) continue;
    seen.add(part);
    result.push(part);
  }
  return result;
};

/**
 * Per-user bin dirs that a login shell would normally add. `~/.pulse-coder/bin`
 * is this app's own installed CLI wrapper location, so a bundled `pulse-canvas`
 * resolves even when nothing else was ever set up.
 */
export const commonPosixBinDirs = (): string[] => {
  const home = homedir();
  return [
    join(home, '.pulse-coder', 'bin'),
    join(home, '.local', 'bin'),
    join(home, 'bin'),
    join(home, '.npm-global', 'bin'),
    join(home, '.yarn', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.cargo', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.asdf', 'shims'),
    ...discoverNodeVersionManagerBinDirs(home),
    join(home, 'Library', 'pnpm'),
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
  ];
};

export const discoverNodeVersionManagerBinDirs = (home: string): string[] => [
  ...listVersionedBinDirs(join(home, '.nvm', 'versions', 'node'), ['bin']),
  ...listVersionedBinDirs(join(home, '.fnm', 'node-versions'), ['installation/bin', 'bin']),
];

function listVersionedBinDirs(root: string, suffixes: string[]): string[] {
  let entries: string[];
  try {
    entries = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort(compareVersionDirDesc);
  } catch {
    return [];
  }

  const dirs: string[] = [];
  for (const entry of entries) {
    for (const suffix of suffixes) {
      const dir = join(root, entry, suffix);
      if (existsSync(dir)) dirs.push(dir);
    }
  }
  return dirs;
}

function compareVersionDirDesc(a: string, b: string): number {
  const left = parseVersionDir(a);
  const right = parseVersionDir(b);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const diff = (right[index] ?? 0) - (left[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return b.localeCompare(a);
}

function parseVersionDir(value: string): number[] {
  const match = value.match(/\d+(?:\.\d+)*/);
  return match ? match[0].split('.').map((part) => Number(part) || 0) : [];
}

/** Existing PATH first, so a user-configured entry always wins a conflict. */
export const mergePath = (existing: string | undefined, extra: string[]): string =>
  uniquePath([...(existing ? existing.split(delimiter) : []), ...extra]).join(delimiter);

/** Appends the well-known bin dirs to `process.env.PATH`. No-op on Windows. */
export function augmentProcessPath(): void {
  if (platform() === 'win32') return;
  process.env.PATH = mergePath(process.env.PATH, commonPosixBinDirs());
}

/**
 * The PATH an interactive login shell would produce, or null when it cannot
 * be determined. Never throws.
 */
export function resolveLoginShellPath(): Promise<string | null> {
  if (platform() === 'win32') return Promise.resolve(null);
  const shell = process.env.SHELL;
  if (!shell) return Promise.resolve(null);

  return new Promise((resolve) => {
    // `-ilc` so rc files run (that is where version managers export PATH).
    // A marker keeps rc-file chatter from being mistaken for the value.
    execFile(
      shell,
      ['-ilc', 'printf "__PULSE_PATH__:%s\\n" "$PATH"'],
      { timeout: LOGIN_SHELL_TIMEOUT_MS, encoding: 'utf-8' },
      (error, stdout) => {
        if (error && !stdout) return resolve(null);
        for (const line of String(stdout).split(/\r?\n/)) {
          const trimmed = line.trim();
          if (trimmed.startsWith('__PULSE_PATH__:')) {
            const value = trimmed.slice('__PULSE_PATH__:'.length).trim();
            return resolve(value || null);
          }
        }
        resolve(null);
      },
    );
  });
}

/**
 * Merges the login shell's PATH into `process.env.PATH`. Best-effort: a shell
 * that is missing, slow, or broken leaves the process PATH exactly as it was.
 */
export async function applyLoginShellPath(): Promise<boolean> {
  const shellPath = await resolveLoginShellPath();
  if (!shellPath) return false;
  process.env.PATH = mergePath(process.env.PATH, shellPath.split(delimiter));
  return true;
}
