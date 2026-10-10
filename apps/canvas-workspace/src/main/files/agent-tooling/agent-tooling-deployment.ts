import { promises as fs } from 'fs';
import { dirname, join } from 'path';

import {
  BUNDLE_MARKER,
  atomicWrite,
  decorateSkillContent,
  fingerprintCliTree,
  isBundleCurrent,
  unixWrapper,
  windowsWrapper,
} from './agent-tooling-files';
import {
  clearActiveState,
  toolingRoot,
  writeActiveState,
  type AgentToolingActiveState,
} from './agent-tooling-state';

export interface AgentToolingSkill {
  sourceName: string;
  installName: string;
  sourcePath: string;
}

export interface AgentToolingBundle extends AgentToolingActiveState {
  cliSourceDir: string;
  activeDir?: string;
  skills: AgentToolingSkill[];
}

interface DeploymentOptions {
  installRoot: string;
  skillParents: string[];
  hostExecutable: string;
  platform: NodeJS.Platform;
}

interface FileSnapshot {
  path: string;
  content: string | null;
  mode?: number;
}

const MANAGED_MARKER = '.pulse-canvas-managed.json';

export async function deployAgentTooling(
  options: DeploymentOptions,
  bundle: AgentToolingBundle,
  cliPath: string,
  previousActive: AgentToolingActiveState | null,
): Promise<void> {
  const entryPath = await prepareCliPayload(options.installRoot, bundle);
  const wrapper = options.platform === 'win32'
    ? windowsWrapper(options.hostExecutable, entryPath)
    : unixWrapper(options.hostExecutable, entryPath);
  const wrapperSnapshot = await snapshotFile(cliPath);
  let skillRollback = async () => {};

  try {
    skillRollback = await installSkillsTransaction(options, bundle, cliPath);
    await atomicWrite(cliPath, wrapper, options.platform === 'win32' ? undefined : 0o755);
    await writeActiveState(options.installRoot, {
      version: bundle.version,
      fingerprint: bundle.fingerprint,
    });
  } catch (error) {
    await Promise.allSettled([
      restoreFile(wrapperSnapshot),
      skillRollback(),
      restoreActiveState(options.installRoot, previousActive),
    ]);
    throw error;
  }
}

export async function installedSkillContent(
  skill: AgentToolingSkill,
  cliPath: string,
  platform: NodeJS.Platform,
): Promise<string> {
  let content = await fs.readFile(skill.sourcePath, 'utf8');
  if (skill.sourceName === 'canvas') {
    content = content.replace(/^name:.*$/m, 'name: pulse-canvas');
  }
  return decorateSkillContent(content, cliPath, platform);
}

async function prepareCliPayload(
  installRoot: string,
  bundle: AgentToolingBundle,
): Promise<string> {
  const root = toolingRoot(installRoot);
  const cacheDir = join(root, '.cache', bundle.fingerprint);
  if (!await isBundleCurrent(cacheDir, bundle.fingerprint)) {
    if (await fingerprintCliTree(bundle.cliSourceDir) !== bundle.fingerprint) {
      throw new Error(`Active pulse-canvas ${bundle.version} backup is damaged or unavailable`);
    }
    await replaceBundleDirectory(bundle.cliSourceDir, cacheDir, bundle);
  }

  const runtimeDir = join(root, '.runtime', bundle.fingerprint);
  if (!await isBundleCurrent(runtimeDir, bundle.fingerprint)) {
    await replaceBundleDirectory(cacheDir, runtimeDir, bundle);
  }
  return join(runtimeDir, 'index.cjs');
}

async function replaceBundleDirectory(
  source: string,
  target: string,
  bundle: AgentToolingActiveState,
): Promise<void> {
  await fs.mkdir(dirname(target), { recursive: true });
  const staging = `${target}.${process.pid}.${Date.now()}.staging`;
  await fs.rm(staging, { recursive: true, force: true });
  await fs.cp(source, staging, { recursive: true });
  await fs.writeFile(
    join(staging, BUNDLE_MARKER),
    `${JSON.stringify({
      version: bundle.version,
      fingerprint: bundle.fingerprint,
    }, null, 2)}\n`,
    'utf8',
  );
  await fs.rm(target, { recursive: true, force: true });
  await fs.rename(staging, target);
}

async function installSkillsTransaction(
  options: DeploymentOptions,
  bundle: AgentToolingBundle,
  cliPath: string,
): Promise<() => Promise<void>> {
  const snapshots: FileSnapshot[] = [];
  try {
    for (const parent of options.skillParents) {
      for (const skill of bundle.skills) {
        const targetDir = join(parent, skill.installName);
        const targetPath = join(targetDir, 'SKILL.md');
        const markerPath = join(targetDir, MANAGED_MARKER);
        snapshots.push(await snapshotFile(targetPath), await snapshotFile(markerPath));
        await atomicWrite(
          targetPath,
          await installedSkillContent(skill, cliPath, options.platform),
        );
        await atomicWrite(
          markerPath,
          `${JSON.stringify({
            version: bundle.version,
            fingerprint: bundle.fingerprint,
            source: skill.sourceName,
          }, null, 2)}\n`,
        );
      }
    }
  } catch (error) {
    await rollbackFiles(snapshots);
    throw error;
  }
  return async () => rollbackFiles(snapshots);
}

async function snapshotFile(path: string): Promise<FileSnapshot> {
  try {
    const [content, stat] = await Promise.all([fs.readFile(path, 'utf8'), fs.stat(path)]);
    return { path, content, mode: stat.mode & 0o777 };
  } catch (error: any) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return { path, content: null };
    throw error;
  }
}

async function rollbackFiles(snapshots: FileSnapshot[]): Promise<void> {
  await Promise.allSettled([...snapshots].reverse().map(restoreFile));
}

async function restoreFile(snapshot: FileSnapshot): Promise<void> {
  if (snapshot.content === null) {
    await fs.rm(snapshot.path, { force: true });
    return;
  }
  await atomicWrite(snapshot.path, snapshot.content, snapshot.mode);
}

async function restoreActiveState(
  installRoot: string,
  active: AgentToolingActiveState | null,
): Promise<void> {
  if (active) await writeActiveState(installRoot, active);
  else await clearActiveState(installRoot);
}
