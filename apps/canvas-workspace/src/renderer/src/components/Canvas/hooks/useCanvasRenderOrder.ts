import { useMemo } from 'react';
import type { CanvasNode } from '../../../types';
import { computeContainerDepths, isContainerNode } from '../../../utils/frameHierarchy';

const isAgentTeamManagedAgentNode = (node: CanvasNode): boolean =>
  (() => {
    if (node.type !== 'agent') return false;
    const data = node.data as { agentTeamId?: unknown; agentTeamAgentId?: unknown };
    return typeof data.agentTeamId === 'string' && typeof data.agentTeamAgentId === 'string';
  })();

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
    const visibleNodes = nodes.filter((node) => !isAgentTeamManagedAgentNode(node));
    const depths = computeContainerDepths(visibleNodes);
    return [...visibleNodes].sort((a, b) => {
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
