import { useCallback, type MutableRefObject } from 'react';
import type { CanvasEdge, CanvasNode } from '../types';
import { degradeEndpointsForDeletedNode } from '../utils/edgeFactory';
import {
  mergeMindmapTopic as mergeMindmapTopicState,
  splitMindmapTopic as splitMindmapTopicState,
  type MergeMindmapTopicRequest,
  type SplitMindmapTopicRequest,
} from '../utils/mindmapTransfer';
import { resizeGroupsToChildren } from '../utils/resizeGroupsToChildren';
import type { CanvasSnapshot } from './useNodeHistory';

interface UseMindmapTransfersOptions {
  nodesRef: MutableRefObject<CanvasNode[]>;
  edgesRef: MutableRefObject<CanvasEdge[]>;
  applyState: (patch: Partial<CanvasSnapshot>, addToHistory?: boolean) => void;
}

export const useMindmapTransfers = ({
  nodesRef,
  edgesRef,
  applyState,
}: UseMindmapTransfersOptions) => {
  const mergeMindmapTopic = useCallback(
    (request: MergeMindmapTopicRequest): boolean => {
      const result = mergeMindmapTopicState(nodesRef.current, request);
      if (!result) return false;

      let nextEdges = edgesRef.current;
      if (result.removedNodeId) {
        const victim = nodesRef.current.find(
          (node) => node.id === result.removedNodeId,
        );
        if (victim) {
          nextEdges = degradeEndpointsForDeletedNode(nextEdges, victim);
        }
      }
      applyState({
        nodes: resizeGroupsToChildren(result.nodes),
        edges: nextEdges,
      });
      return true;
    },
    [applyState, edgesRef, nodesRef],
  );

  const splitMindmapTopic = useCallback(
    (request: SplitMindmapTopicRequest): CanvasNode | null => {
      const result = splitMindmapTopicState(nodesRef.current, request);
      if (!result) return null;
      const previousIds = new Set(nodesRef.current.map((node) => node.id));
      const created = result.nodes.find((node) => !previousIds.has(node.id));
      if (!created) return null;
      applyState({ nodes: resizeGroupsToChildren(result.nodes) });
      return created;
    },
    [applyState, nodesRef],
  );

  return { mergeMindmapTopic, splitMindmapTopic };
};
