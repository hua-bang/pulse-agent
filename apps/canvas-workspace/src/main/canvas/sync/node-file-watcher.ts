import { promises as fs, watch as fsWatch, type FSWatcher } from 'fs';
import { getNodeFilePath, getNodesDir, isSafeNodeId } from '../persistence/paths';
import { visibleNodeFieldsChanged } from './snapshots';
import { broadcastExternalUpdate } from './workspace-watcher';

const SELF_WRITE_WINDOW_MS = 500;
const snapshots = new Map<string, Map<string, string>>();
const watchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, NodeJS.Timeout>();
const pendingNodeIds = new Map<string, Set<string>>();
const recentSelfWrites = new Map<string, Map<string, number>>();

const isEnoent = (error: unknown): boolean =>
  !!error && typeof error === 'object' && (error as { code?: string }).code === 'ENOENT';

export async function seedNodeFileSnapshot(workspaceId: string): Promise<void> {
  let entries: string[];
  try {
    entries = await fs.readdir(getNodesDir(workspaceId));
  } catch (error) {
    if (isEnoent(error)) {
      snapshots.delete(workspaceId);
      return;
    }
    console.warn(`[canvas-store] could not list nodes/ for ${workspaceId}:`, error);
    return;
  }

  const snapshot = new Map<string, string>();
  for (const name of entries) {
    if (!name.endsWith('.json')) continue;
    const nodeId = name.slice(0, -'.json'.length);
    if (!isSafeNodeId(nodeId)) continue;
    try {
      snapshot.set(nodeId, await fs.readFile(getNodeFilePath(workspaceId, nodeId), 'utf-8'));
    } catch {
      // Transient or deleted files are picked up by a later watcher event.
    }
  }
  snapshots.set(workspaceId, snapshot);
}

export function markNodeFileSelfWrites(workspaceId: string, nodeIds: Iterable<string>): void {
  const writes = recentSelfWrites.get(workspaceId) ?? new Map<string, number>();
  const now = Date.now();
  for (const nodeId of nodeIds) writes.set(nodeId, now);
  recentSelfWrites.set(workspaceId, writes);
}

async function handleBatch(workspaceId: string): Promise<void> {
  const batch = pendingNodeIds.get(workspaceId);
  if (!batch?.size) return;
  pendingNodeIds.delete(workspaceId);

  const snapshot = snapshots.get(workspaceId) ?? new Map<string, string>();
  const selfWrites = recentSelfWrites.get(workspaceId);
  const now = Date.now();
  const changedNodeIds: string[] = [];

  for (const nodeId of batch) {
    let raw: string;
    try {
      raw = await fs.readFile(getNodeFilePath(workspaceId, nodeId), 'utf-8');
    } catch (error) {
      if (isEnoent(error) && snapshot.has(nodeId)) {
        snapshot.delete(nodeId);
        changedNodeIds.push(nodeId);
      }
      continue;
    }

    const previous = snapshot.get(nodeId);
    snapshot.set(nodeId, raw);
    if (previous === raw) continue;
    if (previous !== undefined && !visibleNodeFieldsChanged(previous, raw)) continue;
    const selfWriteAt = selfWrites?.get(nodeId);
    if (selfWriteAt !== undefined && now - selfWriteAt <= SELF_WRITE_WINDOW_MS) continue;
    changedNodeIds.push(nodeId);
  }

  if (selfWrites) {
    for (const [nodeId, writtenAt] of selfWrites) {
      if (now - writtenAt > SELF_WRITE_WINDOW_MS) selfWrites.delete(nodeId);
    }
    if (selfWrites.size === 0) recentSelfWrites.delete(workspaceId);
  }

  snapshots.set(workspaceId, snapshot);
  if (changedNodeIds.length > 0) broadcastExternalUpdate(workspaceId, changedNodeIds);
}

export function startNodeFileWatcher(workspaceId: string): void {
  if (watchers.has(workspaceId)) return;
  let watcher: FSWatcher;
  try {
    watcher = fsWatch(getNodesDir(workspaceId), { persistent: false });
  } catch (error) {
    if (!isEnoent(error)) console.warn(`[canvas-store] nodes/ watch failed for ${workspaceId}:`, error);
    return;
  }
  watcher.on('change', (_eventType, filename) => {
    if (typeof filename !== 'string' || !filename.endsWith('.json') || filename.endsWith('.tmp')) return;
    const nodeId = filename.slice(0, -'.json'.length);
    if (!isSafeNodeId(nodeId)) return;
    const pending = pendingNodeIds.get(workspaceId) ?? new Set<string>();
    pending.add(nodeId);
    pendingNodeIds.set(workspaceId, pending);
    const existing = debounceTimers.get(workspaceId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceTimers.delete(workspaceId);
      void handleBatch(workspaceId);
    }, 100);
    debounceTimers.set(workspaceId, timer);
  });
  watcher.on('error', (error) => {
    console.warn(`[canvas-store] nodes/ watcher error for ${workspaceId}:`, error);
  });
  watchers.set(workspaceId, watcher);
}

export function stopNodeFileWatcher(workspaceId: string): void {
  const watcher = watchers.get(workspaceId);
  if (watcher) {
    try { watcher.close(); } catch { /* ignore */ }
  }
  watchers.delete(workspaceId);
  const timer = debounceTimers.get(workspaceId);
  if (timer) clearTimeout(timer);
  debounceTimers.delete(workspaceId);
  pendingNodeIds.delete(workspaceId);
  snapshots.delete(workspaceId);
  recentSelfWrites.delete(workspaceId);
}

export function watchedNodeFileWorkspaceIds(): string[] {
  return Array.from(watchers.keys());
}
