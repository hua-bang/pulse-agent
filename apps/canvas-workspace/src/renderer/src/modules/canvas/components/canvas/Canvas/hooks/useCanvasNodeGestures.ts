import { useCallback } from 'react';
import type { CanvasNode } from '../../../../../../types';
import type { useCanvasDocumentHost } from '../../../../document/useCanvasDocumentHost';
import { useNodeDrag, type NodeDragAutoPan } from '../../../../runtime/useNodeDrag';
import { useNodeResize } from '../../../../runtime/useNodeResize';
import { useCanvasRenderOrder } from './useCanvasRenderOrder';

type DocumentCommands = Pick<
  ReturnType<typeof useCanvasDocumentHost>,
  'moveNode' | 'moveNodes' | 'resizeNode'
>;

interface Options {
  document: DocumentCommands;
  nodes: CanvasNode[];
  visibleNodes: CanvasNode[];
  selectedNodeIds: string[];
  scale: number;
  /** Pans the view while a drag rests near its edge. */
  autoPan?: NodeDragAutoPan;
}

export function useCanvasNodeGestures({
  document,
  nodes,
  visibleNodes,
  selectedNodeIds,
  scale,
  autoPan,
}: Options) {
  const drag = useNodeDrag(
    document.moveNode,
    document.moveNodes,
    scale,
    nodes,
    selectedNodeIds,
    autoPan,
  );
  const commitNodeResize = useCallback((
    id: string,
    width: number,
    height: number,
    x?: number,
    y?: number,
  ) => {
    document.resizeNode(id, width, height, x, y, { disableTextAutoSize: true });
  }, [document.resizeNode]);
  const resize = useNodeResize(commitNodeResize, scale, nodes);
  const renderOrder = useCanvasRenderOrder(visibleNodes);

  const { resizeSnapLines, ...resizeState } = resize;

  return {
    ...drag,
    ...resizeState,
    ...renderOrder,
    // One gesture runs at a time; show the guides of the active one.
    snapLines: resize.resizingId ? resizeSnapLines : drag.snapLines,
  };
}
