import { promises as fs } from 'fs';
import { dirname, join } from 'path';

import {
  readUpdatePolicy,
  resolveActiveState,
  toolingRoot,
  writeUpdatePolicy,
  type AgentToolingActiveState,
  type AgentToolingUpdatePolicy,
} from './agent-tooling-state';
import {
  allExist,
  fingerprintCliTree,
  isBundleCurrent,
  isLauncherCurrent,
  unixWrapper,
  windowsWrapper,
} from './agent-tooling-files';
import {
  deployAgentTooling,
  installedSkillContent,
  type AgentToolingBundle,
} from './agent-tooling-deployment';

export type { AgentToolingUpdatePolicy } from './agent-tooling-state';

export interface AgentToolingTargetResult {
  path: string;
  ok: boolean;
  error?: string;
}

export interface AgentToolingStatus {
  installed: boolean;
  version: string | null;
  fingerprint: string | null;
  bundledVersion: string | null;
  bundledFingerprint: string | null;
  updateAvailable: boolean;
  updatePolicy: AgentToolingUpdatePolicy;
  cliInstalled: boolean;
  cliPath: string;
  skillsInstalled: boolean;
  results: AgentToolingTargetResult[];
}

export interface AgentToolingInstallResult extends AgentToolingStatus {
  ok: boolean;
  cliError: string | null;
  applied: boolean;
  deferred: boolean;
}

export type AgentToolingAction = 'reconcile' | 'repair' | 'update';

export interface AgentToolingManager {
  status(): Promise<AgentToolingStatus>;
  ensureInstalled(options?: {
    action?: AgentToolingAction;
  }): Promise<AgentToolingInstallResult>;
  setUpdatePolicy(policy: AgentToolingUpdatePolicy): Promise<AgentToolingStatus>;
}

export interface AgentToolingManagerOptions {
  bundleRoot: string;
  installRoot: string;
  skillParents: string[];
  hostExecutable: string;
  platform: NodeJS.Platform;
}

type BundleDescriptor = AgentToolingBundle;

interface InstallationStatus {
  installed: boolean;
  version: string | null;
  fingerprint: string | null;
  cliInstalled: boolean;
  cliPath: string;
  skillsInstalled: boolean;
  results: AgentToolingTargetResult[];
}

const CLI_PACKAGE_NAME = '@pulse-coder/canvas-cli';
const MANAGED_MARKER = '.pulse-canvas-managed.json';

