import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'fs/promises';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resolveProfileCachePolicy, runProfileCacheMaintenance } from './profile-cache-maintenance';

describe('profile cache maintenance', () => {
  let userDataDir = '';

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), 'canvas-profile-cache-'));
  });

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true });
  });

  const writeSized = async (path: string, bytes: number) => {
    await mkdir(join(path, '..'), { recursive: true });
    await writeFile(path, Buffer.alloc(bytes, 1));
  };

  it('skips clearing below the threshold and respects the check cooldown', async () => {
    await writeSized(join(userDataDir, 'Cache', 'small.bin'), 32);
    const profileSession = {
      clearCache: vi.fn(async () => {}),
      clearCodeCaches: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
    };

    const first = await runProfileCacheMaintenance({
      userDataDir,
      profileSession,
      maxBytes: 1_000,
      checkIntervalMs: 60_000,
      now: () => 10_000,
    });
    const second = await runProfileCacheMaintenance({
      userDataDir,
      profileSession,
      maxBytes: 1_000,
      checkIntervalMs: 60_000,
      now: () => 20_000,
    });

    expect(first).toMatchObject({ checked: true, cleared: false, beforeBytes: 32 });
    expect(second).toMatchObject({ checked: false, cleared: false });
    expect(profileSession.clearCache).not.toHaveBeenCalled();
  });

  it('clears only reproducible caches and preserves login-bearing stores', async () => {
    const cacheFile = join(userDataDir, 'Cache', 'cache.bin');
    const codeFile = join(userDataDir, 'Code Cache', 'code.bin');
    const serviceWorkerFile = join(userDataDir, 'Service Worker', 'CacheStorage', 'sw.bin');
    const cookieFile = join(userDataDir, 'Cookies');
    const localStorageFile = join(userDataDir, 'Local Storage', 'leveldb', 'data');
    const indexedDbFile = join(userDataDir, 'IndexedDB', 'data');
    await Promise.all([
      writeSized(cacheFile, 100),
      writeSized(codeFile, 100),
      writeSized(serviceWorkerFile, 100),
      writeSized(cookieFile, 10),
      writeSized(localStorageFile, 10),
      writeSized(indexedDbFile, 10),
    ]);
    const profileSession = {
      clearCache: vi.fn(async () => { await unlink(cacheFile); }),
      clearCodeCaches: vi.fn(async () => { await unlink(codeFile); }),
      clearStorageData: vi.fn(async () => { await unlink(serviceWorkerFile); }),
    };

    const result = await runProfileCacheMaintenance({
      userDataDir,
      profileSession,
      maxBytes: 200,
      checkIntervalMs: 0,
      now: () => 30_000,
    });

    expect(result).toMatchObject({ checked: true, cleared: true, beforeBytes: 300, afterBytes: 0 });
    expect(profileSession.clearCodeCaches).toHaveBeenCalledWith({});
    expect(profileSession.clearStorageData).toHaveBeenCalledWith({
      storages: ['serviceworkers', 'cachestorage'],
    });
    await expect(readFile(cookieFile)).resolves.toHaveLength(10);
    await expect(readFile(localStorageFile)).resolves.toHaveLength(10);
    await expect(readFile(indexedDbFile)).resolves.toHaveLength(10);
  });

  it('supports disabling cleanup and clamps extreme policy values', () => {
    expect(resolveProfileCachePolicy({
      PULSE_CANVAS_PROFILE_CACHE_MAX_MB: '0',
      PULSE_CANVAS_PROFILE_CACHE_CHECK_HOURS: '999999',
      PULSE_CANVAS_PROFILE_CACHE_DELAY_MS: '-1',
    })).toEqual({
      maxBytes: 0,
      checkIntervalMs: 24 * 30 * 60 * 60 * 1_000,
      startupDelayMs: 0,
    });
  });

  it('bounds concurrent file stats on large profiles', async () => {
    const cacheDir = join(userDataDir, 'Cache');
    await Promise.all(Array.from({ length: 200 }, (_, index) => (
      writeSized(join(cacheDir, `${index}.bin`), 1)
    )));
    const realStat = fs.stat.bind(fs);
    let active = 0;
    let maxActive = 0;
    vi.spyOn(fs, 'stat').mockImplementation(async (path) => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise(resolve => setTimeout(resolve, 1));
      try {
        return await realStat(path);
      } finally {
        active -= 1;
      }
    });
    const profileSession = {
      clearCache: vi.fn(async () => {}),
      clearCodeCaches: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
    };

    await runProfileCacheMaintenance({
      userDataDir, profileSession, maxBytes: 1_000, checkIntervalMs: 0,
    });

    expect(maxActive).toBeLessThanOrEqual(64);
  });

  it('records a cooldown after a cache API failure', async () => {
    await writeSized(join(userDataDir, 'Cache', 'large.bin'), 300);
    const profileSession = {
      clearCache: vi.fn(async () => { throw new Error('clear failed'); }),
      clearCodeCaches: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
    };

    await expect(runProfileCacheMaintenance({
      userDataDir, profileSession, maxBytes: 100, checkIntervalMs: 60_000, now: () => 10_000,
    })).rejects.toThrow('clear failed');
    const retry = await runProfileCacheMaintenance({
      userDataDir, profileSession, maxBytes: 100, checkIntervalMs: 60_000, now: () => 20_000,
    });

    expect(retry.checked).toBe(false);
    expect(profileSession.clearCache).toHaveBeenCalledTimes(1);
  });

  it('stops traversing nested cache directories once the threshold is exceeded', async () => {
    await writeSized(join(userDataDir, 'Cache', 'root.bin'), 100);
    await Promise.all(Array.from({ length: 40 }, (_, index) => (
      writeSized(join(userDataDir, 'Cache', `nested-${index}`, 'file.bin'), 1)
    )));
    const realReaddir = fs.readdir.bind(fs);
    let cacheReaddirs = 0;
    vi.spyOn(fs, 'readdir').mockImplementation(async (path, options) => {
      if (String(path).includes(join(userDataDir, 'Cache'))) cacheReaddirs += 1;
      return realReaddir(path, options as never) as never;
    });
    const profileSession = {
      clearCache: vi.fn(async () => { throw new Error('stop after measurement'); }),
      clearCodeCaches: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
    };

    await expect(runProfileCacheMaintenance({
      userDataDir, profileSession, maxBytes: 10, checkIntervalMs: 0,
    })).rejects.toThrow('stop after measurement');

    expect(cacheReaddirs).toBe(1);
  });

  it('uses an atomic lease so concurrent maintenance clears once', async () => {
    await writeSized(join(userDataDir, 'Cache', 'large.bin'), 300);
    let releaseClear: (() => void) | undefined;
    const clearGate = new Promise<void>(resolve => { releaseClear = resolve; });
    const profileSession = {
      clearCache: vi.fn(() => clearGate),
      clearCodeCaches: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
    };
    const first = runProfileCacheMaintenance({
      userDataDir, profileSession, maxBytes: 100, checkIntervalMs: 0,
    });
    await vi.waitFor(() => expect(profileSession.clearCache).toHaveBeenCalledTimes(1));

    const concurrent = await runProfileCacheMaintenance({
      userDataDir, profileSession, maxBytes: 100, checkIntervalMs: 0,
    });
    releaseClear?.();
    await first;

    expect(concurrent).toEqual({ checked: false, cleared: false });
    expect(profileSession.clearCache).toHaveBeenCalledTimes(1);
  });

  it('allows only one contender to replace a stale lease', async () => {
    await writeSized(join(userDataDir, 'Cache', 'large.bin'), 300);
    const leaseDir = join(userDataDir, 'profile-cache-maintenance.leases');
    const stalePath = join(leaseDir, 'stale.lease');
    await mkdir(leaseDir, { recursive: true });
    await writeFile(stalePath, 'stale', 'utf-8');
    await fs.utimes(stalePath, new Date(0), new Date(0));
    const profileSession = {
      clearCache: vi.fn(async () => {}),
      clearCodeCaches: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
    };

    const results = await Promise.all([
      runProfileCacheMaintenance({ userDataDir, profileSession, maxBytes: 100, checkIntervalMs: 0 }),
      runProfileCacheMaintenance({ userDataDir, profileSession, maxBytes: 100, checkIntervalMs: 0 }),
    ]);

    expect(results.filter(result => result.checked).length).toBeLessThanOrEqual(1);
    expect(profileSession.clearCache.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('does not let an old holder remove a replacement lease', async () => {
    await writeSized(join(userDataDir, 'Cache', 'large.bin'), 300);
    let releaseClear: (() => void) | undefined;
    const clearGate = new Promise<void>(resolve => { releaseClear = resolve; });
    const profileSession = {
      clearCache: vi.fn(() => clearGate),
      clearCodeCaches: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
    };
    const run = runProfileCacheMaintenance({
      userDataDir, profileSession, maxBytes: 100, checkIntervalMs: 0,
    });
    await vi.waitFor(() => expect(profileSession.clearCache).toHaveBeenCalled());
    const leaseDir = join(userDataDir, 'profile-cache-maintenance.leases');
    const [oldLease] = await fs.readdir(leaseDir);
    const replacement = join(leaseDir, 'replacement.lease');
    await writeFile(replacement, 'replacement-owner', 'utf-8');

    releaseClear?.();
    await run;

    expect(await readFile(replacement, 'utf-8')).toBe('replacement-owner');
    expect(await fs.readdir(leaseDir)).not.toContain(oldLease);
  });

  it('removes its own lease when acquisition scanning fails', async () => {
    const leaseDir = join(userDataDir, 'profile-cache-maintenance.leases');
    const realReaddir = fs.readdir.bind(fs);
    let failed = false;
    vi.spyOn(fs, 'readdir').mockImplementation(async (path, options) => {
      if (!failed && String(path) === leaseDir) {
        failed = true;
        throw Object.assign(new Error('lease scan failed'), { code: 'EMFILE' });
      }
      return realReaddir(path, options as never) as never;
    });
    const profileSession = {
      clearCache: vi.fn(async () => {}),
      clearCodeCaches: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
    };

    await expect(runProfileCacheMaintenance({
      userDataDir, profileSession, maxBytes: 100, checkIntervalMs: 0,
    })).rejects.toThrow('lease scan failed');

    expect((await realReaddir(leaseDir)).filter(file => file.endsWith('.lease'))).toEqual([]);
  });

  it('restores a stale lease that heartbeats before quarantine', async () => {
    const leaseDir = join(userDataDir, 'profile-cache-maintenance.leases');
    const stalePath = join(leaseDir, 'heartbeat.lease');
    await mkdir(leaseDir, { recursive: true });
    await writeFile(stalePath, 'heartbeat-owner', 'utf-8');
    await fs.utimes(stalePath, new Date(0), new Date(0));
    const realRename = fs.rename.bind(fs);
    let quarantined: (() => void) | undefined;
    let resume: (() => void) | undefined;
    const quarantineReached = new Promise<void>(resolve => { quarantined = resolve; });
    const quarantineGate = new Promise<void>(resolve => { resume = resolve; });
    vi.spyOn(fs, 'rename').mockImplementation(async (from, to) => {
      if (String(from) !== stalePath) return realRename(from, to);
      await fs.utimes(stalePath, new Date(), new Date());
      const result = await realRename(from, to);
      quarantined?.();
      await quarantineGate;
      return result;
    });
    const profileSession = {
      clearCache: vi.fn(async () => {}),
      clearCodeCaches: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
    };

    const first = runProfileCacheMaintenance({
      userDataDir, profileSession, maxBytes: 100, checkIntervalMs: 0,
    });
    await quarantineReached;
    const contender = await runProfileCacheMaintenance({
      userDataDir, profileSession, maxBytes: 100, checkIntervalMs: 0,
    });
    resume?.();
    const result = await first;

    expect(result.checked).toBe(false);
    expect(contender.checked).toBe(false);
    expect(await readFile(stalePath, 'utf-8')).toBe('heartbeat-owner');
    expect(profileSession.clearCache).not.toHaveBeenCalled();
  });

  it('recovers from an orphaned stale quarantine lease', async () => {
    await writeSized(join(userDataDir, 'Cache', 'large.bin'), 300);
    const leaseDir = join(userDataDir, 'profile-cache-maintenance.leases');
    const orphan = join(leaseDir, 'crashed.quarantine-old.lease');
    await mkdir(leaseDir, { recursive: true });
    await writeFile(orphan, 'crashed-owner', 'utf-8');
    await fs.utimes(orphan, new Date(0), new Date(0));
    const profileSession = {
      clearCache: vi.fn(async () => {}),
      clearCodeCaches: vi.fn(async () => {}),
      clearStorageData: vi.fn(async () => {}),
    };

    const result = await runProfileCacheMaintenance({
      userDataDir, profileSession, maxBytes: 100, checkIntervalMs: 0,
    });

    expect(result).toMatchObject({ checked: true, cleared: true });
    await expect(fs.stat(orphan)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
