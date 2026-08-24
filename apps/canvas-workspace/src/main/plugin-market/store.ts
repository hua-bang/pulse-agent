import { app } from 'electron';
import { randomUUID } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { promises as fs } from 'fs';
import { dirname, join, normalize, resolve } from 'path';
import type { PluginMarketSource, PluginPackageFormat } from '../../shared/plugin-market';

const STATE_VERSION = 1;
const STATE_FILE = 'plugin-market.json';

export interface InstalledPluginRecord {
  listingId: string;
  packageName: string;
  root: string;
  source: PluginMarketSource;
  format: PluginPackageFormat;
  managed: boolean;
  nativeEnabled: boolean;
  installedAt: number;
  runtimeMcpPath?: string;
}

interface PluginMarketState {
  version: typeof STATE_VERSION;
  plugins: InstalledPluginRecord[];
}

function emptyState(): PluginMarketState {
  return { version: STATE_VERSION, plugins: [] };
}

export function pluginMarketRootDir(): string {
  return join(app.getPath('userData'), 'plugin-market');
}

export function pluginMarketStatePath(): string {
  return join(pluginMarketRootDir(), STATE_FILE);
}

export function pluginMarketPackagesDir(): string {
  return join(pluginMarketRootDir(), 'packages');
}

export function pluginMarketRuntimeDir(): string {
  return join(pluginMarketRootDir(), 'runtime');
}

export function pluginMarketDataDir(): string {
  return join(pluginMarketRootDir(), 'data');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSource(value: unknown): PluginMarketSource | null {
  if (!isRecord(value) || (value.kind !== 'directory' && value.kind !== 'git')) return null;
  return {
    kind: value.kind,
    path: typeof value.path === 'string' ? value.path : undefined,
    url: typeof value.url === 'string' ? value.url : undefined,
    ref: typeof value.ref === 'string' ? value.ref : undefined,
    subdir: typeof value.subdir === 'string' ? value.subdir : undefined,
  };
}

function normalizeState(value: unknown): PluginMarketState {
  if (!isRecord(value) || !Array.isArray(value.plugins)) return emptyState();
  const plugins: InstalledPluginRecord[] = [];
  for (const item of value.plugins) {
    if (!isRecord(item)) continue;
    const source = normalizeSource(item.source);
    if (
      typeof item.listingId !== 'string'
      || typeof item.packageName !== 'string'
      || typeof item.root !== 'string'
      || !source
      || (item.format !== 'agent-plugin' && item.format !== 'legacy-canvas')
    ) continue;
    plugins.push({
      listingId: item.listingId,
      packageName: item.packageName,
      root: normalize(resolve(item.root)),
      source,
      format: item.format,
      managed: item.managed === true,
      nativeEnabled: item.nativeEnabled === true,
      installedAt: typeof item.installedAt === 'number' ? item.installedAt : 0,
      runtimeMcpPath: typeof item.runtimeMcpPath === 'string' ? item.runtimeMcpPath : undefined,
    });
  }
  return { version: STATE_VERSION, plugins };
}

export async function readPluginMarketState(): Promise<PluginMarketState> {
  try {
    return normalizeState(JSON.parse(await fs.readFile(pluginMarketStatePath(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    throw error;
  }
}

export function readPluginMarketStateSync(): PluginMarketState {
  try {
    return normalizeState(JSON.parse(readFileSync(pluginMarketStatePath(), 'utf8')));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return emptyState();
    return emptyState();
  }
}

export async function writePluginMarketState(state: PluginMarketState): Promise<void> {
  const path = pluginMarketStatePath();
  await fs.mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(temporary, `${JSON.stringify(normalizeState(state), null, 2)}\n`, 'utf8');
    await fs.rename(temporary, path);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

let mutationTail: Promise<void> = Promise.resolve();

/** Serializes every market mutation so read-modify-write snapshots cannot race. */
export function runPluginMarketMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(operation);
  mutationTail = result.then(() => undefined, () => undefined);
  return result;
}

export function isPluginMarketNativeEnabledSync(root: string): boolean {
  return getPluginMarketNativePolicySync(root) === true;
}

export function getPluginMarketNativePolicySync(root: string): boolean | undefined {
  const target = normalize(resolve(root));
  return readPluginMarketStateSync().plugins.find((plugin) => plugin.root === target)?.nativeEnabled;
}

export function getPluginMarketMcpConfigPathsSync(): string[] {
  return readPluginMarketStateSync().plugins
    .map((plugin) => plugin.runtimeMcpPath)
    .filter((path): path is string => Boolean(path && existsSync(path)));
}

export type { PluginMarketState };
