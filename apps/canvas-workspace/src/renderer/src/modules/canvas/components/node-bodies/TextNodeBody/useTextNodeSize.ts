import { useLayoutEffect, type RefObject } from 'react';
import type { CanvasNode, TextNodeData } from '../../../../../types';

interface TextNodeSizeOptions {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  isResizing: boolean;
  readOnly: boolean;
  wrapperRef: RefObject<HTMLDivElement | null>;
}

/** Preview and editor share the same measured geometry and fixed-width wrapping. */
export function useTextNodeSize({ node, onUpdate, isResizing, readOnly, wrapperRef }: TextNodeSizeOptions) {
  const autoSize = (node.data as TextNodeData).autoSize !== false;
  useLayoutEffect(() => {
    if (isResizing || readOnly) return;
    const element = wrapperRef.current;
    if (!element) return;
    if (!autoSize && node.height === element.offsetHeight) return;
    const measuredWidth = Math.max(40, Math.ceil(element.offsetWidth));
    const measuredHeight = Math.max(28, Math.ceil(element.offsetHeight));
    const patch: Partial<CanvasNode> = {};
    if (autoSize && Math.abs(measuredWidth - node.width) > 1) patch.width = measuredWidth;
    if (Math.abs(measuredHeight - node.height) > 1) patch.height = measuredHeight;
    if (patch.width !== undefined || patch.height !== undefined) onUpdate(node.id, patch);
  });
}