export function createAgentToolingManager(
  options: AgentToolingManagerOptions,
): AgentToolingManager {
  const cliPath = join(
    options.installRoot,
    'bin',
    options.platform === 'win32' ? 'pulse-canvas.cmd' : 'pulse-canvas',
  );

  return {
    status: async () => readStatus(options, cliPath),
    setUpdatePolicy: async (policy) => {
      await writeUpdatePolicy(options.installRoot, policy);
      return readStatus(options, cliPath);
    },
    ensureInstalled: async ({ action = 'reconcile' } = {}) => {
      let bundle: BundleDescriptor;
      try {
        bundle = await readBundle(options.bundleRoot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const updatePolicy = await readUpdatePolicy(options.installRoot);
        return {
          ok: false,
          applied: false,
          deferred: false,
          installed: false,
          version: null,
          fingerprint: null,
          bundledVersion: null,
          bundledFingerprint: null,
          updateAvailable: false,
          updatePolicy,
          cliInstalled: false,
          cliPath,
          cliError: message,
          skillsInstalled: false,
          results: [],
        };
      }

      const updatePolicy = await readUpdatePolicy(options.installRoot);
      const active = await resolveActiveState(options.installRoot, cliPath);
      const updateAvailable = active !== null && !matchesBundle(active, bundle);
      const keepActive = active !== null && updateAvailable && (
        action === 'repair'
        || (action === 'reconcile' && updatePolicy !== 'follow-app')
      );
      const target = keepActive
        ? await readActiveBundle(options, active)
        : bundle;
      const before = active
        ? await inspectActiveInstallation(options, active, cliPath)
        : emptyInstallation(cliPath);
      if (before.installed && active && matchesBundle(active, target)) {
        return {
          ...withBundleStatus(before, bundle, updatePolicy),
          ok: true,
          cliError: null,
          applied: false,
          deferred: updateAvailable,
        };
      }
      try {
        await deployAgentTooling(options, target, cliPath, active);
      } catch (error) {
        const inspected = active
          ? await inspectActiveInstallation(options, active, cliPath)
          : emptyInstallation(cliPath);
        return {
          ...withBundleStatus(inspected, bundle, updatePolicy),
          ok: false,
          cliError: error instanceof Error ? error.message : String(error),
          applied: false,
          deferred: keepActive,
        };
      }
      const activated = await readActiveBundle(options, {
        version: target.version,
        fingerprint: target.fingerprint,
      });
      const inspected = await inspectInstallation(options, activated, cliPath);
      return {
        ...withBundleStatus(inspected, bundle, updatePolicy),
        ok: inspected.installed,
        cliError: null,
        applied: active === null || !matchesBundle(active, target),
        deferred: !matchesBundle(target, bundle),
      };
    },
  };
}

async function readStatus(
  options: AgentToolingManagerOptions,
  cliPath: string,
): Promise<AgentToolingStatus> {
  const updatePolicy = await readUpdatePolicy(options.installRoot);
  let bundle: BundleDescriptor | null = null;
  try {
    bundle = await readBundle(options.bundleRoot);
  } catch {
    // A missing development build should not hide an existing installation.
  }
  const active = await resolveActiveState(options.installRoot, cliPath);
  const inspected = active
    ? await inspectActiveInstallation(options, active, cliPath)
    : emptyInstallation(cliPath);
  return withBundleStatus(inspected, bundle, updatePolicy);
}

function withBundleStatus(
  installed: InstallationStatus,
  bundle: BundleDescriptor | null,
  updatePolicy: AgentToolingUpdatePolicy,
): AgentToolingStatus {
  return {
    ...installed,
    bundledVersion: bundle?.version ?? null,
    bundledFingerprint: bundle?.fingerprint ?? null,
    updateAvailable: bundle !== null && installed.version !== null && (
      installed.version !== bundle.version || installed.fingerprint !== bundle.fingerprint
    ),
    updatePolicy,
  };
}

function emptyInstallation(cliPath: string): InstallationStatus {
  return {
    installed: false,
    version: null,
    fingerprint: null,
    cliInstalled: false,
    cliPath,
    skillsInstalled: false,
    results: [],
  };
}

function matchesBundle(active: AgentToolingActiveState, bundle: BundleDescriptor): boolean {
  return active.version === bundle.version && active.fingerprint === bundle.fingerprint;
}

async function inspectActiveInstallation(
  options: AgentToolingManagerOptions,
  active: AgentToolingActiveState,
  cliPath: string,
): Promise<InstallationStatus> {
  try {
    return inspectInstallation(options, await readActiveBundle(options, active), cliPath);
  } catch {
    return {
      ...emptyInstallation(cliPath),
      version: active.version,
      fingerprint: active.fingerprint,
    };
  }
}

async function readActiveBundle(
  options: AgentToolingManagerOptions,
  active: AgentToolingActiveState,
): Promise<BundleDescriptor> {
  const root = toolingRoot(options.installRoot);
  const runtimeDir = join(root, '.runtime', active.fingerprint);
  const cacheDir = join(root, '.cache', active.fingerprint);
  const legacyDir = join(root, active.version);
  const cacheCurrent = await isBundleCurrent(cacheDir, active.fingerprint);
  const runtimeExists = await allExist([runtimeDir]);
  const cliSourceDir = cacheCurrent ? cacheDir : runtimeExists ? runtimeDir : legacyDir;
  const activeDir = runtimeExists || cacheCurrent ? runtimeDir : legacyDir;
  return {
    ...active,
    cliSourceDir,
    activeDir,
    skills: await readSkills(cliSourceDir),
  };
}

async function readBundle(bundleRoot: string): Promise<BundleDescriptor> {
  const packagedMetadata = join(bundleRoot, 'canvas-cli-package.json');
  const packagedCli = join(bundleRoot, 'canvas-cli');
  const sourceMetadata = join(bundleRoot, 'package.json');
  const sourceCli = join(bundleRoot, 'dist');
  const packagedLayout = await allExist([packagedMetadata, join(packagedCli, 'index.cjs')]);
  const packagePath = packagedLayout ? packagedMetadata : sourceMetadata;
  const parsed = JSON.parse(await fs.readFile(packagePath, 'utf8')) as {
    name?: unknown;
    version?: unknown;
  };
  if (parsed.name !== CLI_PACKAGE_NAME || typeof parsed.version !== 'string' || !parsed.version) {
    throw new Error(`Invalid bundled Canvas CLI metadata at ${packagePath}`);
  }

  const cliSourceDir = packagedLayout ? packagedCli : sourceCli;
  await fs.access(join(cliSourceDir, 'index.cjs'));
  const skills = await readSkills(cliSourceDir);
  if (skills.length === 0) throw new Error(`No Canvas skills found in ${join(cliSourceDir, 'skills')}`);
  return {
    version: parsed.version,
    fingerprint: await fingerprintCliTree(cliSourceDir),
    cliSourceDir,
    skills,
  };
}

async function readSkills(cliSourceDir: string): Promise<BundleDescriptor['skills']> {
  const skillsDir = join(cliSourceDir, 'skills');
  const entries = (await fs.readdir(skillsDir, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name));
  const skills: BundleDescriptor['skills'] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sourcePath = join(skillsDir, entry.name, 'SKILL.md');
    try {
      await fs.access(sourcePath);
      skills.push({
        sourceName: entry.name,
        installName: entry.name === 'canvas' ? 'pulse-canvas' : entry.name,
        sourcePath,
      });
    } catch {
      // Ignore non-skill support directories in the bundled skills tree.
    }
  }
  return skills;
}

