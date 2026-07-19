import { app, ipcMain } from 'electron';
import { existsSync, promises as fs } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

import {
  createAgentToolingManager,
  type AgentToolingManager,
  type AgentToolingInstallResult,
} from './agent-tooling-manager';

const SKILL_PARENT_DIRS = [
  join(homedir(), '.pulse-coder', 'skills'),
  join(homedir(), '.claude', 'skills'),
  join(homedir(), '.codex', 'skills'),
];

const LEGACY_SKILL_DIRS = SKILL_PARENT_DIRS.map((dir) => join(dir, 'canvas'));

export interface SkillTargetResult {
  path: string;
  ok: boolean;
  error?: string;
}

export interface SkillsInstallResult {
  ok: boolean;
  skillsInstalled: boolean;
  results: SkillTargetResult[];
  cliInstalled: boolean;
  cliPath: string;
  version: string | null;
  cliError: string | null;
}

let manager: AgentToolingManager | null = null;
let installInFlight: Promise<AgentToolingInstallResult> | null = null;

function getAgentToolingManager(): AgentToolingManager {
  manager ??= createAgentToolingManager({
    bundleRoot: resolveBundleRoot(),
    installRoot: join(homedir(), '.pulse-coder'),
    skillParents: SKILL_PARENT_DIRS,
    hostExecutable: process.execPath,
    platform: process.platform,
  });
  return manager;
}

function resolveBundleRoot(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'agent-tooling');
  const repoRoot = findRepoRoot();
  return repoRoot
    ? join(repoRoot, 'packages', 'canvas-cli')
    : join(app.getAppPath(), 'resources', 'agent-tooling');
}

/**
 * Walk upwards to find the development checkout. Packaged applications never
 * use this path; their prebuilt CLI lives under process.resourcesPath.
 */
function findRepoRoot(): string | null {
  const starts = [app.getAppPath(), __dirname, process.cwd()];
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

/** Install or repair the app-owned pulse-canvas CLI and complete skill set. */
export async function runInstall(): Promise<SkillsInstallResult> {
  installInFlight ??= getAgentToolingManager().ensureInstalled()
    .finally(() => { installInFlight = null; });
  const result = await installInFlight;
  return result;
}

/**
 * A packaged app treats first launch as the cross-platform install hook.
 * macOS DMGs do not have a reliable post-install phase, so deployment happens
 * here and repeats idempotently after every app update.
 */
export async function ensureAgentToolingAtStartup(
  writeLog: (source: string, message: string, detail?: string) => Promise<void>,
): Promise<void> {
  if (!app.isPackaged) return;
  const result = await runInstall();
  if (result.ok) {
    await writeLog(
      'agent-tooling',
      `pulse-canvas ${result.version ?? 'unknown'} ready`,
      `${result.results.length} skill targets; cli=${result.cliPath}`,
    );
    return;
  }
  await writeLog(
    'agent-tooling',
    'automatic installation incomplete',
    result.cliError ?? result.results.filter((item) => !item.ok)
      .map((item) => `${item.path}: ${item.error ?? 'write failed'}`)
      .join('\n'),
  );
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
  } catch (error) {
    return {
      path: dir,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function setupSkillInstallerIpc(): void {
  ipcMain.handle('skills:install', async () => runInstall());

  ipcMain.handle('skills:status', async () => {
    const [status, legacy] = await Promise.all([
      getAgentToolingManager().status(),
      Promise.all(LEGACY_SKILL_DIRS.map(checkLegacyDir)),
    ]);
    return {
      ...status,
      legacyDirs: legacy.filter((item) => item.exists).map((item) => item.dir),
    };
  });

  ipcMain.handle('skills:cleanup-legacy', async () => {
    const present = (await Promise.all(LEGACY_SKILL_DIRS.map(checkLegacyDir)))
      .filter((item) => item.exists)
      .map((item) => item.dir);
    const results = await Promise.all(present.map(removeLegacyDir));
    return { ok: results.every((result) => result.ok), results };
  });
}
