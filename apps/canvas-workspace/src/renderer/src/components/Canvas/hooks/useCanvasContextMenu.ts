import { useCallback, useState, type RefObject } from 'react';
import type { CanvasNode } from '../../../types';

type CreatableNodeType =
  | 'file'
  | 'terminal'
  | 'frame'
  | 'group'
  | 'agent'
  | 'text'
  | 'iframe'
  | 'mindmap';

interface ContextMenuState {
  screenX: number;
  screenY: number;
  canvasX: number;
  canvasY: number;
}

interface Options {
  containerRef: RefObject<HTMLDivElement>;
  screenToCanvas: (
    clientX: number,
    clientY: number,
    container: HTMLDivElement,
  ) => { x: number; y: number };
  addNode: (type: CreatableNodeType, x: number, y: number) => CanvasNode;
  setSelectedNodeIds: (ids: string[]) => void;
}

/**
 * Owns the right-click / double-click context menu state plus the
 * "create node here" / "create node centered in viewport" callbacks.
 * `isBlankCanvasTarget` is exported so the root mouse handlers can
 * reuse the same DOM-target check that gates the menu.
 */
export const useCanvasContextMenu = ({
  containerRef,
  screenToCanvas,
  addNode,
  setSelectedNodeIds,
}: Options) => {
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const isBlankCanvasTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return !target.closest(
      '.canvas-node, .floating-toolbar, .zoom-indicator, .context-menu, .canvas-edges, .canvas-connect-overlay, .canvas-shape-overlay, .edge-style-panel',
    );
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!isBlankCanvasTarget(e.target)) return;
      if (!containerRef.current) return;
      const pos = screenToCanvas(e.clientX, e.clientY, containerRef.current);
      setContextMenu({ screenX: e.clientX, screenY: e.clientY, canvasX: pos.x, canvasY: pos.y });
    },
    [isBlankCanvasTarget, screenToCanvas, containerRef],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isBlankCanvasTarget(e.target)) return;
      if (!containerRef.current) return;
      const pos = screenToCanvas(e.clientX, e.clientY, containerRef.current);
      setContextMenu({ screenX: e.clientX, screenY: e.clientY, canvasX: pos.x, canvasY: pos.y });
    },
    [isBlankCanvasTarget, screenToCanvas, containerRef],
  );

  const handleCreateNode = useCallback(
    (type: CreatableNodeType) => {
      if (!contextMenu) return;
      const node = addNode(type, contextMenu.canvasX, contextMenu.canvasY);
      setSelectedNodeIds([node.id]);
      setContextMenu(null);
    },
    [addNode, contextMenu, setSelectedNodeIds],
  );

  const handleToolbarAddNode = useCallback(
    (type: CreatableNodeType) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      const pos = screenToCanvas(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        containerRef.current,
      );
      const halfW =
        type === 'file' ? 210
        : type === 'terminal' ? 240
        : type === 'agent' ? 260
        : type === 'text' ? 130
        : type === 'iframe' ? 260
        : type === 'mindmap' ? 320
        : 300;
      const halfH =
        type === 'frame' ? 200
        : type === 'group' ? 120
        : type === 'text' ? 60
        : type === 'iframe' ? 200
        : type === 'mindmap' ? 210
        : 150;
      const node = addNode(type, pos.x - halfW, pos.y - halfH);
      setSelectedNodeIds([node.id]);
    },
    [addNode, screenToCanvas, setSelectedNodeIds, containerRef],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return {
    contextMenu,
    setContextMenu,
    closeContextMenu,
    isBlankCanvasTarget,
    handleContextMenu,
    handleDoubleClick,
    handleCreateNode,
    handleToolbarAddNode,
  };
};
