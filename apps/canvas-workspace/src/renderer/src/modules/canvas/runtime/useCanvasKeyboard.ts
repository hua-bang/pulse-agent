import { useEffect, useRef } from 'react';
import type { CanvasNode, FileNodeData } from '../../../types';
import type { CanvasClipboard } from '../../../types/ui-interaction';
import { isImeComposing } from '../../../utils/ime';
import {
  matchShortcut,
  type CanvasShortcutId,
  type KeyBinding,
} from '../../../shortcuts/registry';

interface KeyboardShortcutLike {
  ctrlKey: boolean;
  defaultPrevented?: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

interface ActiveElementLike {
  tagName?: string;
  isContentEditable?: boolean;
  closest?: (selector: string) => Element | ActiveElementLike | null;
}

const isEditableElement = (active: ActiveElementLike | null): boolean => !!active && (
  active.tagName === 'INPUT' ||
  active.tagName === 'TEXTAREA' ||
  active.isContentEditable === true
);

const CANVAS_FIND_EXCLUDED_SURFACE_SELECTOR = [
  '.note-card',
  '.iframe-body',
  '.link-drawer__header',
  '.link-drawer__webview-surface',
  '.link-drawer__find',
].join(', ');

const isInsideCanvasFindExcludedSurface = (active: ActiveElementLike | null): boolean =>
  !!active?.closest?.(CANVAS_FIND_EXCLUDED_SURFACE_SELECTOR);

export const shouldHandleCanvasFindShortcut = (
  event: KeyboardShortcutLike,
  active: ActiveElementLike | null,
): boolean => {
  if (event.defaultPrevented) return false;
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.shiftKey) return false;
  if (event.key.toLowerCase() !== 'f') return false;
  return !isInsideCanvasFindExcludedSurface(active);
};

/** Zoom multiplier per Cmd/Ctrl +/- press. */
const KEYBOARD_ZOOM_STEP = 1.2;

interface Options {
  canvasId: string;
  undo: () => void;
  redo: () => void;
  nodes: CanvasNode[];
  selectedNodeIds: string[];
  setSelectedNodeIds: (ids: string[]) => void;
  /** Currently selected edge (if any). Delete/Backspace removes it; Esc
   *  deselects it before falling through to node-deselect. */
  selectedEdgeId: string | null;
  setSelectedEdgeId: (id: string | null) => void;
  removeEdge: (id: string) => void | Promise<void>;
  duplicateNode: (id: string) => CanvasNode | null;
  setClipboard: (clipboard: CanvasClipboard | null) => void;
  /** Group the current node selection in a lightweight container. */
  groupSelectedNodes: () => void;
  /** Dissolve selected group nodes while keeping their children on canvas. */
  ungroupSelectedNodes: () => void;
  removeNodes: (ids: string[]) => void | Promise<void>;
  /** Batch-move nodes by deltas in canvas coordinates. Used by arrow-
   *  key nudging so a single keypress moves the whole selection in one
   *  history step. Skips history (the explicit commitHistory call below
   *  is what records it as a discrete undo entry). */
  moveNodes: (moves: Array<{ id: string; x: number; y: number }>) => void;
  /** Push the current node state onto the undo stack. Called once per
   *  arrow-key press so each nudge is an independent undo step. */
  commitHistory: () => void;
  searchOpen: boolean;
  setSearchOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  /** Find-in-canvas bar (Ctrl/Cmd+F). Kept separate from the Cmd+K
   *  command palette because the two have incompatible mental models:
   *  the palette closes after a single Enter, while find stays open
   *  for iterative next/prev. */
  findOpen: boolean;
  toggleFindBar: () => void;
  closeFindBar: () => void;
  findNext: () => void;
  findPrev: () => void;
  findHasMatches: boolean;
  contextMenu: unknown;
  setContextMenu: (menu: null) => void;
  setHighlightedId: (id: string | null) => void;
  handleFocusNode: (node: CanvasNode) => void;
  activeTool: string;
  setActiveTool: (tool: string) => void;
  /** Canvas zoom, viewport-centre anchored. */
  zoomBy: (factor: number) => void;
  resetZoom: () => void;
  fitNodes: (nodes: CanvasNode[]) => void;
  /** Start inline title editing on a node (Enter / F2 on the selection). */
  renameNode: (nodeId: string) => void;
  focusModeEnabled?: boolean;
  canToggleFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onExitFocusMode?: () => void;
  onToggleChatPanel?: () => void;
  onToggleReferenceDrawer?: () => void;
  fullscreenActive?: boolean;
  onExitFullscreen?: () => void;
  keyboardLocked?: boolean;
}

