import { useCallback, useMemo, type RefObject } from 'react';
import type { CanvasNode } from '../../../types';

/** Preset zoom levels offered by the zoom chip menu, as scale factors. */
export const ZOOM_PRESETS = [0.5, 1, 2] as const;

/** Step used by the chip's −/+ buttons; matches the keyboard zoom step. */
export const ZOOM_BUTTON_STEP = 1.2;

interface Options {
  containerRef: RefObject<HTMLElement>;
  zoomByStep: (factor: number, container: HTMLElement | null) => void;
  zoomToScale: (scale: number, container: HTMLElement | null) => void;
  fitAllNodes: (nodes: CanvasNode[]) => void;
  /** Nodes currently shown on the canvas. */
  visibleNodes: CanvasNode[];
  selectedNodeIds: readonly string[];
}

export interface CanvasZoomControls {
  /** Zoom by a factor around the view centre. */
  zoomBy: (factor: number) => void;
  /** Go to an exact scale around the view centre. */
  zoomTo: (scale: number) => void;
  resetZoom: () => void;
  fitAll: () => void;
  /** Frame the selection; undefined when nothing visible is selected. */
  fitSelection?: () => void;
}

/**
 * The viewport-centred zoom commands shared by the keyboard handler and the
 * zoom chip. Fitting reuses `fitAllNodes`, so "zoom to selection" frames the
 * selected nodes the same way "fit all" frames every node.
 */
export const useCanvasZoomControls = ({
  containerRef,
  zoomByStep,
  zoomToScale,
  fitAllNodes,
  visibleNodes,
  selectedNodeIds,
}: Options): CanvasZoomControls => {
  const zoomBy = useCallback((factor: number) => {
    zoomByStep(factor, containerRef.current);
  }, [containerRef, zoomByStep]);

  const zoomTo = useCallback((scale: number) => {
    zoomToScale(scale, containerRef.current);
  }, [containerRef, zoomToScale]);

  const resetZoom = useCallback(() => {
    zoomToScale(1, containerRef.current);
  }, [containerRef, zoomToScale]);

  const fitAll = useCallback(() => {
    fitAllNodes(visibleNodes);
  }, [fitAllNodes, visibleNodes]);

  const selectedNodes = useMemo(() => {
    const ids = new Set(selectedNodeIds);
    return visibleNodes.filter((node) => ids.has(node.id));
  }, [selectedNodeIds, visibleNodes]);

  const fitSelection = useCallback(() => {
    fitAllNodes(selectedNodes);
  }, [fitAllNodes, selectedNodes]);

  return useMemo(() => ({
    zoomBy,
    zoomTo,
    resetZoom,
    fitAll,
    fitSelection: selectedNodes.length > 0 ? fitSelection : undefined,
  }), [fitAll, fitSelection, resetZoom, selectedNodes.length, zoomBy, zoomTo]);
};
