import { useLayoutEffect, useRef, type RefObject } from 'react';
import type { CanvasNode, TextNodeData } from '../../../../../types';
import { useWorkspaceActive } from '../../../../../shared/workspaceActivity';

interface TextNodeSizeOptions {
  node: CanvasNode;
  onUpdate: (id: string, patch: Partial<CanvasNode>, options?: { history?: boolean }) => void;
  isResizing: boolean;
  readOnly: boolean;
  wrapperRef: RefObject<HTMLDivElement | null>;
}

/**
 * Preview and editor share the same measured geometry and fixed-width wrapping.
 * A hidden workspace (display: none) measures 0, which would shrink every text
 * node and save that size on each route switch. Measure only while visible.
 * On show, skip the read when the node did not change while hidden: the read
 * forces a full canvas layout inside the route-switch click.
 */
export function useTextNodeSize({ node, onUpdate, isResizing, readOnly, wrapperRef }: TextNodeSizeOptions) {
  const autoSize = (node.data as TextNodeData).autoSize !== false;
  const workspaceActive = useWorkspaceActive();
  const hiddenRef = useRef(false);
  const measuredNodeRef = useRef<CanvasNode | null>(null);
  useLayoutEffect(() => {
    if (!workspaceActive) {
      hiddenRef.current = true;
      return;
    }
    const shownUnchanged = hiddenRef.current && measuredNodeRef.current === node;
    hiddenRef.current = false;
    if (shownUnchanged || isResizing || readOnly) return;
    const element = wrapperRef.current;
    if (!element) return;
    measuredNodeRef.current = node;
    if (!autoSize && node.height === element.offsetHeight) return;
    const measuredWidth = Math.max(40, Math.ceil(element.offsetWidth));
    const measuredHeight = Math.max(28, Math.ceil(element.offsetHeight));
    const patch: Partial<CanvasNode> = {};
    if (autoSize && Math.abs(measuredWidth - node.width) > 1) patch.width = measuredWidth;
    if (Math.abs(measuredHeight - node.height) > 1) patch.height = measuredHeight;
    // Measured geometry follows the content, so it is not an undo step. With
    // history, undoing a new text node restored its default size, the next
    // measure pushed a fresh entry, and undo could never get past the node.
    if (patch.width !== undefined || patch.height !== undefined) {
      onUpdate(node.id, patch, { history: false });
    }
  });
}
