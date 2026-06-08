import { app, ipcMain } from 'electron';
import { execFile } from 'child_process';
import { existsSync, promises as fs } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const SKILL_NAME = 'pulse-canvas';
const LEGACY_SKILL_NAMES = ['canvas'];
const CLI_PACKAGE = '@pulse-coder/canvas-cli';

const SKILL_PARENT_DIRS = [
  join(homedir(), '.pulse-coder', 'skills'),
  join(homedir(), '.claude', 'skills'),
  join(homedir(), '.codex', 'skills'),
];

const GLOBAL_SKILL_DIRS = SKILL_PARENT_DIRS.map((dir) => join(dir, SKILL_NAME));

const LEGACY_SKILL_DIRS = SKILL_PARENT_DIRS.flatMap((dir) =>
  LEGACY_SKILL_NAMES.map((name) => join(dir, name)),
);

const MANUAL_COMMAND = `pnpm --filter ${CLI_PACKAGE} build && pnpm -C packages/canvas-cli link --global`;

// Fallback skill body used when the canonical source under
// packages/canvas-cli/skills cannot be located (e.g. a packaged build with
// no monorepo on disk). Kept intentionally minimal — the live source is the
// source of truth, this only guards against a missing checkout.
const FALLBACK_SKILL_CONTENT = `---
name: pulse-canvas
description: Operate Pulse Canvas workspaces — read user-curated context, write results, create nodes
version: 1.0.0
---

# Pulse Canvas

Interact with canvas workspaces via the \`pulse-canvas\` CLI. The canvas is a shared workspace between humans and agents.

The current workspace ID is available via \`$PULSE_CANVAS_WORKSPACE_ID\` environment variable (auto-set by canvas). All \`node\` and \`context\` commands use it automatically — no need to pass workspace ID explicitly.

## Core Commands

### Read workspace context (start here)
\`\`\`bash
pulse-canvas context --format json
\`\`\`

### List nodes
\`\`\`bash
pulse-canvas node list --format json
\`\`\`

### Read a node
\`\`\`bash
pulse-canvas node read <nodeId> --format json
\`\`\`

### Write to a node
\`\`\`bash
pulse-canvas node write <nodeId> --content "..."
\`\`\`

## Usage Principles
- Before starting a task, run \`context\` to understand the user's canvas layout and intent
- After completing work, write results back to the canvas for the user to review
`;

export interface SkillTargetResult {
  path: string;
  ok: boolean;
  error?: string;
}

export interface CliInstallResult {
  ok: boolean;
  error?: string;
}

export interface SkillsInstallResult {
  ok: boolean;
  skillsInstalled: boolean;
  results: SkillTargetResult[];
  cliInstalled: boolean;
  manualCommand: string | null;
  cliError: string | null;
}

/**
 * Walk up from a few candidate starting points looking for the monorepo
 * marker (`pnpm-workspace.yaml`). In `electron-vite dev` the main bundle runs
 * from `out/main`, so we climb out of the app directory to reach the repo
 * root. Returns null when no checkout is on disk (e.g. a packaged build).
 */
