import { useCallback, useState, type RefObject } from 'react';
import type { CanvasNode } from '../../../types';
import { getNodeDefaultSize, type CreatableCanvasNodeType } from '../../../utils/nodeFactory';
import type { ToastInput } from '../../../types/ui-interaction';
import type { AddNodeOptions } from '../../../hooks/useNodes';
import { useI18n, type I18nKey } from '../../../i18n';

interface ContextMenuState {
  screenX: number;
  screenY: number;
  canvasX: number;
  canvasY: number;
}

/** Diagonal step applied when a proposed slot is already occupied.
 *  Matches the +24/+24 cascade used by `duplicateNode`/`pasteNodes`
 *  so consecutive adds and duplicates feel the same. */
const CASCADE_STEP = 24;
/** Two nodes whose top-lefts differ by less than this are treated as
 *  "the same slot". 12 is small enough that intentional partial
 *  overlap (e.g. dropping a text label onto a frame) is preserved,
 *  but large enough to catch the "user clicked the same toolbar
 *  button twice" case where the math would otherwise pixel-stack. */
const STACK_TOLERANCE = 12;
/** Upper bound on the cascade walk so we don't loop forever on a
 *  densely-filled diagonal. After this many tries we give up and let
 *  the cascaded position stand — still better than perfect overlap. */
const MAX_CASCADE_STEPS = 16;

interface Options {
  containerRef: RefObject<HTMLDivElement>;
  screenToCanvas: (
    clientX: number,
    clientY: number,
    container: HTMLDivElement,
  ) => { x: number; y: number };
  addNode: (type: CreatableCanvasNodeType, x: number, y: number, options?: AddNodeOptions) => CanvasNode;
  /** Live read of the current node list, used to detect stacked
   *  positions before placing a new node. */
  nodesRef: RefObject<CanvasNode[]>;
  setSelectedNodeIds: (ids: string[]) => void;
  /** Brief flash on the new node so the user can spot it after a
   *  context-menu/toolbar/palette add. Reuses the existing 1.5s
   *  `nodeHighlight` animation. */
  setHighlightedId: (id: string | null) => void;
  /** Toast surface for the post-add confirmation. */
  notify: (toast: ToastInput) => string;
}

interface AddNodeUiOptions extends AddNodeOptions {
  label?: string;
}

const CREATABLE_TYPE_LABEL_KEY: Record<CreatableCanvasNodeType, I18nKey> = {
  file: 'node.type.file',
  terminal: 'node.type.terminal',
  frame: 'node.type.frame',
  group: 'node.type.group',
  agent: 'node.type.codingAgent',
  text: 'node.type.text',
  iframe: 'node.type.webPage',
  mindmap: 'node.type.mindmap',
  plugin: 'node.type.plugin',
};

/** Walk diagonally from the desired top-left until we find a slot
 *  whose top-left doesn't sit on top of any existing node within
 *  `STACK_TOLERANCE` pixels. Returns whether a cascade actually
 *  happened so callers can adjust their feedback copy. */
const resolveNonStackingSlot = (
  existing: readonly CanvasNode[],
  desiredX: number,
  desiredY: number,
): { x: number; y: number; cascaded: boolean } => {
  let x = desiredX;
  let y = desiredY;
  for (let step = 0; step < MAX_CASCADE_STEPS; step += 1) {
    const collides = existing.some(
      (n) =>
        Math.abs(n.x - x) < STACK_TOLERANCE &&
        Math.abs(n.y - y) < STACK_TOLERANCE,
    );
    if (!collides) return { x, y, cascaded: step > 0 };
    x += CASCADE_STEP;
    y += CASCADE_STEP;
  }
  return { x, y, cascaded: true };
};

/**
 * Owns the right-click / double-click context menu state plus the
 * "create node here" / "create node centered in viewport" callbacks.
 * `isBlankCanvasTarget` is exported so the root mouse handlers can
 * reuse the same DOM-target check that gates the menu.
 */
