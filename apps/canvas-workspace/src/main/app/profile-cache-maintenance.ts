import { promises as fs } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

interface ProfileCacheSession {
  clearCache(): Promise<void>;
  clearCodeCaches(options: { urls?: string[] }): Promise<void>;
  clearStorageData(options: {
    storages: Array<'serviceworkers' | 'cachestorage'>;
  }): Promise<void>;
}

interface MaintenanceState {
  lastCheckedAt: number;
  lastClearedAt?: number;
  beforeBytes?: number;
  afterBytes?: number;
  lastError?: string;
}

export interface ProfileCachePolicy {
  maxBytes: number;
  checkIntervalMs: number;
  startupDelayMs: number;
}

interface MaintenanceOptions {
  userDataDir: string;
  profileSession: ProfileCacheSession;
  maxBytes: number;
  checkIntervalMs: number;
  now?: () => number;
}

export interface MaintenanceResult {
  checked: boolean;
  cleared: boolean;
  beforeBytes?: number;
  afterBytes?: number;
}

interface MaintenanceLease {
  release(): Promise<void>;
}

const MANAGED_CACHE_PATHS = [
  'Cache',
  'Code Cache',
  join('Service Worker', 'CacheStorage'),
];

const envNumber = (
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
  min: number,
  max: number,
): number => {
  const value = Number(env[name]);
  return Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;
};

export const resolveProfileCachePolicy = (
  env: NodeJS.ProcessEnv = process.env,
): ProfileCachePolicy => ({
  maxBytes: Math.floor(envNumber(env, 'PULSE_CANVAS_PROFILE_CACHE_MAX_MB', 2_048, 0, 100_000) * 1024 * 1024),
  checkIntervalMs: Math.floor(envNumber(env, 'PULSE_CANVAS_PROFILE_CACHE_CHECK_HOURS', 24, 0, 24 * 30) * 60 * 60 * 1_000),
  startupDelayMs: Math.floor(envNumber(env, 'PULSE_CANVAS_PROFILE_CACHE_DELAY_MS', 30_000, 0, 5 * 60_000)),
});

export async function runProfileCacheMaintenance(
  options: MaintenanceOptions,
): Promise<MaintenanceResult> {
  if (options.maxBytes <= 0) return { checked: false, cleared: false };
  const lock = await acquireMaintenanceLock(options.userDataDir);
  if (!lock) return { checked: false, cleared: false };
  try {
    return await runLockedMaintenance(options);
  } finally {
    await lock.release();
  }
}

async function runLockedMaintenance(options: MaintenanceOptions): Promise<MaintenanceResult> {
  const now = options.now ?? Date.now;
  const statePath = join(options.userDataDir, 'profile-cache-maintenance.json');
  const state = await readState(statePath);
  const checkedAt = now();
  if (state && checkedAt - state.lastCheckedAt < options.checkIntervalMs) {
    return { checked: false, cleared: false };
  }

  const beforeBytes = await managedCacheBytes(options.userDataDir, options.maxBytes + 1);
  if (beforeBytes <= options.maxBytes) {
    await writeState(statePath, { ...state, lastCheckedAt: checkedAt, beforeBytes, afterBytes: beforeBytes });
    return { checked: true, cleared: false, beforeBytes, afterBytes: beforeBytes };
  }

  try {
    await Promise.all([
      options.profileSession.clearCache(),
      options.profileSession.clearCodeCaches({}),
      options.profileSession.clearStorageData({ storages: ['serviceworkers', 'cachestorage'] }),
    ]);
  } catch (error) {
    await writeState(statePath, {
      lastCheckedAt: checkedAt,
      beforeBytes,
      lastError: error instanceof Error ? error.message : String(error),
    }).catch(() => undefined);
    throw error;
  }
  const afterBytes = await managedCacheBytes(options.userDataDir);
  await writeState(statePath, {
    lastCheckedAt: checkedAt,
    lastClearedAt: checkedAt,
    beforeBytes,
    afterBytes,
  });
  return { checked: true, cleared: true, beforeBytes, afterBytes };
}