/**
 * Canvas keyboard layer.
 *
 * Bindings are NOT written here — they live in `shortcuts/registry.ts`, and
 * this hook only supplies the behavior. The handler table is typed
 * `Record<CanvasShortcutId, …>`, so the registry and the implementation
 * cannot drift: documenting a canvas shortcut without writing its handler
 * fails to compile, and so does deleting a handler that the help overlay
 * still advertises.
 *
 * One `keydown` listener serves the whole canvas (it used to be two, which
 * meant two independent chances to disagree about IME / lock state).
 */
export const useCanvasKeyboard = ({
  canvasId,
  undo, redo, nodes, selectedNodeIds, setSelectedNodeIds,
  selectedEdgeId, setSelectedEdgeId, removeEdge,
  duplicateNode, setClipboard, groupSelectedNodes, ungroupSelectedNodes, removeNodes,
  moveNodes, commitHistory,
  searchOpen, setSearchOpen,
  findOpen, toggleFindBar, closeFindBar, findNext, findPrev, findHasMatches,
  contextMenu, setContextMenu,
  setHighlightedId, handleFocusNode,
  activeTool, setActiveTool,
  zoomBy, resetZoom, fitNodes, renameNode,
  focusModeEnabled = false,
  canToggleFocusMode = false,
  onToggleFocusMode,
  onExitFocusMode,
  onToggleChatPanel,
  onToggleReferenceDrawer,
  fullscreenActive = false,
  onExitFullscreen,
  keyboardLocked = false,
}: Options) => {
  // The handler table is rebuilt on every render (it closes over live
  // state), but the listener is registered once and reads through this ref.
  // Without it, every node edit would tear down and re-add the listener.
  const handlersRef = useRef<Record<CanvasShortcutId, (event: KeyboardEvent, binding: KeyBinding) => void>>(
    null as never,
  );
  const lockedRef = useRef(keyboardLocked);
  lockedRef.current = keyboardLocked;

  const cycleSelection = (backwards: boolean) => {
    if (nodes.length === 0) return;
    const currentIndex = nodes.findIndex((n) => n.id === selectedNodeIds[0]);
    const nextIndex = backwards
      ? (currentIndex <= 0 ? nodes.length - 1 : currentIndex - 1)
      : (currentIndex >= nodes.length - 1 ? 0 : currentIndex + 1);
    const nextNode = nodes[nextIndex];
    setSelectedNodeIds([nextNode.id]);
    setSelectedEdgeId(null);
    setHighlightedId(nextNode.id);
    // In focus mode the dedicated reframe effect handles the zoom with
    // tighter padding/maxScale; calling handleFocusNode here too would
    // produce a double reframe at different scales.
    if (!focusModeEnabled) handleFocusNode(nextNode);
  };

  const nudge = (event: KeyboardEvent, step: number) => {
    if (selectedNodeIds.length === 0) return;
    event.preventDefault();
    const dx = event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
    const dy = event.key === 'ArrowUp' ? -step : event.key === 'ArrowDown' ? step : 0;
    const idSet = new Set(selectedNodeIds);
    const moves = nodes
      .filter((n) => idSet.has(n.id))
      .map((n) => ({ id: n.id, x: n.x + dx, y: n.y + dy }));
    if (moves.length === 0) return;
    moveNodes(moves);
    commitHistory();
  };

  /**
   * Escape unwinds the deepest open thing first. It only calls
   * `preventDefault` when it actually consumed something: the app shell and
   * the right dock listen for Escape too, and an unconditional consume made
   * one keypress close two unrelated surfaces at once.
   */
  const handleEscape = (event: KeyboardEvent) => {
    const consume = () => event.preventDefault();
    if (findOpen) { closeFindBar(); consume(); return; }
    if (searchOpen) { setSearchOpen(false); consume(); return; }
    if (contextMenu) { setContextMenu(null); consume(); return; }
    // Fullscreen takes priority over focus-mode so Esc reliably shrinks the
    // overlay back to its canvas slot before doing anything else with
    // selection state.
    if (fullscreenActive) { onExitFullscreen?.(); consume(); return; }
    if (focusModeEnabled) { onExitFocusMode?.(); consume(); return; }
    if (activeTool === 'connect' || activeTool.startsWith('shape-')) {
      setActiveTool('select');
      consume();
      return;
    }
    if (selectedEdgeId) { setSelectedEdgeId(null); consume(); return; }
    if (selectedNodeIds.length > 0) { setSelectedNodeIds([]); consume(); }
    // Nothing was open or selected — leave Escape to the app shell (return
    // from the chat page) and the dock.
  };

  handlersRef.current = {
    'canvas.commandPalette': (event) => {
      event.preventDefault();
      setSearchOpen((prev) => !prev);
    },
    'canvas.commandPaletteAlt': (event) => {
      event.preventDefault();
      setSearchOpen((prev) => !prev);
    },
    'canvas.find': (event) => {
      // Notes and embedded pages own their own find flows, so don't let the
      // canvas-level search steal focus from their editors, toolbars, or page
      // chrome.
      if (!shouldHandleCanvasFindShortcut(event, document.activeElement)) return;
      event.preventDefault();
      toggleFindBar();
    },
    'canvas.findNext': (event) => {
      // Only meaningful while results exist; otherwise let the key fall
      // through (F3 is a browser/OS find key elsewhere).
      if (!findHasMatches) return;
      event.preventDefault();
      if (event.shiftKey) findPrev();
      else findNext();
    },
    'canvas.cycleNodes': (event) => {
      event.preventDefault();
      cycleSelection(event.shiftKey);
    },
    'canvas.focusMode': (event) => {
      if (!focusModeEnabled && !canToggleFocusMode) return;
      event.preventDefault();
      onToggleFocusMode?.();
    },

    'canvas.zoomIn': (event) => {
      event.preventDefault();
      zoomBy(KEYBOARD_ZOOM_STEP);
    },
    'canvas.zoomOut': (event) => {
      event.preventDefault();
      zoomBy(1 / KEYBOARD_ZOOM_STEP);
    },
    'canvas.zoomReset': (event) => {
      event.preventDefault();
      resetZoom();
    },
    'canvas.fitAll': (event) => {
      event.preventDefault();
      fitNodes(nodes);
    },
    'canvas.fitSelection': (event) => {
      const idSet = new Set(selectedNodeIds);
      const selected = nodes.filter((n) => idSet.has(n.id));
      if (selected.length === 0) return;
      event.preventDefault();
      fitNodes(selected);
    },
    'canvas.toolSelect': (event) => { event.preventDefault(); setActiveTool('select'); },
    'canvas.toolHand': (event) => { event.preventDefault(); setActiveTool('hand'); },
    'canvas.toolConnect': (event) => { event.preventDefault(); setActiveTool('connect'); },

    // Each press is its own undo step, so a chain of nudges can be reversed
    // one at a time. Auto-repeat is filtered upstream — holding an arrow key
    // used to push one history entry per repeat and drown the undo stack.
    'canvas.nudge': (event) => nudge(event, 1),
    'canvas.nudgeCoarse': (event) => nudge(event, 10),
    'canvas.renameSelection': (event) => {
      if (selectedNodeIds.length !== 1) return;
      event.preventDefault();
      renameNode(selectedNodeIds[0]);
    },

    'canvas.selectAll': (event) => {
      event.preventDefault();
      setSelectedNodeIds(nodes.map((n) => n.id));
      setSelectedEdgeId(null);
    },
    'canvas.duplicate': (event) => {
      event.preventDefault();
      if (selectedNodeIds.length === 0) return;
      // Duplicate every selected node and keep the new copies as the active
      // selection — matches paste's behavior so the user can chain Cmd+D to
      // spawn a row of copies.
      const created: string[] = [];
      for (const id of selectedNodeIds) {
        const copy = duplicateNode(id);
        if (copy) created.push(copy.id);
      }
      if (created.length > 0) setSelectedNodeIds(created);
    },
    'canvas.copy': () => {
      const selected = nodes.filter((n) => selectedNodeIds.includes(n.id));
      if (selected.length === 0) return;
      // Mirror the copy into the system clipboard and remember exactly what
      // we wrote. The paste path compares the two: if the system clipboard
      // still holds this mirror, the node copy is the newest thing the user
      // copied and wins; if it changed, they copied elsewhere since and that
      // content wins instead. Without the mirror a stale canvas clipboard
      // silently beat every later system copy, forever.
      const markdownNodes = selected.filter((n): n is CanvasNode & { data: FileNodeData } => (
        n.type === 'file' && typeof (n.data as FileNodeData).content === 'string'
      ));
      const systemText = markdownNodes.length === selected.length
        ? markdownNodes
          .map((node) => markdownNodes.length === 1
            ? node.data.content
            : `# ${node.title}\n\n${node.data.content}`)
          .join('\n\n---\n\n')
        : selected.map((node) => node.title).join('\n');
      setClipboard({ sourceWorkspaceId: canvasId, nodes: selected, systemText });
      if (navigator.clipboard?.writeText) {
        void navigator.clipboard.writeText(systemText).catch(() => {
          // The mirror never reached the system clipboard, so comparing
          // against it would refuse every later paste. Drop it: without a
          // mirror the canvas clipboard simply wins, which is the old
          // behavior and the right fallback.
          setClipboard({ sourceWorkspaceId: canvasId, nodes: selected });
        });
      }
    },
    'canvas.group': (event) => {
      event.preventDefault();
      if (selectedNodeIds.length > 0) groupSelectedNodes();
    },
    'canvas.ungroup': (event) => {
      event.preventDefault();
      if (selectedNodeIds.length > 0) ungroupSelectedNodes();
    },
    'canvas.delete': (event) => {
      if (selectedEdgeId) {
        event.preventDefault();
        void removeEdge(selectedEdgeId);
        return;
      }
      if (selectedNodeIds.length > 0) {
        event.preventDefault();
        void removeNodes(selectedNodeIds);
      }
    },
    'canvas.undo': (event) => { event.preventDefault(); undo(); },
    'canvas.redo': (event) => { event.preventDefault(); redo(); },
    'canvas.redoAlt': (event) => { event.preventDefault(); redo(); },

    'canvas.toggleChatPanel': (event) => {
      if (!onToggleChatPanel) return;
      event.preventDefault();
      onToggleChatPanel();
    },
    'canvas.toggleReferenceDrawer': (event) => {
      if (!onToggleReferenceDrawer) return;
      event.preventDefault();
      onToggleReferenceDrawer();
    },
    'canvas.escape': handleEscape,
  };

  // NOTE: Cmd+V deliberately has NO keydown handler. The native `paste`
  // event (useCanvasImagePaste) is the single arbiter between the canvas
  // clipboard and the system clipboard — see `canvas.copy` above.

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (lockedRef.current) return;
      if (e.defaultPrevented) return;
      // Mid-composition keystrokes belong to the IME candidate window; every
      // other keyboard surface in the app already guards this.
      if (isImeComposing(e)) return;

      const match = matchShortcut(e, 'canvas');
      if (!match) return;

      // Auto-repeat fires this handler once per OS repeat tick. Actions that
      // mutate the document (nudge, duplicate, delete) would stack one undo
      // entry per tick, so a held key is treated as a single press.
      if (e.repeat && match.definition.editable !== 'allow') return;

      const active = document.activeElement;
      if (match.definition.editable !== 'allow' && isEditableElement(active)) return;

      handlersRef.current[match.id as CanvasShortcutId](e, match.binding);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
};
