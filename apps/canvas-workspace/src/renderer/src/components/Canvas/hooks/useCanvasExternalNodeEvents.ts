import { useEffect } from 'react';
import type { CanvasNode } from '../../../types';
import { getNodeDefaultSize } from '../../../utils/nodeFactory';

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
  ) {
    return value;
  }
  return null;
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
      const node = addNode(nodeType, center.x - size.width / 2, center.y - size.height / 2);
      updateNode(node.id, {
        ...incoming,
        id: incoming.id,
        type: nodeType,
        x: center.x - (incoming.width ?? size.width) / 2,
        y: center.y - (incoming.height ?? size.height) / 2,
        width: incoming.width ?? size.width,
        height: incoming.height ?? size.height,
        data: (incoming.data ?? {}) as CanvasNode['data'],
      });
      setSelectedNodeIds([incoming.id]);
    };
    window.addEventListener('canvas:add-workspace-node', handler);
    return () => {
      window.removeEventListener('canvas:add-workspace-node', handler);
    };
  }, [addNode, canvasId, containerRef, screenToCanvas, setSelectedNodeIds, updateNode]);
};
