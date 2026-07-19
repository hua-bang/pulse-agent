import { promises as fs } from 'fs';
import { join } from 'path';

import { BUNDLE_MARKER, atomicWrite } from './agent-tooling-files';
import type { AgentToolingUpdatePolicy } from '../../shared/settings-config';

export type { AgentToolingUpdatePolicy } from '../../shared/settings-config';

export interface AgentToolingActiveState {
  version: string;
  fingerprint: string;
}

const DEFAULT_POLICY: AgentToolingUpdatePolicy = 'follow-app';

export async function readUpdatePolicy(installRoot: string): Promise<AgentToolingUpdatePolicy> {
  try {
    const value = JSON.parse(
      await fs.readFile(join(toolingRoot(installRoot), 'update-policy.json'), 'utf8'),
    ) as { updatePolicy?: unknown };
    return isUpdatePolicy(value.updatePolicy) ? value.updatePolicy : DEFAULT_POLICY;
  } catch {
    return DEFAULT_POLICY;
  }
}

export async function writeUpdatePolicy(
  installRoot: string,
  updatePolicy: AgentToolingUpdatePolicy,
): Promise<void> {
  await writeJson(join(toolingRoot(installRoot), 'update-policy.json'), {
    schemaVersion: 1,
    updatePolicy,
  });
}

export async function readActiveState(
  installRoot: string,
): Promise<AgentToolingActiveState | null> {
  try {
    const value = JSON.parse(
      await fs.readFile(join(toolingRoot(installRoot), 'active.json'), 'utf8'),
    ) as { version?: unknown; fingerprint?: unknown };
    return typeof value.version === 'string' && typeof value.fingerprint === 'string'
      ? { version: value.version, fingerprint: value.fingerprint }
      : null;
  } catch {
    return null;
  }
}

export async function resolveActiveState(
  installRoot: string,
  cliPath: string,
): Promise<AgentToolingActiveState | null> {
  const recorded = await readActiveState(installRoot);
  if (recorded) return recorded;
  try {
    const wrapper = await fs.readFile(cliPath, 'utf8');
    const root = toolingRoot(installRoot);
    const versionDirs = await discoverBundleDirectories(root);
    for (const versionDir of versionDirs) {
      const entryPath = join(versionDir, 'index.cjs');
      if (!wrapper.includes(entryPath)) continue;
      const marker = JSON.parse(
        await fs.readFile(join(versionDir, BUNDLE_MARKER), 'utf8'),
      ) as { version?: unknown; fingerprint?: unknown };
      if (typeof marker.version !== 'string' || typeof marker.fingerprint !== 'string') continue;
      const migrated = { version: marker.version, fingerprint: marker.fingerprint };
      await writeActiveState(installRoot, migrated);
      return migrated;
    }
  } catch {
    // No legacy installation to migrate.
  }
  return null;
}

async function discoverBundleDirectories(root: string): Promise<string[]> {
  const entries = await fs.readdir(root, { withFileTypes: true });
  const directories = entries
    .filter((entry) => entry.isDirectory() && entry.name !== '.runtime' && entry.name !== '.cache')
    .map((entry) => join(root, entry.name));
  try {
    const runtimeRoot = join(root, '.runtime');
    const runtimeEntries = await fs.readdir(runtimeRoot, { withFileTypes: true });
    directories.push(...runtimeEntries
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(runtimeRoot, entry.name)));
  } catch {
    // Pre-runtime-layout installations only have version directories.
  }
  return directories;
}

export async function writeActiveState(
  installRoot: string,
  active: AgentToolingActiveState,
): Promise<void> {
  await writeJson(join(toolingRoot(installRoot), 'active.json'), {
    schemaVersion: 1,
    ...active,
  });
}

export async function clearActiveState(installRoot: string): Promise<void> {
  await fs.rm(join(toolingRoot(installRoot), 'active.json'), { force: true });
}

export function toolingRoot(installRoot: string): string {
  return join(installRoot, 'tooling', 'pulse-canvas');
}

function isUpdatePolicy(value: unknown): value is AgentToolingUpdatePolicy {
  return value === 'follow-app' || value === 'ask' || value === 'pinned';
}

async function writeJson(path: string, value: unknown): Promise<void> {
  await atomicWrite(path, `${JSON.stringify(value, null, 2)}\n`);
}
