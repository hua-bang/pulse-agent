import { useCallback, type RefObject } from 'react';
import type { CanvasNode } from '../../../../../../types';
import type { CanvasClipboard } from '../../../../../../types/ui-interaction';
import type { PasteOptions } from '../../../../document/useCanvasContentCommands';
import type { CanvasRect } from '../../../../model/pasteOffset';

type ScreenToCanvas = (x: number, y: number, container: HTMLElement) => { x: number; y: number };

/** The canvas area the container currently shows, in canvas coordinates. */
const visibleCanvasRect = (
  container: HTMLElement | null,
  screenToCanvas: ScreenToCanvas,
): CanvasRect | null => {
  if (!container) return null;
  const rect = container.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) return null;
  const topLeft = screenToCanvas(rect.left, rect.top, container);
  const bottomRight = screenToCanvas(rect.right, rect.bottom, container);
  return {
    left: topLeft.x,
    top: topLeft.y,
    width: bottomRight.x - topLeft.x,
    height: bottomRight.y - topLeft.y,
  };
};

interface Options {
  canvasId: string;
  clipboard: CanvasClipboard | null;
  /** Paste real copies — same-workspace paste. */
  pasteNodes: (nodes: CanvasNode[], options?: PasteOptions) => CanvasNode[];
  containerRef: RefObject<HTMLElement>;
  screenToCanvas: ScreenToCanvas;
  /** Paste reference nodes — cross-workspace paste. */
  pasteReferenceNodes: (clipboard: CanvasClipboard) => CanvasNode[];
  setSelectedNodeIds: (ids: string[]) => void;
}

/**
 * Decides whether an incoming `paste` belongs to the canvas node clipboard
 * or to the system clipboard, and performs the node paste when it wins.
 *
 * The arbitration is the point. Cmd+V used to be handled on `keydown`, which
 * can see the keystroke but never the clipboard contents, so it called
 * `preventDefault` whenever the canvas clipboard held anything — and a
 * canvas copy from an hour ago then permanently shadowed everything the user
 * copied in any other app. Here we get `systemText` from the real paste
 * event and compare it against the mirror the canvas copy wrote (see
 * `canvas.copy` in `useCanvasKeyboard`): still equal (or the system
 * clipboard is empty) → the node copy is the newest thing the user copied
 * and wins; changed → they copied elsewhere since, and that content wins.
 *
 * A same-workspace paste also copies the edges between the copied nodes,
 * and lands in view when the user has panned away from the source.
 */
export const useCanvasClipboardPaste = ({
  canvasId,
  clipboard,
  pasteNodes,
  containerRef,
  screenToCanvas,
  pasteReferenceNodes,
  setSelectedNodeIds,
}: Options): ((systemText: string) => boolean) =>
  useCallback((systemText: string): boolean => {
    if (!clipboard || clipboard.nodes.length === 0) return false;
    const mirror = clipboard.systemText ?? '';
    if (systemText && mirror && systemText.trim() !== mirror.trim()) return false;
    const created = clipboard.sourceWorkspaceId === canvasId
      ? pasteNodes(clipboard.nodes, {
          edges: clipboard.edges,
          view: visibleCanvasRect(containerRef.current, screenToCanvas),
        })
      : pasteReferenceNodes(clipboard);
    if (created.length === 0) return false;
    setSelectedNodeIds(created.map((node) => node.id));
    return true;
  }, [
    clipboard,
    canvasId,
    containerRef,
    pasteNodes,
    pasteReferenceNodes,
    screenToCanvas,
    setSelectedNodeIds,
  ]);
