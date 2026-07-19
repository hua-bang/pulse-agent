import { app, ipcMain } from 'electron';
import { existsSync, promises as fs } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

import {
  createAgentToolingManager,
  type AgentToolingManager,
  type AgentToolingInstallResult,
  type AgentToolingAction,
  type AgentToolingStatus,
} from './agent-tooling-manager';
import { createAgentToolingQueue } from './agent-tooling-queue';
import type {
  AgentToolingUpdatePolicy,
  SkillsInstallResult,
  SkillsStatusResult,
  SkillTargetResult,
} from '../../shared/settings-config';
import {
  configurePulseCanvasShellPath,
  inspectPulseCanvasShellPath,
} from './shell-path';

const SKILL_PARENT_DIRS = [
  join(homedir(), '.pulse-coder', 'skills'),
  join(homedir(), '.claude', 'skills'),
  join(homedir(), '.codex', 'skills'),
];

const LEGACY_SKILL_DIRS = SKILL_PARENT_DIRS.map((dir) => join(dir, 'canvas'));

let manager: AgentToolingManager | null = null;
const toolingQueue = createAgentToolingQueue(getAgentToolingManager);

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
async function reconcileTooling(
  action: AgentToolingAction,
): Promise<AgentToolingInstallResult> {
  return toolingQueue.run(action);
}

export async function runInstall(): Promise<SkillsInstallResult> {
  return reconcileTooling('repair');
}

export async function runUpdate(): Promise<SkillsInstallResult> {
  return reconcileTooling('update');
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
  const result = await reconcileTooling('reconcile');
  if (result.deferred) {
    await writeLog(
      'agent-tooling',
      `pulse-canvas ${result.bundledVersion ?? 'unknown'} update deferred`,
      `policy=${result.updatePolicy}; active=${result.version ?? 'none'}`,
    );
    return;
  }
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

async function withIntegrationStatus(
  statusPromise: Promise<AgentToolingStatus>,
): Promise<SkillsStatusResult> {
  const [status, legacy, shellPath] = await Promise.all([
    statusPromise,
    Promise.all(LEGACY_SKILL_DIRS.map(checkLegacyDir)),
    inspectPulseCanvasShellPath({
      home: homedir(),
      shell: process.env.SHELL,
      platform: process.platform,
    }),
  ]);
  return {
    ...status,
    legacyDirs: legacy.filter((item) => item.exists).map((item) => item.dir),
    shellPath,
  };
}

export function setupSkillInstallerIpc(): void {
  ipcMain.handle('skills:install', async () => runInstall());
  ipcMain.handle('skills:update', async () => runUpdate());

  ipcMain.handle('skills:status', async () => withIntegrationStatus(
    getAgentToolingManager().status(),
  ));

  ipcMain.handle('skills:configure-path', async () => configurePulseCanvasShellPath({
    home: homedir(),
    shell: process.env.SHELL,
    platform: process.platform,
  }));

  ipcMain.handle(
    'skills:set-update-policy',
    async (_event, payload: { policy?: unknown }) => {
      if (!isUpdatePolicy(payload?.policy)) {
        throw new Error(`Invalid agent tooling update policy: ${String(payload?.policy)}`);
      }
      return withIntegrationStatus(
        getAgentToolingManager().setUpdatePolicy(payload.policy),
      );
    },
  );

  ipcMain.handle('skills:cleanup-legacy', async () => {
    const present = (await Promise.all(LEGACY_SKILL_DIRS.map(checkLegacyDir)))
      .filter((item) => item.exists)
      .map((item) => item.dir);
    const results = await Promise.all(present.map(removeLegacyDir));
    return { ok: results.every((result) => result.ok), results };
  });
}

function isUpdatePolicy(value: unknown): value is AgentToolingUpdatePolicy {
  return value === 'follow-app' || value === 'ask' || value === 'pinned';
}
