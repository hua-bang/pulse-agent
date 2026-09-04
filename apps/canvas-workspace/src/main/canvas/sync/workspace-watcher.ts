import { BrowserWindow } from 'electron';
import { promises as fs, watch as fsWatch, type FSWatcher } from 'fs';
import { getCanvasJsonPath } from '../persistence/paths';
import { edgesToMap, type SyncableEdge } from '../edge-sync';
import { diffSnapshots, itemsToMap } from './snapshots';

export interface SyncableCanvasNode {
  id?: string;
  updatedAt?: number;
  [key: string]: unknown;
}

interface CanvasSnapshot {
  nodes?: SyncableCanvasNode[];
  edges?: SyncableEdge[];
}

const watchers = new Map<string, FSWatcher>();
const debounceTimers = new Map<string, NodeJS.Timeout>();
const nodeSnapshots = new Map<string, Map<string, SyncableCanvasNode>>();
const edgeSnapshots = new Map<string, Map<string, SyncableEdge>>();

export function setWorkspaceSnapshot(
  workspaceId: string,
  nodes: SyncableCanvasNode[] | undefined,
  edges: SyncableEdge[] | undefined,
): void {
  nodeSnapshots.set(workspaceId, itemsToMap(nodes));
  edgeSnapshots.set(workspaceId, edgesToMap(edges));
}

export async function seedWorkspaceSnapshotFromDisk(workspaceId: string): Promise<void> {
  try {
    const parsed = JSON.parse(
      await fs.readFile(getCanvasJsonPath(workspaceId), 'utf-8'),
    ) as CanvasSnapshot;
    setWorkspaceSnapshot(workspaceId, parsed.nodes, parsed.edges);
  } catch {
    setWorkspaceSnapshot(workspaceId, [], []);
  }
}

export function broadcastExternalUpdate(
  workspaceId: string,
  nodeIds: string[],
  edgeIds: string[] = [],
): void {
  const payload = {
    type: 'canvas:updated' as const,
    workspaceId,
    nodeIds,
    edgeIds,
    source: 'fs-watch' as const,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('canvas:external-update', payload);
  }
}

async function handleWatcherFire(
  workspaceId: string,
  observeNodeIds: (workspaceId: string, nodeIds: Iterable<string>) => void,
): Promise<void> {
  let data: CanvasSnapshot;
  try {
    data = JSON.parse(await fs.readFile(getCanvasJsonPath(workspaceId), 'utf-8')) as CanvasSnapshot;
  } catch {
    return;
  }

  const nextNodes = itemsToMap(data.nodes);
  const nextEdges = edgesToMap(data.edges);
  const changedNodeIds = diffSnapshots(
    nodeSnapshots.get(workspaceId) ?? new Map(),
    nextNodes,
  );
  const changedEdgeIds = diffSnapshots(
    edgeSnapshots.get(workspaceId) ?? new Map(),
    nextEdges,
  );
  if (changedNodeIds.length === 0 && changedEdgeIds.length === 0) return;

  nodeSnapshots.set(workspaceId, nextNodes);
  edgeSnapshots.set(workspaceId, nextEdges);
  observeNodeIds(workspaceId, nextNodes.keys());
  broadcastExternalUpdate(workspaceId, changedNodeIds, changedEdgeIds);
}

export function startWorkspaceWatcher(
  workspaceId: string,
  observeNodeIds: (workspaceId: string, nodeIds: Iterable<string>) => void,
): void {
  if (watchers.has(workspaceId)) return;
  let watcher: FSWatcher;
  try {
    watcher = fsWatch(getCanvasJsonPath(workspaceId), { persistent: false });
  } catch (error) {
    console.warn(`[canvas-store] fs.watch failed for ${workspaceId}:`, error);
    return;
  }
  watcher.on('change', () => {
    const existing = debounceTimers.get(workspaceId);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      debounceTimers.delete(workspaceId);
      void handleWatcherFire(workspaceId, observeNodeIds);
    }, 100);
    debounceTimers.set(workspaceId, timer);
  });
  watcher.on('error', (error) => {
    console.warn(`[canvas-store] watcher error for ${workspaceId}:`, error);
  });
  watchers.set(workspaceId, watcher);
}

export function stopWorkspaceWatcher(workspaceId: string): void {
  const watcher = watchers.get(workspaceId);
  if (watcher) {
    try { watcher.close(); } catch { /* ignore */ }
    watchers.delete(workspaceId);
  }
  const timer = debounceTimers.get(workspaceId);
  if (timer) clearTimeout(timer);
  debounceTimers.delete(workspaceId);
  nodeSnapshots.delete(workspaceId);
  edgeSnapshots.delete(workspaceId);
}

export function watchedWorkspaceIds(): string[] {
  return Array.from(watchers.keys());
}