function findRepoRoot(): string | null {
  const starts = [
    (() => {
      try {
        return app?.getAppPath?.();
      } catch {
        return undefined;
      }
    })(),
    __dirname,
    process.cwd(),
  ].filter((p): p is string => typeof p === 'string' && p.length > 0);

  for (const start of starts) {
    let dir = start;
    for (let i = 0; i < 10; i++) {
      if (existsSync(join(dir, 'pnpm-workspace.yaml'))) return dir;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return null;
}

/** Rewrite the front-matter `name:` so the installed skill keeps the
 *  `pulse-canvas` convention even though the source dir is named `canvas`. */
function rewriteSkillName(content: string, name: string): string {
  return content.replace(/^name:.*$/m, `name: ${name}`);
}

/** Read the latest skill body from the canvas-cli package, falling back to the
 *  bundled minimal copy when the source checkout is unavailable. */
async function loadLatestSkillContent(): Promise<string> {
  const root = findRepoRoot();
  if (root) {
    const src = join(root, 'packages', 'canvas-cli', 'skills', 'canvas', 'SKILL.md');
    try {
      const raw = await fs.readFile(src, 'utf-8');
      if (raw.trim()) return rewriteSkillName(raw, SKILL_NAME);
    } catch {
      // fall through to the bundled fallback
    }
  }
  return FALLBACK_SKILL_CONTENT;
}

async function installSingleTarget(dir: string, content: string): Promise<SkillTargetResult> {
  const targetPath = join(dir, 'SKILL.md');
  try {
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(targetPath, content, 'utf-8');
    return { path: targetPath, ok: true };
  } catch (err) {
    return { path: targetPath, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Build the canvas CLI and link it globally so agents can call `pulse-canvas`.
 * Best-effort and dev-only by nature: it requires the monorepo source and a
 * `pnpm` on PATH (both present when launched via `pnpm dev`). On any failure
 * we surface the error and let the caller fall back to the manual command.
 */
async function installCanvasCli(): Promise<CliInstallResult> {
  const root = findRepoRoot();
  if (!root) {
    return {
      ok: false,
      error:
        'Could not locate the monorepo root (pnpm-workspace.yaml not found). CLI auto-install only works from a source checkout.',
    };
  }
  const pkgDir = join(root, 'packages', 'canvas-cli');
  const baseOpts = { env: process.env, maxBuffer: 16 * 1024 * 1024 } as const;
  try {
    // `--filter` works for running the build script across the workspace, but
    // `pnpm link` rejects filter/recursive flags — link must run *inside* the
    // package directory instead.
    await execFileAsync('pnpm', ['--filter', CLI_PACKAGE, 'build'], { ...baseOpts, cwd: root });
    await execFileAsync('pnpm', ['link', '--global'], { ...baseOpts, cwd: pkgDir });
    return { ok: true };
  } catch (err: any) {
    const stderr = typeof err?.stderr === 'string' ? err.stderr : err?.stderr?.toString?.();
    const msg = (stderr || err?.message || String(err)).trim();
    return { ok: false, error: msg };
  }
}

/**
 * Install the latest canvas skill into the global skill dirs and (best-effort)
 * build + link the canvas CLI. Shared by the `skills:install` IPC handler and
 * the experimental-flag auto-install trigger.
 */
export async function runInstall(): Promise<SkillsInstallResult> {
  const content = await loadLatestSkillContent();
  const results = await Promise.all(GLOBAL_SKILL_DIRS.map((dir) => installSingleTarget(dir, content)));
  const skillsInstalled = results.every((r) => r.ok);

  const cli = await installCanvasCli();

  return {
    ok: skillsInstalled && cli.ok,
    skillsInstalled,
    results,
    cliInstalled: cli.ok,
    cliError: cli.ok ? null : cli.error ?? null,
    manualCommand: cli.ok ? null : MANUAL_COMMAND,
  };
}

async function checkSingleTarget(dir: string): Promise<SkillTargetResult> {
  const targetPath = join(dir, 'SKILL.md');
  try {
    await fs.access(targetPath);
    return { path: targetPath, ok: true };
  } catch {
    return { path: targetPath, ok: false };
  }
}

async function checkLegacyDir(dir: string): Promise<{ dir: string; exists: boolean }> {
  try {
    await fs.access(dir);
    return { dir, exists: true };
  } catch {
    return { dir, exists: false };
  }
}

async function removeLegacyDir(dir: string): Promise<SkillTargetResult> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
    return { path: dir, ok: true };
  } catch (err) {
    return { path: dir, ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export function setupSkillInstallerIpc(): void {
  ipcMain.handle('skills:install', async () => runInstall());

  ipcMain.handle('skills:status', async () => {
    const [results, legacy] = await Promise.all([
      Promise.all(GLOBAL_SKILL_DIRS.map(checkSingleTarget)),
      Promise.all(LEGACY_SKILL_DIRS.map(checkLegacyDir)),
    ]);
    return {
      installed: results.every((r) => r.ok),
      results,
      legacyDirs: legacy.filter((l) => l.exists).map((l) => l.dir),
    };
  });

  ipcMain.handle('skills:cleanup-legacy', async () => {
    const present = (
      await Promise.all(LEGACY_SKILL_DIRS.map(checkLegacyDir))
    )
      .filter((l) => l.exists)
      .map((l) => l.dir);
    const results = await Promise.all(present.map(removeLegacyDir));
    return {
      ok: results.every((r) => r.ok),
      results,
    };
  });
}
