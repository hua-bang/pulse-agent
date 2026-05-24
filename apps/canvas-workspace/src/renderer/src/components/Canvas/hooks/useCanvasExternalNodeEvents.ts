import { useEffect } from 'react';
import type { CanvasNode } from '../../../types';

interface UseCanvasExternalNodeEventsParams {
  addNode: (type: CanvasNode['type'], x: number, y: number) => CanvasNode;
  canvasId: string;
  containerRef: React.RefObject<HTMLDivElement>;
  screenToCanvas: (
    x: number,
    y: number,
    container: HTMLElement,
  ) => { x: number; y: number };
  setSelectedNodeIds: (ids: string[]) => void;
  updateNode: (id: string, patch: Partial<CanvasNode>) => void;
}

export const useCanvasExternalNodeEvents = ({
  addNode,
  canvasId,
  containerRef,
  screenToCanvas,
  setSelectedNodeIds,
  updateNode,
}: UseCanvasExternalNodeEventsParams) => {
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | { workspaceId?: string; url?: string }
        | undefined;
      if (!detail?.url || detail.workspaceId !== canvasId) return;
      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const center = screenToCanvas(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        container,
      );
      const node = addNode('iframe', center.x - 260, center.y - 200);
      let title = node.title;
      try {
        title = new URL(detail.url).host || title;
      } catch {
        // Leave default title if URL is malformed.
      }
      updateNode(node.id, {
        title,
        data: { url: detail.url, html: '', mode: 'url', prompt: '' },
      });
      setSelectedNodeIds([node.id]);
    };
    window.addEventListener('canvas:add-iframe-from-url', handler);
    return () => {
      window.removeEventListener('canvas:add-iframe-from-url', handler);
    };
  }, [addNode, canvasId, containerRef, screenToCanvas, setSelectedNodeIds, updateNode]);
};
