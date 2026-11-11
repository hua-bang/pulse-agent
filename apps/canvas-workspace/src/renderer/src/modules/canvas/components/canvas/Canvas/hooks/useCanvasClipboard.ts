import { useCallback, useEffect, useRef, type RefObject } from 'react';
import type { CanvasEdge, CanvasNode, FileNodeData } from '../../../../../../types';
import type { CanvasClipboard } from '../../../../../../types/ui-interaction';
import { withContainerDescendants } from '../../../../../../utils/frameHierarchy';
import { nodeClipboardText } from '../../../../../../utils/nodeLabel';
import { edgesAmong, type PasteNodesOptions } from '../../../../document/useCanvasContentCommands';

type Point = { x: number; y: number };

interface Options {
  canvasId: string;
  clipboard: CanvasClipboard | null;
  setClipboard: (clipboard: CanvasClipboard | null) => void;
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  selectedNodeIds: string[];
  setSelectedNodeIds: (ids: string[]) => void;
  containerRef: RefObject<HTMLDivElement>;
  screenToCanvas: (clientX: number, clientY: number, container: HTMLDivElement) => Point;
  /** Paste real copies — same-workspace paste. */
  pasteNodes: (nodes: CanvasNode[], options?: PasteNodesOptions) => CanvasNode[];
  /** Paste reference nodes — cross-workspace paste. */
  pasteReferenceNodes: (clipboard: CanvasClipboard) => CanvasNode[];
  /** `recoverable` skips the confirmation for a plain multi-node delete. */
  removeNodes: (ids: string[], options?: { recoverable?: boolean }) => void | Promise<void>;
}

/** Step between pastes that repeat at the same pointer position. */
const REPEAT_STEP = 24;

/** The text that a canvas copy mirrors into the system clipboard. */
const clipboardText = (selected: CanvasNode[]): string => {
  const notes = selected.filter((node): node is CanvasNode & { data: FileNodeData } => (
    node.type === 'file' && typeof (node.data as FileNodeData).content === 'string'
  ));
  if (notes.length !== selected.length) return selected.map(nodeClipboardText).join('\n\n');
  return notes
    .map((node) => notes.length === 1 ? node.data.content : `# ${node.title}\n\n${node.data.content}`)
    .join('\n\n---\n\n');
};

/**
 * Copy, cut, and paste of canvas nodes.
 *
 * Paste decides whether an incoming `paste` belongs to the canvas node
 * clipboard or to the system clipboard. Cmd+V used to be handled on
 * `keydown`, which can see the keystroke but never the clipboard contents,
 * so a canvas copy from an hour ago shadowed everything the user copied in
 * any other app. Copy mirrors its text into the system clipboard and keeps
 * the mirror. Paste compares the system text with the mirror: still equal
 * (or empty) means the node copy is the newest copy and wins; changed means
 * the user copied elsewhere since, and that content wins.
 *
 * A paste lands on the pointer when the pointer is over the canvas. Without
 * a pointer position it keeps the offset from the source.
 */
export const useCanvasClipboard = ({
  canvasId,
  clipboard,
  setClipboard,
  nodes,
  edges,
  selectedNodeIds,
  setSelectedNodeIds,
  containerRef,
  screenToCanvas,
  pasteNodes,
  pasteReferenceNodes,
  removeNodes,
}: Options) => {
  const pointerRef = useRef<Point | null>(null);
  const lastPasteRef = useRef<{ at: Point; count: number } | null>(null);
  useEffect(() => {
    const track = (event: MouseEvent) => {
      pointerRef.current = { x: event.clientX, y: event.clientY };
    };
    document.addEventListener('mousemove', track, { passive: true });
    return () => document.removeEventListener('mousemove', track);
  }, []);

  const copy = useCallback((): boolean => {
    const selected = withContainerDescendants(
      nodes.filter((node) => selectedNodeIds.includes(node.id)),
      nodes,
    );
    if (selected.length === 0) return false;
    const systemText = clipboardText(selected);
    const copied = { sourceWorkspaceId: canvasId, nodes: selected, edges: edgesAmong(edges, selected) };
    setClipboard({ ...copied, systemText });
    lastPasteRef.current = null;
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(systemText).catch(() => {
        // The mirror never reached the system clipboard, so a comparison
        // with it would refuse every later paste. Without a mirror the
        // canvas clipboard wins.
        setClipboard(copied);
      });
    }
    return true;
  }, [canvasId, edges, nodes, selectedNodeIds, setClipboard]);

  const cut = useCallback(() => {
    if (copy()) void removeNodes(selectedNodeIds, { recoverable: true });
  }, [copy, removeNodes, selectedNodeIds]);

  /** The canvas point under the pointer, or null when the pointer is elsewhere. */
  const pointerTarget = useCallback((): Point | null => {
    const pointer = pointerRef.current;
    const container = containerRef.current;
    if (!pointer || !container) return null;
    if (!container.contains(document.elementFromPoint(pointer.x, pointer.y))) return null;
    return screenToCanvas(pointer.x, pointer.y, container);
  }, [containerRef, screenToCanvas]);

  const paste = useCallback((systemText: string, target?: Point): boolean => {
    if (!clipboard || clipboard.nodes.length === 0) return false;
    const mirror = clipboard.systemText ?? '';
    if (systemText && mirror && systemText.trim() !== mirror.trim()) return false;
    let created: CanvasNode[];
    if (clipboard.sourceWorkspaceId !== canvasId) {
      created = pasteReferenceNodes(clipboard);
    } else {
      const at = target ?? pointerTarget() ?? undefined;
      // A second paste at the same point steps away, so the copies do not
      // cover each other.
      const last = lastPasteRef.current;
      const count = at && last && last.at.x === at.x && last.at.y === at.y ? last.count + 1 : 0;
      lastPasteRef.current = at ? { at, count } : null;
      created = pasteNodes(clipboard.nodes, {
        edges: clipboard.edges,
        at: at && { x: at.x + count * REPEAT_STEP, y: at.y + count * REPEAT_STEP },
      });
    }
    if (created.length === 0) return false;
    setSelectedNodeIds(created.map((node) => node.id));
    return true;
  }, [clipboard, canvasId, pasteNodes, pasteReferenceNodes, pointerTarget, setSelectedNodeIds]);

  /** Menu paste: there is no `paste` event, so read the system text first. */
  const pasteAt = useCallback((target: Point) => {
    const read = navigator.clipboard?.readText?.() ?? Promise.resolve('');
    void read.catch(() => '').then((text) => paste(text, target));
  }, [paste]);

  return { copy, cut, paste, pasteAt, canPaste: !!clipboard && clipboard.nodes.length > 0 };
};
