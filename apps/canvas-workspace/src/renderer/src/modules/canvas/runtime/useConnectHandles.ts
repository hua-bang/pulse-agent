import { useCallback, useEffect, useState } from 'react';
import type React from 'react';
import type { CanvasNode, EdgeEndpoint } from '../../../types';
import { findNodeAtCanvasPoint } from '../model/edgeFactory';
import type { Point } from './useEdgeInteraction';

/** Screen px around the hovered node that keep its handles visible, so the
 *  pointer can travel from the node body to a handle outside its border. */
const HOVER_SLOP_SCREEN_PX = 24;

interface UseConnectHandlesArgs {
  /** False while another tool or gesture owns the pointer. */
  enabled: boolean;
  sortedNodes: CanvasNode[];
  screenToCanvas: (screenX: number, screenY: number, container: HTMLElement) => Point;
  getContainer: () => HTMLElement | null;
  beginConnect: (clientX: number, clientY: number, source?: EdgeEndpoint) => void;
}

const containsWithSlop = (node: CanvasNode, pt: Point, slop: number): boolean => (
  pt.x >= node.x - slop
  && pt.x <= node.x + node.width + slop
  && pt.y >= node.y - slop
  && pt.y <= node.y + node.height + slop
);

/**
 * Heptabase-style connect handles: hovering a node in select mode shows
 * side handles, and dragging one starts a connect gesture bound to that
 * node without switching to the Connect tool.
 */
export const useConnectHandles = ({
  enabled,
  sortedNodes,
  screenToCanvas,
  getContainer,
  beginConnect,
}: UseConnectHandlesArgs) => {
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) setHoverNodeId(null);
  }, [enabled]);

  const handleMouseMove = useCallback((event: React.MouseEvent) => {
    const container = getContainer();
    // A pressed button means another gesture (pan, drag, marquee) is live.
    if (!enabled || !container || event.buttons !== 0) {
      setHoverNodeId(null);
      return;
    }
    const pt = screenToCanvas(event.clientX, event.clientY, container);
    const slop = screenToCanvas(event.clientX + HOVER_SLOP_SCREEN_PX, event.clientY, container).x - pt.x;
    setHoverNodeId((current) => {
      const hovered = current ? sortedNodes.find((node) => node.id === current) : undefined;
      if (hovered && containsWithSlop(hovered, pt, slop)) return current;
      return findNodeAtCanvasPoint(sortedNodes, pt.x, pt.y)?.id ?? null;
    });
  }, [enabled, getContainer, screenToCanvas, sortedNodes]);

  const handleMouseLeave = useCallback(() => setHoverNodeId(null), []);

  const beginFromHandle = useCallback((nodeId: string, event: React.MouseEvent) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    // The click that ends this drag targets the common ancestor of the
    // handle and the drop point, which would read as a blank-canvas click
    // and clear the new edge selection. Swallow that one click.
    const swallowClick = (clickEvent: MouseEvent) => clickEvent.stopPropagation();
    window.addEventListener('click', swallowClick, { capture: true, once: true });
    window.addEventListener('mouseup', () => {
      setTimeout(() => window.removeEventListener('click', swallowClick, { capture: true }), 0);
    }, { once: true });
    setHoverNodeId(null);
    beginConnect(event.clientX, event.clientY, { kind: 'node', nodeId, anchor: 'auto' });
  }, [beginConnect]);

  return {
    hoverNodeId: enabled ? hoverNodeId : null,
    handleMouseMove,
    handleMouseLeave,
    beginFromHandle,
  };
};