async function acquireMaintenanceLock(userDataDir: string): Promise<MaintenanceLease | null> {
  const token = randomUUID();
  const leaseDir = join(userDataDir, 'profile-cache-maintenance.leases');
  const leasePath = join(leaseDir, `${token}.lease`);
  await fs.mkdir(leaseDir, { recursive: true });
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(leasePath, 'wx');
    await handle.writeFile(token, 'utf-8');
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => undefined);
    await fs.unlink(leasePath).catch(() => undefined);
    throw error;
  }
  await handle.close();
  try {
    const now = Date.now();
    const leases = await fs.readdir(leaseDir);
    const active: string[] = [];
    for (const lease of leases.filter(file => file.endsWith('.lease'))) {
      const path = join(leaseDir, lease);
      if (lease.includes('.quarantine-')) {
        try {
          if (now - (await fs.stat(path)).mtimeMs <= 15 * 60_000) active.push(lease);
          else await fs.unlink(path);
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }
      } else if (await leaseIsActive(path, now)) active.push(lease);
    }
    if (active.some(lease => lease !== `${token}.lease`)) {
      await fs.unlink(leasePath);
      return null;
    }
  } catch (error) {
    await fs.unlink(leasePath).catch(() => undefined);
    throw error;
  }
  const heartbeat = setInterval(() => {
    void fs.utimes(leasePath, new Date(), new Date()).catch(() => undefined);
  }, 60_000);
  heartbeat.unref();
  return {
    release: async () => {
      clearInterval(heartbeat);
      await fs.unlink(leasePath).catch(() => undefined);
    },
  };
}

async function leaseIsActive(path: string, now: number): Promise<boolean> {
  let stat: Awaited<ReturnType<typeof fs.stat>>;
  try {
    stat = await fs.stat(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  if (now - stat.mtimeMs <= 15 * 60_000) return true;
  const quarantine = `${path.slice(0, -'.lease'.length)}.quarantine-${randomUUID()}.lease`;
  try {
    await fs.rename(path, quarantine);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
  const refreshed = now - (await fs.stat(quarantine)).mtimeMs <= 15 * 60_000;
  if (refreshed) {
    await fs.rename(quarantine, path);
    return true;
  }
  await fs.unlink(quarantine);
  return false;
}

async function managedCacheBytes(userDataDir: string, stopAfter = Number.POSITIVE_INFINITY): Promise<number> {
  let total = 0;
  for (const path of MANAGED_CACHE_PATHS) {
    total += await directoryBytes(join(userDataDir, path), stopAfter - total);
    if (total >= stopAfter) break;
  }
  return total;
}

async function directoryBytes(root: string, stopAfter: number): Promise<number> {
  const directories = [root];
  let total = 0;
  while (directories.length > 0) {
    const directory = directories.pop()!;
    let entries: import('fs').Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    const files: string[] = [];
    for (const entry of entries) {
      const child = join(directory, entry.name);
      if (entry.isDirectory()) directories.push(child);
      else if (entry.isFile()) files.push(child);
    }
    for (let offset = 0; offset < files.length; offset += 64) {
      const sizes = await Promise.all(files.slice(offset, offset + 64).map(async (file) => {
        try {
          return (await fs.stat(file)).size;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 0;
          throw error;
        }
      }));
      total += sizes.reduce((sum, size) => sum + size, 0);
      if (total >= stopAfter) return total;
    }
  }
  return total;
}

async function readState(path: string): Promise<MaintenanceState | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(path, 'utf-8')) as MaintenanceState;
    return Number.isFinite(parsed?.lastCheckedAt) ? parsed : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
    throw error;
  }
}

async function writeState(path: string, state: MaintenanceState): Promise<void> {
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8');
    await fs.rename(tmp, path);
  } catch (error) {
    await fs.unlink(tmp).catch(() => undefined);
    throw error;
  }
}
