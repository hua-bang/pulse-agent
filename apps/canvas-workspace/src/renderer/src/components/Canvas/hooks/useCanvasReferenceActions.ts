import { useCallback, useEffect } from 'react';
import type { CanvasNode } from '../../../types';
import type { CanvasClipboard } from '../../../types/ui-interaction';
import type { NodeReferenceEntryForCanvas } from '../../ReferenceDrawer';

interface UseCanvasReferenceActionsParams {
  addNode: (type: CanvasNode['type'], x: number, y: number) => CanvasNode;
  canvasId: string;
  containerRef: React.RefObject<HTMLDivElement>;
  createReferenceNode?: (entry: NodeReferenceEntryForCanvas, x: number, y: number) => CanvasNode | null;
  onPasteReferences?: (targetWorkspaceId: string, clipboard: CanvasClipboard) => CanvasNode[];
  onReferencePlacementComplete?: () => void;
  referencePlacementRequest?: NodeReferenceEntryForCanvas | null;
  screenToCanvas: (
    x: number,
    y: number,
    container: HTMLElement,
  ) => { x: number; y: number };
  setSelectedNodeIds: (ids: string[]) => void;
  updateNode: (id: string, patch: Partial<CanvasNode>) => void;
}

export const useCanvasReferenceActions = ({
  addNode,
  canvasId,
  containerRef,
  createReferenceNode,
  onPasteReferences,
  onReferencePlacementComplete,
  referencePlacementRequest,
  screenToCanvas,
  setSelectedNodeIds,
  updateNode,
}: UseCanvasReferenceActionsParams) => {
  const pasteReferenceNodes = useCallback(
    (nextClipboard: CanvasClipboard) => {
      if (!onPasteReferences) return [];
      const templates = onPasteReferences(canvasId, nextClipboard);
      if (templates.length === 0) return [];
      let offsetX = 0;
      let offsetY = 0;
      const container = containerRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const viewportCenter = screenToCanvas(
          rect.left + rect.width / 2,
          rect.top + rect.height / 2,
          container,
        );
        const bounds = templates.reduce(
          (acc, node) => ({
            minX: Math.min(acc.minX, node.x),
            minY: Math.min(acc.minY, node.y),
            maxX: Math.max(acc.maxX, node.x + node.width),
            maxY: Math.max(acc.maxY, node.y + node.height),
          }),
          {
            minX: Number.POSITIVE_INFINITY,
            minY: Number.POSITIVE_INFINITY,
            maxX: Number.NEGATIVE_INFINITY,
            maxY: Number.NEGATIVE_INFINITY,
          },
        );
        offsetX = viewportCenter.x - (bounds.minX + bounds.maxX) / 2;
        offsetY = viewportCenter.y - (bounds.minY + bounds.maxY) / 2;
      }
      if (container && templates.length === 1 && templates[0]?.data && 'typeSnapshot' in templates[0].data && templates[0].data.typeSnapshot === 'iframe') {
        const viewportWidth = container.clientWidth;
        const minVisibleLeft = 24;
        const maxVisibleRight = Math.max(minVisibleLeft + templates[0].width, viewportWidth - 24);
        offsetX = Math.min(
          Math.max(templates[0].x + offsetX, minVisibleLeft),
          maxVisibleRight - templates[0].width,
        ) - templates[0].x;
      }
      const created: CanvasNode[] = [];
      for (const template of templates) {
        const node = addNode('reference', template.x + offsetX, template.y + offsetY);
        const patch: Partial<CanvasNode> = {
          title: template.title,
          ref: template.ref,
          data: template.data,
          width: template.width,
          height: template.height,
        };
        updateNode(node.id, patch);
        created.push({ ...node, ...patch });
      }
      return created;
    },
    [addNode, canvasId, containerRef, onPasteReferences, screenToCanvas, updateNode],
  );

  useEffect(() => {
    if (!referencePlacementRequest || !createReferenceNode) return;
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const center = screenToCanvas(
      rect.left + rect.width / 2,
      rect.top + rect.height / 2,
      container,
    );
    const next = createReferenceNode(referencePlacementRequest, center.x, center.y);
    if (!next) return;
    const nodeX = center.x - next.width / 2;
    const isIframeReference = next.data && 'typeSnapshot' in next.data && next.data.typeSnapshot === 'iframe';
    const nextX = isIframeReference
      ? Math.max(nodeX, screenToCanvas(rect.left + 24, rect.top, container).x)
      : nodeX;
    const node = addNode('reference', nextX, center.y - next.height / 2);
    updateNode(node.id, {
      title: next.title,
      ref: next.ref,
      data: next.data,
      width: next.width,
      height: next.height,
    });
    setSelectedNodeIds([node.id]);
    onReferencePlacementComplete?.();
  }, [
    addNode,
    containerRef,
    createReferenceNode,
    onReferencePlacementComplete,
    referencePlacementRequest,
    screenToCanvas,
    setSelectedNodeIds,
    updateNode,
  ]);

  return { pasteReferenceNodes };
};