export const useCanvasContextMenu = ({
  containerRef,
  screenToCanvas,
  addNode,
  nodesRef,
  setSelectedNodeIds,
  setHighlightedId,
  notify,
}: Options) => {
  const { t } = useI18n();
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  /** Shared post-add side effects: select, flash, and toast the new node
   *  so every entry point (right-click, toolbar, palette, empty-canvas
   *  hint) gives the same visible confirmation. The placement hint
   *  varies per entry point — right-click drops at cursor, toolbar
   *  centers on viewport — so callers pass it in. */
  const finalizeAddedNode = useCallback(
    (node: CanvasNode, type: CreatableCanvasNodeType, placementHint: string, label?: string) => {
      const nodeLabel = label ?? t(CREATABLE_TYPE_LABEL_KEY[type]);
      setSelectedNodeIds([node.id]);
      setHighlightedId(node.id);
      notify({
        tone: 'success',
        title: t('canvas.nodeAdded', { label: nodeLabel }),
        description: placementHint,
      });
    },
    [notify, setHighlightedId, setSelectedNodeIds, t],
  );

  const isBlankCanvasTarget = useCallback((target: EventTarget | null) => {
    if (!(target instanceof HTMLElement)) return false;
    return !target.closest(
      '.canvas-node, .canvas-empty-hint, .canvas-fullscreen-chip, .canvas-bottom-chrome, .floating-toolbar, .zoom-indicator, .context-menu, .canvas-edges, .canvas-connect-overlay, .canvas-shape-overlay, .edge-style-panel',
    );
  }, []);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      if (!isBlankCanvasTarget(e.target)) return;
      if (!containerRef.current) return;
      const pos = screenToCanvas(e.clientX, e.clientY, containerRef.current);
      setContextMenu({ screenX: e.clientX, screenY: e.clientY, canvasX: pos.x, canvasY: pos.y });
    },
    [isBlankCanvasTarget, screenToCanvas, containerRef],
  );

  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      if (!isBlankCanvasTarget(e.target)) return;
      if (!containerRef.current) return;
      const pos = screenToCanvas(e.clientX, e.clientY, containerRef.current);
      setContextMenu({ screenX: e.clientX, screenY: e.clientY, canvasX: pos.x, canvasY: pos.y });
    },
    [isBlankCanvasTarget, screenToCanvas, containerRef],
  );

  const handleCreateNode = useCallback(
    (type: CreatableCanvasNodeType) => {
      if (!contextMenu) return;
      // Right-click drop point becomes the new node's top-left so the
      // node grows down-right from the cursor — matches typical
      // "create here" affordances in design tools.
      const slot = resolveNonStackingSlot(
        nodesRef.current ?? [],
        contextMenu.canvasX,
        contextMenu.canvasY,
      );
      const node = addNode(type, slot.x, slot.y);
      finalizeAddedNode(
        node,
        type,
        slot.cascaded ? t('canvas.nodeAddedOffset') : t('canvas.nodeAddedAtCursor'),
      );
      setContextMenu(null);
    },
    [addNode, contextMenu, finalizeAddedNode, nodesRef, t],
  );

  const handleToolbarAddNode = useCallback(
    (type: CreatableCanvasNodeType, options?: AddNodeUiOptions) => {
      if (!containerRef.current) return;
      // Center the new node on the current viewport: project the
      // container's screen-space midpoint into canvas coordinates, then
      // offset by half the node's default size so the node — not its
      // top-left corner — lands at that midpoint. Half-dimensions come
      // from `getNodeDefaultSize` (the same numbers `createDefaultNode`
      // will write to `node.width`/`node.height`), keeping the centering
      // honest as defaults evolve. The cascade walk after centering
      // prevents repeat clicks from pixel-stacking new nodes.
      const rect = containerRef.current.getBoundingClientRect();
      const center = screenToCanvas(
        rect.left + rect.width / 2,
        rect.top + rect.height / 2,
        containerRef.current,
      );
      const defaultSize = getNodeDefaultSize(type);
      const width = typeof options?.nodePatch?.width === 'number'
        ? options.nodePatch.width
        : defaultSize.width;
      const height = typeof options?.nodePatch?.height === 'number'
        ? options.nodePatch.height
        : defaultSize.height;
      const slot = resolveNonStackingSlot(
        nodesRef.current ?? [],
        center.x - width / 2,
        center.y - height / 2,
      );
      const node = addNode(type, slot.x, slot.y, options);
      finalizeAddedNode(
        node,
        type,
        slot.cascaded
          ? t('canvas.nodeAddedOffset')
          : t('canvas.nodeAddedCentered'),
        options?.label,
      );
    },
    [addNode, screenToCanvas, finalizeAddedNode, containerRef, nodesRef, t],
  );

  const closeContextMenu = useCallback(() => setContextMenu(null), []);

  return {
    contextMenu,
    setContextMenu,
    closeContextMenu,
    isBlankCanvasTarget,
    handleContextMenu,
    handleDoubleClick,
    handleCreateNode,
    handleToolbarAddNode,
  };
};
