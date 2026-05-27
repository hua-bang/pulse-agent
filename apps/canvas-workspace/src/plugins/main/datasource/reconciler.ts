/**
 * Datasource reconciler — keeps `(persisted spec) × (canvas node) ×
 * (running child)` in sync.
 *
 * One pass walks every persisted spec and decides:
 *   - spec but no matching iframe node on canvas → orphan. Stop the
 *     child (if any) and delete the spec.
 *   - spec + node, no running child → respawn. Patch the node's data.url
 *     with the new loopback port and broadcast a canvas update so the
 *     renderer iframe reloads.
 *   - spec + node + running child → no-op.
 *
 * Then walks every currently-running child and stops any whose spec has
 * disappeared from disk (covers external spec deletion / corruption).
 *
 * Scheduled at activate time on a 30s timer. NOT triggered by
 * `canvas:save` because hooking that path means modifying the canvas
 * store module — keeping the reconciler self-contained matters more
 * than the up-to-30s latency on a delete.
 */

import {
  readCanvasFull,
  writeCanvasFull,
  type CanvasNode,
  type CanvasSaveData,
} from "../../../main/canvas/storage";
import { broadcastCanvasUpdate } from "../../../main/canvas/broadcast";
import { deleteSpec, listAllSpecs } from "./store";
import type { DataSourceManager } from "./manager";

interface NodeMatch {
  canvas: CanvasSaveData;
  node: CanvasNode;
  nodeIndex: number;
}

const RECONCILE_INTERVAL_MS = 30_000;
const INITIAL_DELAY_MS = 1_500;
/**
 * Skip reaping running children younger than this. Covers the brief
 * window between `manager.start()` resolving and the caller writing
 * the canvas node / persisting the spec — without this guard a tick
 * landing mid-create would see "no spec, running child" and kill it.
 */
const CREATE_GRACE_MS = 10_000;

async function findDatasourceNode(
  workspaceId: string,
  datasourceNodeId: string,
): Promise<NodeMatch | null> {
  let canvas: CanvasSaveData | null;
  try {
    const result = await readCanvasFull(workspaceId);
    canvas = (result.data as CanvasSaveData | null) ?? null;
  } catch {
    return null;
  }
  if (!canvas?.nodes) return null;
  for (let i = 0; i < canvas.nodes.length; i += 1) {
    const node = canvas.nodes[i];
    const data = node.data as Record<string, unknown> | undefined;
    // Match on the `datasourceNodeId` marker alone — `mode` is left as
    // the default 'url' so the iframe renderer auto-loads it.
    if (
      node.type === "iframe" &&
      data?.datasourceNodeId === datasourceNodeId
    ) {
      return { canvas, node, nodeIndex: i };
    }
  }
  return null;
}

async function patchNodeUrl(
  workspaceId: string,
  match: NodeMatch,
  url: string,
): Promise<void> {
  const node = match.node;
  node.data = { ...(node.data ?? {}), url };
  node.updatedAt = Date.now();
  match.canvas.savedAt = new Date().toISOString();
  await writeCanvasFull(workspaceId, match.canvas);
  if (node.id) {
    broadcastCanvasUpdate(
      workspaceId,
      [node.id],
      "update",
      "datasource-plugin",
    );
  }
}

export async function reconcileOnce(
  manager: DataSourceManager,
): Promise<void> {
  let entries;
  try {
    entries = await listAllSpecs();
  } catch (err) {
    console.warn("[datasource] reconcile: listAllSpecs failed", err);
    return;
  }

  const runningList = manager.list();
  const runningIds = new Set(runningList.map((i) => i.id));
  const startedAtById = new Map(runningList.map((i) => [i.id, i.startedAt]));
  const persistedIds = new Set<string>();
  const now = Date.now();

  for (const { workspaceId, datasourceNodeId, persisted } of entries) {
    persistedIds.add(datasourceNodeId);

    // Skip every action this tick for children still inside the create
    // grace window — their canvas node may not be on disk yet.
    if (runningIds.has(datasourceNodeId)) {
      const startedAt = startedAtById.get(datasourceNodeId) ?? 0;
      if (now - startedAt < CREATE_GRACE_MS) continue;
    }

    const match = await findDatasourceNode(workspaceId, datasourceNodeId);

    if (!match) {
      // Orphan: no canvas node references this spec. Tear down.
      if (runningIds.has(datasourceNodeId)) {
        await manager.stop(datasourceNodeId).catch(() => undefined);
      }
      await deleteSpec(workspaceId, datasourceNodeId).catch((err) => {
        console.warn(
          `[datasource] reconcile: delete orphan ${workspaceId}/${datasourceNodeId} failed`,
          err,
        );
      });
      continue;
    }

    if (runningIds.has(datasourceNodeId)) continue;

    // Node exists, child missing. Respawn.
    try {
      const { url } = await manager.start(
        workspaceId,
        datasourceNodeId,
        persisted.spec,
      );
      await patchNodeUrl(workspaceId, match, url);
      console.info(
        `[datasource] respawned ${datasourceNodeId} (workspace=${workspaceId}) → ${url}`,
      );
    } catch (err) {
      console.warn(
        `[datasource] respawn ${datasourceNodeId} failed:`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  // Stop any running children whose spec is gone from disk. Skip
  // children spawned within the grace window — their spec / node
  // writes may still be in flight from the create tool.
  for (const id of runningIds) {
    if (persistedIds.has(id)) continue;
    const startedAt = startedAtById.get(id) ?? 0;
    if (now - startedAt < CREATE_GRACE_MS) continue;
    await manager.stop(id).catch(() => undefined);
  }
}

export function startReconciler(manager: DataSourceManager): () => void {
  let timer: NodeJS.Timeout | null = null;
  let stopped = false;
  let running = false;

  const tick = async (): Promise<void> => {
    if (stopped || running) return;
    running = true;
    try {
      await reconcileOnce(manager);
    } catch (err) {
      console.warn("[datasource] reconcile tick failed:", err);
    } finally {
      running = false;
      if (!stopped) {
        timer = setTimeout(() => void tick(), RECONCILE_INTERVAL_MS);
      }
    }
  };

  timer = setTimeout(() => void tick(), INITIAL_DELAY_MS);

  return () => {
    stopped = true;
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  };
}
