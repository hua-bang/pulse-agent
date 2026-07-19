import { promises as fs } from 'fs';
import { basename, dirname, join } from 'path';
import { createHash, randomUUID } from 'crypto';

export interface AgentToolingTargetResult {
  path: string;
  ok: boolean;
  error?: string;
}

export interface AgentToolingStatus {
  installed: boolean;
  version: string | null;
  cliInstalled: boolean;
  cliPath: string;
  skillsInstalled: boolean;
  results: AgentToolingTargetResult[];
}

export interface AgentToolingInstallResult extends AgentToolingStatus {
  ok: boolean;
  cliError: string | null;
}

export interface AgentToolingManager {
  status(): Promise<AgentToolingStatus>;
  ensureInstalled(): Promise<AgentToolingInstallResult>;
}

export interface AgentToolingManagerOptions {
  bundleRoot: string;
  installRoot: string;
  skillParents: string[];
  hostExecutable: string;
  platform: NodeJS.Platform;
}

interface BundleDescriptor {
  version: string;
  fingerprint: string;
  cliSourceDir: string;
  skills: Array<{ sourceName: string; installName: string; sourcePath: string }>;
}

const CLI_PACKAGE_NAME = '@pulse-coder/canvas-cli';
const MANAGED_MARKER = '.pulse-canvas-managed.json';
const BUNDLE_MARKER = '.pulse-canvas-bundle.json';

export function createAgentToolingManager(
  options: AgentToolingManagerOptions,
): AgentToolingManager {
  const cliPath = join(
    options.installRoot,
    'bin',
    options.platform === 'win32' ? 'pulse-canvas.cmd' : 'pulse-canvas',
  );

  return {
    status: async () => {
      try {
        const bundle = await readBundle(options.bundleRoot);
        return await inspectInstallation(options, bundle, cliPath);
      } catch {
        return {
          installed: false,
          version: null,
          cliInstalled: false,
          cliPath,
          skillsInstalled: false,
          results: [],
        };
      }
    },
    ensureInstalled: async () => {
      let bundle: BundleDescriptor;
      try {
        bundle = await readBundle(options.bundleRoot);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          ok: false,
          installed: false,
          version: null,
          cliInstalled: false,
          cliPath,
          cliError: message,
          skillsInstalled: false,
          results: [],
        };
      }

      let cliError: string | null = null;
      try {
        await installCliBundle(options, bundle, cliPath);
      } catch (error) {
        cliError = error instanceof Error ? error.message : String(error);
      }
      const results = await installSkills(
        options.skillParents,
        bundle,
        cliPath,
        options.platform,
      );
      const inspected = await inspectInstallation(options, bundle, cliPath, results);
      return {
        ...inspected,
        ok: inspected.installed,
        cliError,
      };
    },
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
  if (skills.length === 0) throw new Error(`No Canvas skills found in ${skillsDir}`);
  return {
    version: parsed.version,
    fingerprint: await fingerprintCliTree(cliSourceDir),
    cliSourceDir,
    skills,
  };
}

async function installCliBundle(
  options: AgentToolingManagerOptions,
  bundle: BundleDescriptor,
  cliPath: string,
): Promise<void> {
  const toolingParent = join(options.installRoot, 'tooling', 'pulse-canvas');
  const versionDir = join(toolingParent, bundle.version);
  if (!await isBundleCurrent(versionDir, bundle.fingerprint)) {
    await fs.mkdir(toolingParent, { recursive: true });
    // This directory is app-owned and version-scoped. If its entrypoint is
    // missing, replace the damaged installation instead of preserving a
    // partial copy that can never pass status checks.
    await fs.rm(versionDir, { recursive: true, force: true });
    const stagingDir = join(
      toolingParent,
      `.${bundle.version}-${process.pid}-${randomUUID()}`,
    );
    await fs.cp(bundle.cliSourceDir, stagingDir, { recursive: true });
    await fs.writeFile(
      join(stagingDir, BUNDLE_MARKER),
      `${JSON.stringify({
        version: bundle.version,
        fingerprint: bundle.fingerprint,
      }, null, 2)}\n`,
      'utf8',
    );
    try {
      await fs.rename(stagingDir, versionDir);
    } catch (error: any) {
      await fs.rm(stagingDir, { recursive: true, force: true });
      if (error?.code !== 'EEXIST' && error?.code !== 'ENOTEMPTY') throw error;
    }
  }

  const entryPath = join(versionDir, 'index.cjs');
  const wrapper = options.platform === 'win32'
    ? windowsWrapper(options.hostExecutable, entryPath)
    : unixWrapper(options.hostExecutable, entryPath);
  await atomicWrite(cliPath, wrapper, options.platform === 'win32' ? undefined : 0o755);
}

