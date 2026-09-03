import { useCallback, useRef, useState } from 'react';
import type { CanvasEdge, CanvasNode } from '../../../types';
import { count } from '../../../perf/counters';
import {
  CanvasDocumentHistory,
  type CanvasDocumentSnapshot,
} from './CanvasDocumentHistory';

const EMPTY_SNAPSHOT: CanvasDocumentSnapshot = { nodes: [], edges: [] };

export const useCanvasDocumentHistory = (scheduleSave: () => void) => {
  const history = useRef(new CanvasDocumentHistory(EMPTY_SNAPSHOT));
  const [snapshot, setSnapshot] = useState<CanvasDocumentSnapshot>(EMPTY_SNAPSHOT);
  const nodesRef = useRef<CanvasNode[]>(snapshot.nodes);
  const edgesRef = useRef<CanvasEdge[]>(snapshot.edges);

  const publish = useCallback((next: CanvasDocumentSnapshot, nodesChanged = false) => {
    if (nodesChanged) count('nodes-array-replace');
    nodesRef.current = next.nodes;
    edgesRef.current = next.edges;
    setSnapshot(next);
  }, []);

  const applyState = useCallback((
    patch: Partial<CanvasDocumentSnapshot>,
    addToHistory = true,
  ) => {
    const next = history.current.apply(patch, addToHistory);
    publish(next, patch.nodes !== undefined);
    scheduleSave();
  }, [publish, scheduleSave]);

  const applyNodes = useCallback((nodes: CanvasNode[], addToHistory = true) => {
    applyState({ nodes }, addToHistory);
  }, [applyState]);

  const applyEdges = useCallback((edges: CanvasEdge[], addToHistory = true) => {
    applyState({ edges }, addToHistory);
  }, [applyState]);

  const replaceState = useCallback((next: CanvasDocumentSnapshot) => {
    history.current.apply(next, false);
    publish(next);
  }, [publish]);

  const resetState = useCallback((next: CanvasDocumentSnapshot) => {
    history.current.reset(next);
    publish(next);
  }, [publish]);

  const commitHistory = useCallback(() => history.current.commit(), []);

  const undo = useCallback(() => {
    const next = history.current.undo();
    if (!next) return false;
    publish(next);
    scheduleSave();
    return true;
  }, [publish, scheduleSave]);

  const redo = useCallback(() => {
    const next = history.current.redo();
    if (!next) return false;
    publish(next);
    scheduleSave();
    return true;
  }, [publish, scheduleSave]);

  return {
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    nodesRef,
    edgesRef,
    applyNodes,
    applyEdges,
    applyState,
    replaceState,
    resetState,
    commitHistory,
    undo,
    redo,
  };
};
