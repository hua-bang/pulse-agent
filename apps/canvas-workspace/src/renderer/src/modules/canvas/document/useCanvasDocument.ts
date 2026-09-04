import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  CanvasEdge,
  CanvasNode,
  CanvasSaveData,
  CanvasTransform,
} from '../../../types';
import { count } from '../../../perf/counters';
import {
  mergeExternalDocumentUpdate,
  shouldReloadForExternalUpdate,
} from './externalMerge';
import { useCanvasDocumentHistory } from './useCanvasDocumentHistory';
import { useCanvasContentCommands } from './useCanvasContentCommands';
import { useCanvasCoreCommands } from './useCanvasCoreCommands';
import { useMindmapTransfers } from './useMindmapTransfers';
export type { AddNodeOptions } from './useCanvasContentCommands';

const SAVE_DEBOUNCE_MS = 800;
const DEFAULT_CANVAS_ID = 'default';

export const useCanvasDocument = (
  canvasId = DEFAULT_CANVAS_ID,
  onRestoreTransform?: (t: CanvasTransform) => void,
  /** Fires once per CLI-created node detected via the external-update
   *  socket. The hook hides update/delete events from the callback so
   *  callers can treat it strictly as "Agent introduced a new node".
   *  Stored in a ref so callback identity changes don't tear down the
   *  subscription effect on every render. */
  onAgentCreated?: (node: CanvasNode) => void,
  /** Invoked when a save fails to persist (store rejection or IPC
   *  error). The canvas surfaces a retry toast — without this, failed
   *  saves were console.warn-only and edits could be silently lost. */
  onSaveError?: () => void,
) => {
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transformRef = useRef<CanvasTransform>({ x: 0, y: 0, scale: 1 });
  const onRestoreTransformRef = useRef(onRestoreTransform);
  onRestoreTransformRef.current = onRestoreTransform;
  const onAgentCreatedRef = useRef(onAgentCreated);
  onAgentCreatedRef.current = onAgentCreated;
  const onSaveErrorRef = useRef(onSaveError);
  onSaveErrorRef.current = onSaveError;

  /**
   * Mirrors `loaded` state so `doSave`/`flushSave` (stable callbacks) can
   * synchronously check it without re-creating on every render. We refuse
   * any save before the initial load completes — otherwise an early
   * `beforeunload` / unmount flushSave can persist an empty node list
   * over the real data on disk.
   */
  const loadedRef = useRef(false);

  /**
   * Ids that have been confirmed on disk in this session — either seeded
   * from the initial load or from a completed save. The `onExternalUpdate`
   * handler uses this to distinguish "CLI deleted a persisted node" (drop)
   * from "renderer just created a node whose save is still debounced"
   * (keep). Without this guard, a watcher fire that arrives while an
   * add-node save is still pending would treat the fresh in-memory node
   * as a CLI delete and wipe it from the canvas.
   */
  const persistedIdsRef = useRef<Set<string>>(new Set());
  const persistedEdgeIdsRef = useRef<Set<string>>(new Set());

  const doSave = useCallback(() => {
    if (!loadedRef.current) {
      console.debug(`[canvas] save skipped for ${canvasId}: not yet loaded`);
      return;
    }
    const api = window.canvasWorkspace?.store;
    if (!api) {
      console.warn('[canvas] save skipped: store API unavailable');
      return;
    }
    const snapshot = nodesRef.current;
    const edgeSnapshot = edgesRef.current;
    const payload: CanvasSaveData = {
      nodes: snapshot,
      edges: edgeSnapshot,
      transform: transformRef.current,
      savedAt: new Date().toISOString(),
    };
    console.debug(
      `[canvas] saving ${canvasId}: ${payload.nodes.length} nodes, ${edgeSnapshot.length} edges`,
    );
    count('canvas-save-ipc');
    void api.save(canvasId, payload).then((res) => {
      if (!res.ok) {
        console.warn('[canvas] save failed:', res.error);
        onSaveErrorRef.current?.();
        return;
      }
      // Save succeeded — every id we just persisted is now on disk, so
      // it's safe for the external-update handler to treat future
      // disk-absence of these ids as "deleted elsewhere".
      for (const n of snapshot) persistedIdsRef.current.add(n.id);
      for (const edge of edgeSnapshot) persistedEdgeIdsRef.current.add(edge.id);
    }).catch((err) => {
      console.warn('[canvas] save failed:', err);
      onSaveErrorRef.current?.();
    });
  }, [canvasId]);

  const scheduleSave = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      doSave();
    }, SAVE_DEBOUNCE_MS);
  }, [doSave]);

  /** Flush any pending debounced save immediately. */
  const flushSave = useCallback(() => {
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    doSave();
  }, [doSave]);

  const [loaded, setLoaded] = useState(false);

  const {
    nodes, edges, nodesRef, edgesRef,
    applyNodes, applyEdges, applyState, replaceState, resetState,
    commitHistory, undo, redo,
  } = useCanvasDocumentHistory(scheduleSave);
  const { mergeMindmapTopic, splitMindmapTopic } = useMindmapTransfers({
    nodesRef, edgesRef, applyState,
  });

  const setTransformForSave = useCallback(
    (t: CanvasTransform) => {
      transformRef.current = t;
      scheduleSave();
    },
    [scheduleSave]
  );

  /**
   * IDs of nodes recently touched by an external process (canvas-cli). The
   * Canvas component reads this to render a transient "agent edited here"
   * highlight. Entries expire after ~2.5s.
   */
  const [externallyEditedIds, setExternallyEditedIds] = useState<Set<string>>(() => new Set());
  const externalClearTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Listen for canvas-cli writes bubbled up from the main process via the
  // local IPC socket. When we hear about a change, pull the fresh nodes
  // straight from disk (to handle arbitrary field updates including file
  // content, terminal scrollback, frame label, etc) and merge them into
  // our in-memory state WITHOUT calling scheduleSave — the disk is already
  // authoritative for these ids, and re-saving would race against the CLI.
  useEffect(() => {
    const storeApi = window.canvasWorkspace?.store;
    if (!storeApi?.onExternalUpdate) return;

    const unsubscribe = storeApi.onExternalUpdate(async (event) => {
      if (event.workspaceId !== canvasId) return;
      if (!shouldReloadForExternalUpdate(event)) return;
      // Drop events that arrive before the initial load completes —
      // the upcoming load will read the latest disk state anyway, and
      // operating on an empty nodesRef here would corrupt the view.
      if (!loadedRef.current) return;

      const result = await storeApi.load(canvasId);
      if (!result.ok || !result.data || !Array.isArray(result.data.nodes)) return;
      const diskNodes = result.data.nodes;
      // Any id we can read from disk is by definition persisted.
      for (const n of diskNodes) persistedIdsRef.current.add(n.id);

      // Semantics of `event.nodeIds`: every id here is a node that main's
      // fs.watch diff saw differ between its last-known snapshot and the
      // fresh disk contents. For each id, the combination of disk presence
      // and whether we've ever persisted it ourselves tells us what to do:
      //   - on disk only                         → CLI create, append
      //   - on disk AND in memory                → CLI update, replace in place
      //   - memory only, id was persisted before → CLI delete, drop
      //   - memory only, id never persisted      → local create whose save
      //                                            is still debounced; keep it.
      //                                            Dropping here would wipe
      //                                            nodes the user just added
      //                                            via the toolbar/context menu.
      const changedIds = new Set(event.nodeIds);
      const diskEdges = Array.isArray(result.data.edges) ? result.data.edges : [];
      const changedEdgeIds = new Set(event.edgeIds ?? []);
      const merged = mergeExternalDocumentUpdate({
        currentNodes: nodesRef.current,
        currentEdges: edgesRef.current,
        diskNodes,
        diskEdges,
        changedNodeIds: changedIds,
        changedEdgeIds,
        persistedNodeIds: persistedIdsRef.current,
        persistedEdgeIds: persistedEdgeIdsRef.current,
      });

      // Apply directly without history / scheduleSave to avoid a write-back loop.
      for (const edge of diskEdges) persistedEdgeIdsRef.current.add(edge.id);
      replaceState({ nodes: merged.nodes, edges: merged.edges });

      // Mark the affected nodes as externally-edited for 2.5s so the Canvas
      // component can render a transient highlight.
      setExternallyEditedIds((prev) => {
        const next = new Set(prev);
        for (const id of changedIds) next.add(id);
        return next;
      });
      for (const id of changedIds) {
        const existing = externalClearTimers.current.get(id);
        if (existing) clearTimeout(existing);
        const t = setTimeout(() => {
          setExternallyEditedIds((prev) => {
            if (!prev.has(id)) return prev;
            const next = new Set(prev);
            next.delete(id);
            return next;
          });
          externalClearTimers.current.delete(id);
        }, 2500);
        externalClearTimers.current.set(id, t);
      }

      // Notify the consumer about CLI-created nodes after state has
      // been applied, so handlers that re-read state (e.g. a viewport
      // visibility check) see the new nodes already in nodesRef.
      const notify = onAgentCreatedRef.current;
      if (notify) {
        for (const node of merged.createdNodes) notify(node);
      }
    });

    return () => {
      unsubscribe();
      for (const t of externalClearTimers.current.values()) clearTimeout(t);
      externalClearTimers.current.clear();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId, replaceState]);

  // File-watcher sync is temporarily disabled.  The fs.watch-based watcher
  // introduced race conditions with user edits (the onChanged callback could
  // call applyNodes with stale nodesRef.current, reverting in-flight changes).
  // To re-enable, flip FILE_WATCHER_ENABLED in file-watcher.ts and uncomment
  // the block below.
  //
  // useEffect(() => {
  //   const storeApi = window.canvasWorkspace?.store;
  //   const fileApi = window.canvasWorkspace?.file;
  //   if (!storeApi || !fileApi) return;
  //   void storeApi.watchWorkspace(canvasId);
  //   const cleanup = fileApi.onChanged((filePath, content) => {
  //     const node = nodesRef.current.find(
  //       (n) =>
  //         n.type === 'file' &&
  //         (n.data as FileNodeData).filePath === filePath &&
  //         !(n.data as FileNodeData).modified
  //     );
  //     if (!node) return;
  //     const updated = nodesRef.current.map((n) =>
  //       n.id === node.id
  //         ? { ...n, data: { ...(n.data as FileNodeData), content, modified: false } }
  //         : n
  //     );
  //     applyNodes(updated, false);
  //   });
  //   return cleanup;
  // }, [canvasId, applyNodes, nodesRef]);

  useEffect(() => {
    // New canvas selected — block saves until this load finishes.
    loadedRef.current = false;
    const api = window.canvasWorkspace?.store;
    if (!api) {
      const empty: CanvasNode[] = [];
      const emptyEdges: CanvasEdge[] = [];
      resetState({ nodes: empty, edges: emptyEdges });
      loadedRef.current = true;
      setLoaded(true);
      return;
    }
    persistedIdsRef.current = new Set();
    persistedEdgeIdsRef.current = new Set();
    void api.load(canvasId).then((result) => {
      if (result.ok && result.data) {
        const saved = result.data;
        const loadedNodes = Array.isArray(saved.nodes) ? saved.nodes : [];
        const loadedEdges = Array.isArray(saved.edges) ? saved.edges : [];
        resetState({ nodes: loadedNodes, edges: loadedEdges });
        // Keep the persisted viewport as the save baseline even when the
        // caller intentionally renders a local-only viewport (for example,
        // the AI Chat dock editor). A later node-only save must not replace
        // the main canvas viewport with the hook's default transform.
        if (saved.transform) transformRef.current = saved.transform;
        // Every node we loaded is on disk — seed the persisted set so
        // the external-update handler can tell future deletes apart
        // from locally-added unsaved nodes.
        for (const n of loadedNodes) persistedIdsRef.current.add(n.id);
        for (const edge of loadedEdges) persistedEdgeIdsRef.current.add(edge.id);
        if (saved.transform && onRestoreTransformRef.current) {
          onRestoreTransformRef.current(saved.transform);
        }
      } else {
        resetState({ nodes: [], edges: [] });
      }
      loadedRef.current = true;
      setLoaded(true);
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canvasId, resetState]);

  const contentCommands = useCanvasContentCommands({ canvasId, nodesRef, applyNodes });
  const coreCommands = useCanvasCoreCommands({
    nodesRef,
    edgesRef,
    persistedNodeIdsRef: persistedIdsRef,
    applyNodes,
    applyEdges,
    applyState,
    replaceState,
  });

  return {
    nodes,
    edges,
    loaded,
    externallyEditedIds,
    mergeMindmapTopic,
    splitMindmapTopic,
    setTransformForSave,
    flushSave,
    commitHistory,
    undo,
    redo,
    ...contentCommands,
    ...coreCommands,
  };
};
