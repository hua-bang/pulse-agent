import { useEffect } from 'react';
import type { CanvasNode } from '../../../../../../types';
import { getNodeDefaultSize } from '../../../../../../utils/nodeFactory';
import { DOCK_LINK_DRAG_TYPE } from '../../../../../../shared/dock/dock-link-drag';

interface UseCanvasExternalNodeEventsParams {
  addNode: (
    type: CanvasNode['type'],
    x: number,
    y: number,
    options?: { nodePatch?: Partial<CanvasNode> },
  ) => CanvasNode;
  canvasId: string;
  containerRef: React.RefObject<HTMLDivElement>;
  /** The container ref is only attached once the canvas has loaded. */
  loaded: boolean;
  createUrlNode: (
    value: string,
    options?: { at?: { x: number; y: number }; title?: string },
  ) => CanvasNode | null;
  screenToCanvas: (
    x: number,
    y: number,
    container: HTMLElement,
  ) => { x: number; y: number };
  setSelectedNodeIds: (ids: string[]) => void;
}

function coerceCanvasNodeType(value: unknown): CanvasNode['type'] | null {
  if (
    value === 'file'
    || value === 'terminal'
    || value === 'frame'
    || value === 'group'
    || value === 'agent'
    || value === 'text'
    || value === 'iframe'
    || value === 'image'
    || value === 'shape'
    || value === 'mindmap'
    || value === 'reference'
    || value === 'plugin'
  ) {
    return value;
  }
  return null;
}

export const useCanvasExternalNodeEvents = ({
  addNode,
  canvasId,
  containerRef,
  loaded,
  createUrlNode,
  screenToCanvas,
  setSelectedNodeIds,
}: UseCanvasExternalNodeEventsParams) => {
  // A web tab dragged out of the dock lands as a web node under the pointer.
  // The source tab stays open; the shared default session keeps its login.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const over = (event: DragEvent) => {
      if (!event.dataTransfer?.types.includes(DOCK_LINK_DRAG_TYPE)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'copy';
    };
    const drop = (event: DragEvent) => {
      const payload = event.dataTransfer?.getData(DOCK_LINK_DRAG_TYPE);
      if (!payload) return;
      event.preventDefault();
      event.stopPropagation();
      // Only the dock writes this type, so the payload shape is trusted.
      const { url, title } = JSON.parse(payload) as { url: string; title: string };
      createUrlNode(url, {
        at: screenToCanvas(event.clientX, event.clientY, container),
        title,
      });
    };
    container.addEventListener('dragover', over);
    container.addEventListener('drop', drop);
    return () => {
      container.removeEventListener('dragover', over);
      container.removeEventListener('drop', drop);
    };
  }, [containerRef, createUrlNode, loaded, screenToCanvas]);

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
      let title: string | undefined;
      try {
        title = new URL(detail.url).host || undefined;
      } catch {
        // Leave default title if URL is malformed.
      }
      const node = addNode('iframe', center.x - 260, center.y - 200, {
        nodePatch: {
          ...(title ? { title } : {}),
          data: { url: detail.url, html: '', mode: 'url', prompt: '' },
        },
      });
      setSelectedNodeIds([node.id]);
    };
    window.addEventListener('canvas:add-iframe-from-url', handler);
    return () => {
      window.removeEventListener('canvas:add-iframe-from-url', handler);
    };
  }, [addNode, canvasId, containerRef, screenToCanvas, setSelectedNodeIds]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent).detail as
        | {
            workspaceId?: string;
            node?: Partial<CanvasNode> & { id?: string; type?: string; data?: unknown };
          }
        | undefined;
      const incoming = detail?.node;
      if (!incoming?.id || detail?.workspaceId !== canvasId) return;

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const center = screenToCanvas(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        container,
      );
      const nodeType = coerceCanvasNodeType(incoming.type) ?? 'text';
      const size = getNodeDefaultSize(nodeType);
      addNode(nodeType, center.x - size.width / 2, center.y - size.height / 2, {
        nodePatch: {
          ...incoming,
          id: incoming.id,
          type: nodeType,
          x: center.x - (incoming.width ?? size.width) / 2,
          y: center.y - (incoming.height ?? size.height) / 2,
          width: incoming.width ?? size.width,
          height: incoming.height ?? size.height,
          data: (incoming.data ?? {}) as CanvasNode['data'],
        },
      });
      setSelectedNodeIds([incoming.id]);
    };
    window.addEventListener('canvas:add-workspace-node', handler);
    return () => {
      window.removeEventListener('canvas:add-workspace-node', handler);
    };
  }, [addNode, canvasId, containerRef, screenToCanvas, setSelectedNodeIds]);
};
