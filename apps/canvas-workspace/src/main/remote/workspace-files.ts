import { extname } from 'node:path';
import { isStorageError, type PulseStorage } from '@pulse-coder/storage';
import {
  getRemoteWorkspaceConfig,
  isRemoteRuntimeEnabled,
  isRemoteStorageEnabled,
  matchRemoteWorkspaceFile,
} from './config';
import { getRemoteCanvasBackend, getRemoteWorkspaceFiles, resolveRemoteWorkspaceTarget } from './client';

export { matchRemoteWorkspaceFile };

const MIME_BY_EXT: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.avif': 'image/avif',
  '.pdf': 'application/pdf',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function inferMimeType(filePath: string): string {
  return MIME_BY_EXT[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

const REMOTE_BINARY_CACHE_MAX_ITEMS = 64;
const REMOTE_BINARY_CACHE_MAX_BYTES = 32 * 1024 * 1024;
const REMOTE_BINARY_CACHE_TTL_MS = 5 * 60_000;

interface CachedBinaryFile {
  bytes: Uint8Array;
  mimeType: string;
  cachedAt: number;
}

const remoteBinaryCache = new Map<string, CachedBinaryFile>();
let remoteBinaryCacheBytes = 0;

function readCachedBinary(key: string): { bytes: Uint8Array; mimeType: string } | null {
  const entry = remoteBinaryCache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.cachedAt > REMOTE_BINARY_CACHE_TTL_MS) {
    remoteBinaryCache.delete(key);
    remoteBinaryCacheBytes -= entry.bytes.byteLength;
    return null;
  }
  // Refresh LRU order.
  remoteBinaryCache.delete(key);
  remoteBinaryCache.set(key, entry);
  return { bytes: entry.bytes, mimeType: entry.mimeType };
}

function writeCachedBinary(key: string, bytes: Uint8Array, mimeType: string): void {
  if (bytes.byteLength > REMOTE_BINARY_CACHE_MAX_BYTES / 2) return;
  const existing = remoteBinaryCache.get(key);
  if (existing) {
    remoteBinaryCacheBytes -= existing.bytes.byteLength;
    remoteBinaryCache.delete(key);
  }
  while (
    remoteBinaryCache.size >= REMOTE_BINARY_CACHE_MAX_ITEMS ||
    remoteBinaryCacheBytes + bytes.byteLength > REMOTE_BINARY_CACHE_MAX_BYTES
  ) {
    const oldestKey = remoteBinaryCache.keys().next().value;
    if (!oldestKey) break;
    const oldest = remoteBinaryCache.get(oldestKey);
    remoteBinaryCache.delete(oldestKey);
    if (oldest) remoteBinaryCacheBytes -= oldest.bytes.byteLength;
  }
  remoteBinaryCache.set(key, { bytes, mimeType, cachedAt: Date.now() });
  remoteBinaryCacheBytes += bytes.byteLength;
}

export async function tryReadRemoteBinaryFile(
  filePath: string,
): Promise<{ bytes: Uint8Array; mimeType: string } | null> {
  const matched = matchRemoteWorkspaceFile(filePath);
  if (!matched) return null;
  const cacheKey = `${matched.workspaceId}::${matched.relPath}`;
  const cached = readCachedBinary(cacheKey);
  if (cached) return cached;
  const remote = await getRemoteWorkspaceFiles(matched.workspaceId);
  if (!remote) return null;
  try {
    const uri = `pulse-remote:///${remote.target.remoteWorkspaceId}/${matched.relPath}`;
    const read = await remote.files.readBytes(uri);
    if (!read) return null;
    const mimeType = inferMimeType(filePath);
    writeCachedBinary(cacheKey, read.bytes, mimeType);
    return { bytes: read.bytes, mimeType };
  } catch {
    return null;
  }
}

export async function tryWriteRemoteBinaryFile(
  filePath: string,
  bytes: Uint8Array,
): Promise<boolean> {
  const matched = matchRemoteWorkspaceFile(filePath);
  if (!matched) return false;
  if (getRemoteWorkspaceConfig(matched.workspaceId)?.shareRole === 'viewer') return true;
  const remote = await getRemoteWorkspaceFiles(matched.workspaceId);
  if (!remote) return false;
  try {
    const uri = `pulse-remote:///${remote.target.remoteWorkspaceId}/${matched.relPath}`;
    await remote.files.write(uri, bytes);
    writeCachedBinary(`${matched.workspaceId}::${matched.relPath}`, bytes, inferMimeType(filePath));
    return true;
  } catch (error) {
    console.warn(`[remote-workspace] failed to upload binary file ${matched.relPath}:`, error);
    return false;
  }
}

export async function readRemoteWorkspaceText(
  workspaceId: string,
  relPath: string,
): Promise<{ exists: boolean; content: string } | null> {
  const remote = await getRemoteWorkspaceFiles(workspaceId);
  if (!remote) return null;
  const cleanRel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanRel || cleanRel.includes('..')) return null;
  try {
    const uri = `pulse-remote:///${remote.target.remoteWorkspaceId}/${cleanRel}`;
    const read = await remote.files.readText(uri);
    if (!read) return { exists: false, content: '' };
    return { exists: true, content: read.content };
  } catch (error) {
    console.warn(`[remote-workspace] failed to read ${cleanRel} for ${workspaceId}:`, error);
    return null;
  }
}

