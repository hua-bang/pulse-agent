import { useMemo } from 'react';
import type { CanvasNode } from '../../../types';
import { computeContainerDepths, isContainerNode } from '../../../utils/frameHierarchy';

/**
 * Computes the canvas render order — containers underneath, regular
 * nodes on top, deeper containers above shallower ones. The returned
 * `sortedNodes` doubles as the hit-test stack for edge interactions
 * (consumers iterate it in reverse so the topmost node under the cursor
 * wins). `renderGroups` splits the same list into two arrays so the
 * surface layer can render containers and regular nodes in separate
 * subtrees with their own keys.
 */
export const useCanvasRenderOrder = (nodes: CanvasNode[]) => {
  const sortedNodes = useMemo(() => {
    const depths = computeContainerDepths(nodes);
    return [...nodes].sort((a, b) => {
      const aIsContainer = isContainerNode(a);
      const bIsContainer = isContainerNode(b);
      if (aIsContainer && !bIsContainer) return -1;
      if (!aIsContainer && bIsContainer) return 1;
      if (aIsContainer && bIsContainer) {
        return (depths.get(a.id) ?? 0) - (depths.get(b.id) ?? 0);
      }
      return 0;
    });
  }, [nodes]);

  const renderGroups = useMemo(() => {
    const containers: CanvasNode[] = [];
    const regular: CanvasNode[] = [];
    for (const node of sortedNodes) {
      if (isContainerNode(node)) containers.push(node);
      else regular.push(node);
    }
    return { containers, regular };
  }, [sortedNodes]);

  return { sortedNodes, renderGroups };
};