async function installSkills(
  parents: string[],
  bundle: BundleDescriptor,
  cliPath: string,
  platform: NodeJS.Platform,
): Promise<AgentToolingTargetResult[]> {
  const results: AgentToolingTargetResult[] = [];
  for (const parent of parents) {
    for (const skill of bundle.skills) {
      const targetDir = join(parent, skill.installName);
      const targetPath = join(targetDir, 'SKILL.md');
      try {
        const content = await installedSkillContent(skill, cliPath, platform);
        await atomicWrite(targetPath, content);
        await atomicWrite(
          join(targetDir, MANAGED_MARKER),
          `${JSON.stringify({
            version: bundle.version,
            fingerprint: bundle.fingerprint,
            source: skill.sourceName,
          }, null, 2)}\n`,
        );
        results.push({ path: targetPath, ok: true });
      } catch (error) {
        results.push({
          path: targetPath,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
  return results;
}

function decorateSkillContent(
  content: string,
  cliPath: string,
  platform: NodeJS.Platform,
): string {
  const invocation = platform === 'win32'
    ? `& "${cliPath.split('"').join('`"')}"`
    : shellQuote(cliPath);
  const instruction =
    `\n> Managed by Pulse Canvas. Invoke the bundled CLI as \`${invocation}\`; `
    + 'do not assume `pulse-canvas` is on PATH.\n';
  const withInstruction = content.replace(
    /^(---\n[\s\S]*?\n---\n)/,
    `$1${instruction}`,
  );
  return withInstruction
    .replace(/(^|\n)pulse-canvas(?=\s)/g, `$1${invocation}`)
    .replace(/`pulse-canvas(?=\s)/g, `\`${invocation}`);
}

async function inspectInstallation(
  options: AgentToolingManagerOptions,
  bundle: BundleDescriptor,
  cliPath: string,
  knownResults?: AgentToolingTargetResult[],
): Promise<AgentToolingStatus> {
  const versionEntry = join(
    options.installRoot,
    'tooling',
    'pulse-canvas',
    bundle.version,
    'index.cjs',
  );
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

async function installedSkillContent(
  skill: BundleDescriptor['skills'][number],
  cliPath: string,
  platform: NodeJS.Platform,
): Promise<string> {
  let content = await fs.readFile(skill.sourcePath, 'utf8');
  if (skill.sourceName === 'canvas') {
    content = content.replace(/^name:.*$/m, 'name: pulse-canvas');
  }
  return decorateSkillContent(content, cliPath, platform);
}

async function isLauncherCurrent(
  cliPath: string,
  expectedContent: string,
  platform: NodeJS.Platform,
): Promise<boolean> {
  try {
    const [content, stat] = await Promise.all([
      fs.readFile(cliPath, 'utf8'),
      fs.stat(cliPath),
    ]);
    return content === expectedContent
      && (platform === 'win32' || (stat.mode & 0o111) !== 0);
  } catch {
    return false;
  }
}

async function isBundleCurrent(versionDir: string, fingerprint: string): Promise<boolean> {
  try {
    const marker = JSON.parse(
      await fs.readFile(join(versionDir, BUNDLE_MARKER), 'utf8'),
    ) as { fingerprint?: unknown };
    return marker.fingerprint === fingerprint
      && await fingerprintCliTree(versionDir) === fingerprint;
  } catch {
    return false;
  }
}

async function fingerprintCliTree(cliDir: string): Promise<string> {
  const hash = createHash('sha256');
  hash.update(await fs.readFile(join(cliDir, 'index.cjs')));
  const skillsDir = join(cliDir, 'skills');
  const entries = (await fs.readdir(skillsDir, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const entry of entries) {
    const skillPath = join(skillsDir, entry.name, 'SKILL.md');
    try {
      const content = await fs.readFile(skillPath);
      hash.update(entry.name);
      hash.update(content);
    } catch {
      // Match bundle discovery: support directories without SKILL.md are ignored.
    }
  }
  return hash.digest('hex');
}

async function allExist(paths: string[]): Promise<boolean> {
  try {
    await Promise.all(paths.map((path) => fs.access(path)));
    return true;
  } catch {
    return false;
  }
}

async function atomicWrite(path: string, content: string, mode?: number): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.${randomUUID()}`);
  try {
    await fs.writeFile(temporary, content, { encoding: 'utf8', ...(mode ? { mode } : {}) });
    try {
      await fs.rename(temporary, path);
    } catch (error: any) {
      if (error?.code !== 'EEXIST' && error?.code !== 'EPERM' && error?.code !== 'ENOTEMPTY') {
        throw error;
      }
      await fs.rm(path, { force: true });
      await fs.rename(temporary, path);
    }
    if (mode) await fs.chmod(path, mode);
  } finally {
    await fs.rm(temporary, { force: true });
  }
}

function unixWrapper(hostExecutable: string, entryPath: string): string {
  return '#!/bin/sh\n'
    + `ELECTRON_RUN_AS_NODE=1 exec ${shellQuote(hostExecutable)} ${shellQuote(entryPath)} "$@"\n`;
}

function windowsWrapper(hostExecutable: string, entryPath: string): string {
  return '@echo off\r\n'
    + 'set "ELECTRON_RUN_AS_NODE=1"\r\n'
    + `"${hostExecutable.split('"').join('""')}" "${entryPath.split('"').join('""')}" %*\r\n`;
}

function shellQuote(value: string): string {
  return `'${value.split("'").join(`'"'"'`)}'`;
}