export async function writeRemoteWorkspaceText(
  workspaceId: string,
  relPath: string,
  content: string,
): Promise<boolean> {
  const cfg = getRemoteWorkspaceConfig(workspaceId);
  if (!cfg || !isRemoteStorageEnabled(cfg)) return false;
  if (cfg.shareRole === 'viewer') return true;
  const remote = await getRemoteWorkspaceFiles(workspaceId);
  if (!remote) return false;
  const cleanRel = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  if (!cleanRel || cleanRel.includes('..')) return false;
  try {
    const uri = `pulse-remote:///${remote.target.remoteWorkspaceId}/${cleanRel}`;
    await remote.files.write(uri, content);
    return true;
  } catch (error) {
    console.warn(`[remote-workspace] failed to write ${cleanRel} for ${workspaceId}:`, error);
    return false;
  }
}

export async function readRemoteWorkspaceDocById(workspaceId: string): Promise<string | null> {
  const cfg = getRemoteWorkspaceConfig(workspaceId);
  if (!cfg || (!isRemoteStorageEnabled(cfg) && !isRemoteRuntimeEnabled(cfg))) return null;
  const target = await resolveRemoteWorkspaceTarget(workspaceId);
  if (!target) return null;
  const dir = cfg.cwd?.trim();
  const qs = dir ? `?cwd=${encodeURIComponent(dir)}` : '';
  try {
    const res = await fetch(`${target.endpoint}/v1/workspace-doc${qs}`, {
      headers: { Authorization: `Bearer ${target.token}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { ok?: boolean; exists?: boolean; content?: string };
    return data.ok && data.exists && typeof data.content === 'string' ? data.content : null;
  } catch {
    return null;
  }
}

export async function getRemoteConversationStorage(workspaceId: string): Promise<{
  storage: PulseStorage;
  scopeId: string;
} | null> {
  const cfg = getRemoteWorkspaceConfig(workspaceId);
  if (!cfg || !isRemoteStorageEnabled(cfg)) return null;
  const resolved = await getRemoteCanvasBackend(workspaceId);
  if (!resolved) return null;
  return {
    storage: resolved.storage,
    scopeId: resolved.target.remoteWorkspaceId,
  };
}

interface SyncableScheduledTask {
  id: string;
  updatedAt: number;
  lastAttemptAt?: number;
  runCount: number;
}

async function resolveRemoteScheduledWorkspaceId(): Promise<string | null> {
  const { listConfiguredRemoteWorkspaceIds } = await import('./config');
  for (const wsId of listConfiguredRemoteWorkspaceIds()) {
    const cfg = getRemoteWorkspaceConfig(wsId);
    // Only mirror global scheduled tasks to self-owned VPS workspaces, never guest shared workspaces.
    if (cfg && isRemoteStorageEnabled(cfg) && !cfg.shareRole) {
      return wsId;
    }
  }
  return null;
}

export interface SyncableScheduledState<T> {
  tasks: T[];
  /** Task id -> deletion time. Without it a device that still has the task re-adds it. */
  deletedTaskIds?: Record<string, number>;
}

const TOMBSTONE_TTL_MS = 30 * 24 * 60 * 60_000;

function taskScore(task: SyncableScheduledTask): number {
  return Math.max(task.updatedAt, task.lastAttemptAt ?? 0);
}

/** Union by id, newest copy wins; a deletion newer than every copy removes the task. */
export function mergeScheduledTaskStates<T extends SyncableScheduledTask>(
  local: SyncableScheduledState<T>,
  remote: SyncableScheduledState<T>,
  now = Date.now(),
): Required<SyncableScheduledState<T>> {
  const deletedTaskIds: Record<string, number> = {};
  for (const source of [local.deletedTaskIds, remote.deletedTaskIds]) {
    for (const [id, at] of Object.entries(source ?? {})) {
      if (typeof at !== 'number' || now - at > TOMBSTONE_TTL_MS) continue;
      deletedTaskIds[id] = Math.max(deletedTaskIds[id] ?? 0, at);
    }
  }
  const byId = new Map<string, T>();
  for (const task of local.tasks) byId.set(task.id, task);
  for (const r of remote.tasks) {
    const l = byId.get(r.id);
    if (!l) {
      byId.set(r.id, r);
      continue;
    }
    const rScore = taskScore(r);
    const lScore = taskScore(l);
    if (rScore > lScore || (rScore === lScore && r.runCount > l.runCount)) {
      byId.set(r.id, r);
    }
  }
  for (const [id, task] of byId) {
    const deletedAt = deletedTaskIds[id];
    if (deletedAt !== undefined && deletedAt >= taskScore(task)) byId.delete(id);
  }
  return { tasks: Array.from(byId.values()), deletedTaskIds };
}

export async function readMergedRemoteScheduledTasks<T extends SyncableScheduledTask>(
  local: SyncableScheduledState<T>,
  migrate: (raw: unknown) => T,
): Promise<SyncableScheduledState<T>> {
  const wsId = await resolveRemoteScheduledWorkspaceId();
  if (!wsId) return local;
  const remote = await readRemoteWorkspaceText(wsId, 'scheduled-tasks.json');
  if (!remote?.exists) return local;
  const parsed = JSON.parse(remote.content) as { tasks?: unknown[]; deletedTaskIds?: Record<string, number> };
  const remoteTasks = Array.isArray(parsed.tasks) ? parsed.tasks.map(migrate) : [];
  return mergeScheduledTaskStates(local, { tasks: remoteTasks, deletedTaskIds: parsed.deletedTaskIds });
}

/**
 * Writes the local state merged with the current remote copy, guarded by the
 * remote version. A blind overwrite would drop a change another device wrote
 * between our read and this write; on conflict, re-read and merge again.
 */
export async function mirrorRemoteScheduledTasks(serialized: string): Promise<void> {
  const wsId = await resolveRemoteScheduledWorkspaceId();
  if (!wsId) return;
  if (getRemoteWorkspaceConfig(wsId)?.shareRole === 'viewer') return;
  const remote = await getRemoteWorkspaceFiles(wsId);
  if (!remote) return;
  const uri = `pulse-remote:///${remote.target.remoteWorkspaceId}/scheduled-tasks.json`;
  const local = JSON.parse(serialized) as SyncableScheduledState<SyncableScheduledTask> & { version?: number };
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = await remote.files.readText(uri);
    let next = local;
    if (current) {
      const parsed = JSON.parse(current.content) as SyncableScheduledState<SyncableScheduledTask>;
      next = {
        ...local,
        ...mergeScheduledTaskStates(local, {
          tasks: Array.isArray(parsed.tasks) ? parsed.tasks : [],
          deletedTaskIds: parsed.deletedTaskIds,
        }),
      };
    }
    try {
      await remote.files.write(uri, JSON.stringify(next, null, 2), {
        expectedVersion: current ? current.version : null,
      });
      return;
    } catch (error) {
      if (!isStorageError(error) || error.code !== 'revision_conflict') throw error;
    }
  }
}

export async function tryServeRemoteProtocolFile(normalizedPath: string): Promise<Response | null> {
  try {
    const remote = await tryReadRemoteBinaryFile(normalizedPath);
    if (!remote) return null;
    return new Response(Buffer.from(remote.bytes), {
      status: 200,
      headers: { 'Content-Type': remote.mimeType, 'Cache-Control': 'no-store' },
    });
  } catch {
    return null;
  }
}

export async function tryMirrorLocalPathToRemote(filePath: string): Promise<void> {
  try {
    const { readFile } = await import('node:fs/promises');
    await tryWriteRemoteBinaryFile(filePath, await readFile(filePath));
  } catch {
    // Best-effort mirror; local write already succeeded.
  }
}

export async function tryReadRemoteWorkspaceMemory(workspaceId: string): Promise<{ exists: boolean; content: string } | null> {
  try {
    return await readRemoteWorkspaceText(workspaceId, 'memory.json');
  } catch {
    return null;
  }
}

export async function tryWriteRemoteWorkspaceMemory(workspaceId: string, body: string): Promise<boolean> {
  try {
    return await writeRemoteWorkspaceText(workspaceId, 'memory.json', body);
  } catch {
    return false;
  }
}



