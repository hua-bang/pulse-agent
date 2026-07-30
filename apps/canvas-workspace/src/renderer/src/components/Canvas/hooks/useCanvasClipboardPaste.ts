import { useCallback } from 'react';
import type { CanvasNode } from '../../../types';
import type { CanvasClipboard } from '../../../types/ui-interaction';

interface Options {
  canvasId: string;
  clipboard: CanvasClipboard | null;
  /** Paste real copies — same-workspace paste. */
  pasteNodes: (nodes: CanvasNode[]) => CanvasNode[];
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
 */
export const useCanvasClipboardPaste = ({
  canvasId,
  clipboard,
  pasteNodes,
  pasteReferenceNodes,
  setSelectedNodeIds,
}: Options): ((systemText: string) => boolean) =>
  useCallback((systemText: string): boolean => {
    if (!clipboard || clipboard.nodes.length === 0) return false;
    const mirror = clipboard.systemText ?? '';
    if (systemText && mirror && systemText.trim() !== mirror.trim()) return false;
    const created = clipboard.sourceWorkspaceId === canvasId
      ? pasteNodes(clipboard.nodes)
      : pasteReferenceNodes(clipboard);
    if (created.length === 0) return false;
    setSelectedNodeIds(created.map((node) => node.id));
    return true;
  }, [clipboard, canvasId, pasteNodes, pasteReferenceNodes, setSelectedNodeIds]);