async function inspectInstallation(
  options: AgentToolingManagerOptions,
  bundle: BundleDescriptor,
  cliPath: string,
  knownResults?: AgentToolingTargetResult[],
): Promise<InstallationStatus> {
  const versionEntry = join(bundle.activeDir ?? bundle.cliSourceDir, 'index.cjs');
  const expectedWrapper = options.platform === 'win32'
    ? windowsWrapper(options.hostExecutable, versionEntry)
    : unixWrapper(options.hostExecutable, versionEntry);
  const cliInstalled = await isBundleCurrent(dirname(versionEntry), bundle.fingerprint)
    && await isLauncherCurrent(cliPath, expectedWrapper, options.platform);
  const results = knownResults ?? await Promise.all(
    options.skillParents.flatMap((parent) => bundle.skills.map(async (skill) => {
      const path = join(parent, skill.installName, 'SKILL.md');
      const marker = join(dirname(path), MANAGED_MARKER);
      const expectedContent = await installedSkillContent(skill, cliPath, options.platform);
      return {
        path,
        ok: await isManagedSkillCurrent(
          path,
          marker,
          bundle.version,
          bundle.fingerprint,
          skill.sourceName,
          expectedContent,
        ),
      };
    })),
  );
  const skillsInstalled = results.length > 0 && results.every((result) => result.ok);
  return {
    installed: cliInstalled && skillsInstalled,
    version: bundle.version,
    fingerprint: bundle.fingerprint,
    cliInstalled,
    cliPath,
    skillsInstalled,
    results,
  };
}

async function isManagedSkillCurrent(
  skillPath: string,
  markerPath: string,
  version: string,
  fingerprint: string,
  source: string,
  expectedContent: string,
): Promise<boolean> {
  try {
    const content = await fs.readFile(skillPath, 'utf8');
    const marker = JSON.parse(await fs.readFile(markerPath, 'utf8')) as {
      version?: unknown;
      fingerprint?: unknown;
      source?: unknown;
    };
    return content === expectedContent
      && marker.version === version
      && marker.fingerprint === fingerprint
      && marker.source === source;
  } catch {
    return false;
  }
}
