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
    const node = addNode('reference', center.x - next.width / 2, center.y - next.height / 2);
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
