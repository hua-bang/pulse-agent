import { useCallback } from 'react';
import type { CanvasNode } from '../../../../../../types';
import type { useCanvasDocumentHost } from '../../../../document/useCanvasDocumentHost';
import { useNodeDrag } from '../../../../runtime/useNodeDrag';
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
}

export function useCanvasNodeGestures({
  document,
  nodes,
  visibleNodes,
  selectedNodeIds,
  scale,
}: Options) {
  const drag = useNodeDrag(
    document.moveNode,
    document.moveNodes,
    scale,
    nodes,
    selectedNodeIds,
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

  return { ...drag, ...resize, ...renderOrder };
}
