import { execFile } from 'child_process';
import { promises as fs } from 'fs';
import { isAbsolute, join, relative, resolve } from 'path';
import { promisify } from 'util';

import type { PluginMarketSource } from '../../shared/plugin-market';
import { pluginMarketRootDir } from './store';

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 120_000;
const MANAGED_PACKAGE_LIMITS = {
  entries: 2_048,
  files: 1_024,
  singleFileBytes: 16 * 1024 * 1024,
  totalFileBytes: 64 * 1024 * 1024,
  relativePathBytes: 512,
} as const;

interface ManagedPackageLimits {
  entries: number;
  files: number;
  singleFileBytes: number;
  totalFileBytes: number;
  relativePathBytes: number;
}

function isContained(root: string, target: string): boolean {
  const child = relative(root, target);
  return child === '' || (!child.startsWith('..') && !isAbsolute(child));
}

/** Bound untrusted Git snapshots before copying them into managed storage. */
export async function assertManagedPackageTree(
  root: string,
  limits: ManagedPackageLimits = MANAGED_PACKAGE_LIMITS,
): Promise<void> {
  let entries = 0;
  let files = 0;
  let totalFileBytes = 0;

  const visit = async (directory: string, depth: number): Promise<void> => {
    for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
      if (depth === 0 && entry.name === '.git') continue;
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).replace(/\\/g, '/');
      entries += 1;
      if (entries > limits.entries) throw new Error('Plugin package contains too many entries');
      if (Buffer.byteLength(relativePath, 'utf8') > limits.relativePathBytes) {
        throw new Error(`Plugin package path is too long: ${relativePath}`);
      }
      if (entry.isSymbolicLink()) {
        throw new Error(`Managed Git plugins cannot contain symbolic links: ${relativePath}`);
      }
      if (entry.isDirectory()) {
        await visit(path, depth + 1);
        continue;
      }
      if (!entry.isFile()) throw new Error(`Unsupported package entry: ${relativePath}`);
      const stat = await fs.stat(path);
      files += 1;
      totalFileBytes += stat.size;
      if (files > limits.files) throw new Error('Plugin package contains too many files');
      if (stat.size > limits.singleFileBytes) {
        throw new Error(`Plugin package file is too large: ${relativePath}`);
      }
      if (totalFileBytes > limits.totalFileBytes) throw new Error('Plugin package is too large');
    }
  };

  await visit(root, 0);
}

export function normalizedGitSource(source: PluginMarketSource): PluginMarketSource {
  if (source.kind !== 'git' || !source.url?.trim()) throw new Error('Git repository URL is required');
  let url: URL;
  try {
    url = new URL(source.url.trim());
  } catch {
    throw new Error('Git repository URL is invalid');
  }
  if (url.protocol !== 'https:' || url.username || url.password) {
    throw new Error('Only credential-free HTTPS Git repository URLs are supported');
  }
  const ref = source.ref?.trim();
  if (ref?.startsWith('-')) throw new Error('Git ref cannot start with a dash');
  const subdir = source.subdir?.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (subdir && (subdir.startsWith('/') || /^[a-zA-Z]:\//.test(subdir) || subdir.split('/').includes('..'))) {
    throw new Error('Plugin subdirectory must stay inside the repository');
  }
  return {
    kind: 'git',
    url: url.toString(),
    ...(ref ? { ref } : {}),
    ...(subdir ? { subdir } : {}),
  };
}

export async function gitClone(source: PluginMarketSource): Promise<{
  stagingDir: string;
  packageDir: string;
  commit: string;
}> {
  const normalized = normalizedGitSource(source);
  await fs.mkdir(pluginMarketRootDir(), { recursive: true });
  const stagingDir = await fs.mkdtemp(join(pluginMarketRootDir(), 'staging-'));
  const repositoryDir = join(stagingDir, 'repository');
  try {
    const args = ['clone', '--depth', '1'];
    if (normalized.ref) args.push('--branch', normalized.ref);
    args.push(normalized.url!, repositoryDir);
    await execFileAsync('git', args, {
      timeout: GIT_TIMEOUT_MS,
      maxBuffer: 2 * 1024 * 1024,
      env: { ...process.env, GIT_LFS_SKIP_SMUDGE: '1' },
    });
    const { stdout } = await execFileAsync('git', ['-C', repositoryDir, 'rev-parse', 'HEAD'], {
      timeout: 15_000,
      maxBuffer: 64 * 1024,
    });
    const packageCandidate = resolve(repositoryDir, normalized.subdir ?? '.');
    if (!isContained(repositoryDir, packageCandidate)) throw new Error('Plugin subdirectory escapes repository');
    const [canonicalRepository, packageDir] = await Promise.all([
      fs.realpath(repositoryDir),
      fs.realpath(packageCandidate),
    ]);
    if (!isContained(canonicalRepository, packageDir)) {
      throw new Error('Plugin subdirectory resolves outside the repository');
    }
    return { stagingDir, packageDir, commit: stdout.trim() };
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    throw error;
  }
}
