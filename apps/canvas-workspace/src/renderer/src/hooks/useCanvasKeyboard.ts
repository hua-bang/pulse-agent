import { useEffect } from 'react';
import type { CanvasNode, FileNodeData } from '../types';
import type { CanvasClipboard } from '../types/ui-interaction';

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

const isInsideNoteCard = (active: ActiveElementLike | null): boolean =>
  !!active?.closest?.('.note-card');

export const shouldHandleCanvasFindShortcut = (
  event: KeyboardShortcutLike,
  active: ActiveElementLike | null,
): boolean => {
  if (event.defaultPrevented) return false;
  if (!(event.metaKey || event.ctrlKey)) return false;
  if (event.shiftKey) return false;
  if (event.key.toLowerCase() !== 'f') return false;
  return !isInsideNoteCard(active);
};

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
  clipboard: CanvasClipboard | null;
  setClipboard: (clipboard: CanvasClipboard | null) => void;
  pasteNodes: (nodes: CanvasNode[]) => CanvasNode[];
  pasteReferencedNodes?: (clipboard: CanvasClipboard) => CanvasNode[];
  /** Group the current node selection in a lightweight container. */
  groupSelectedNodes: () => void;
  /** Dissolve selected group nodes while keeping their children on canvas. */
  ungroupSelectedNodes: () => void;
  removeNodes: (ids: string[]) => void | Promise<void>;
  /** Batch-move nodes by deltas in canvas coordinates. Used by arrow-
   *  key nudging so a single keypress moves the whole selection in one
   *  history step. Skips history (the trailing commitHistory call from
   *  the keyup batch is what records it as a discrete undo entry). */
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
  focusModeEnabled?: boolean;
  canToggleFocusMode?: boolean;
  onToggleFocusMode?: () => void;
  onExitFocusMode?: () => void;
  fullscreenActive?: boolean;
  onExitFullscreen?: () => void;
  keyboardLocked?: boolean;
}

export const useCanvasKeyboard = ({
  canvasId,
  undo, redo, nodes, selectedNodeIds, setSelectedNodeIds,
  selectedEdgeId, setSelectedEdgeId, removeEdge,
  duplicateNode, clipboard, setClipboard, pasteNodes, pasteReferencedNodes, groupSelectedNodes, ungroupSelectedNodes, removeNodes,
  moveNodes, commitHistory,
  searchOpen, setSearchOpen,
  findOpen, toggleFindBar, closeFindBar, findNext, findPrev, findHasMatches,
  contextMenu, setContextMenu,
  setHighlightedId, handleFocusNode,
  focusModeEnabled = false,
  canToggleFocusMode = false,
  onToggleFocusMode,
  onExitFocusMode,
  fullscreenActive = false,
  onExitFullscreen,
  keyboardLocked = false,
}: Options) => {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (keyboardLocked) return;
      if (e.defaultPrevented) return;

      const active = document.activeElement;
      const isEditable = isEditableElement(active);
      const isMod = e.metaKey || e.ctrlKey;

      // Ctrl/Cmd+F — find in canvas. Note cards own their own local find
      // flow, so don't let the canvas-level search steal focus from note
      // editing, note panels, or note toolbar controls.
      if (shouldHandleCanvasFindShortcut(e, active)) {
        e.preventDefault();
        toggleFindBar();
        return;
      }

      // F3 / Shift+F3 — page through matches without re-opening the
      // bar. Only meaningful while results exist; otherwise let the
      // key fall through.
      if (e.key === 'F3' && findHasMatches) {
        e.preventDefault();
        if (e.shiftKey) findPrev();
        else findNext();
        return;
      }

      if (isMod && (e.key === 'k' || e.key === 'h') && !isEditable) {
        e.preventDefault();
        setSearchOpen((prev) => !prev);
        return;
      }
      // Normalize the key: with Shift held, e.key is 'Z', so a strict
      // === 'z' comparison silently broke Cmd/Ctrl+Shift+Z redo.
      if (isMod && e.key.toLowerCase() === 'z' && !isEditable) {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      // Ctrl+Y — conventional redo on Windows/Linux.
      if (isMod && !e.shiftKey && e.key.toLowerCase() === 'y' && !isEditable) {
        e.preventDefault();
        redo();
        return;
      }
      if (isMod && e.key === 'a' && !isEditable) {
        e.preventDefault();
        setSelectedNodeIds(nodes.map((n) => n.id));
        return;
      }
      if (isMod && e.key === 'd' && !isEditable) {
        e.preventDefault();
        if (selectedNodeIds.length === 0) return;
        // Duplicate every selected node and keep the new copies as the
        // active selection — matches Cmd+V's behavior so the user can
        // chain Cmd+D to spawn a row of copies.
        const created: string[] = [];
        for (const id of selectedNodeIds) {
          const copy = duplicateNode(id);
          if (copy) created.push(copy.id);
        }
        if (created.length > 0) setSelectedNodeIds(created);
        return;
      }
      if (isMod && e.key === 'c' && !isEditable) {
        const selected = nodes.filter((n) => selectedNodeIds.includes(n.id));
        if (selected.length > 0) {
          setClipboard({ sourceWorkspaceId: canvasId, nodes: selected });
          const markdownNodes = selected.filter((n): n is CanvasNode & { data: FileNodeData } => (
            n.type === 'file' && typeof (n.data as FileNodeData).content === 'string'
          ));
          if (markdownNodes.length === selected.length && navigator.clipboard?.writeText) {
            const markdown = markdownNodes
              .map((node) => markdownNodes.length === 1
                ? node.data.content
                : `# ${node.title}\n\n${node.data.content}`)
              .join('\n\n---\n\n');
            void navigator.clipboard.writeText(markdown).catch(() => {
              // Canvas-local clipboard still works even if the system clipboard is unavailable.
            });
          }
        }
        return;
      }
      if (isMod && (e.key === 'g' || e.key === 'G') && e.shiftKey && !isEditable) {
        e.preventDefault();
        if (selectedNodeIds.length > 0) ungroupSelectedNodes();
        return;
      }
      if (isMod && (e.key === 'g' || e.key === 'G') && !e.shiftKey && !isEditable) {
        e.preventDefault();
        if (selectedNodeIds.length > 0) groupSelectedNodes();
        return;
      }
      if (isMod && e.key === 'v' && !isEditable) {
        if (clipboard && clipboard.nodes.length > 0) {
          e.preventDefault();
          const created = clipboard.sourceWorkspaceId === canvasId
            ? pasteNodes(clipboard.nodes)
            : pasteReferencedNodes?.(clipboard) ?? [];
          setSelectedNodeIds(created.map((n) => n.id));
        }
        return;
      }
      if (!isEditable && !isMod && !e.altKey && !e.shiftKey && e.key.toLowerCase() === 'f') {
        if (!focusModeEnabled && !canToggleFocusMode) return;
        e.preventDefault();
        onToggleFocusMode?.();
        return;
      }
      // Arrow-key nudging — moves the whole selection by 1px (or 10px
      // with shift) per keypress. Each press is its own undo step, so
      // a chain of nudges can be reversed one at a time. The arrow
      // keys still scroll the page in editable contexts, so we bail
      // out when an input has focus.
      if (
        !isEditable &&
        !isMod &&
        (e.key === 'ArrowUp' || e.key === 'ArrowDown' ||
         e.key === 'ArrowLeft' || e.key === 'ArrowRight')
      ) {
        if (selectedNodeIds.length === 0) return;
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        const idSet = new Set(selectedNodeIds);
        const moves = nodes
          .filter((n) => idSet.has(n.id))
          .map((n) => ({ id: n.id, x: n.x + dx, y: n.y + dy }));
        if (moves.length > 0) {
          moveNodes(moves);
          commitHistory();
        }
        return;
      }
      if (e.key === 'Escape') {
        if (findOpen) { closeFindBar(); return; }
        if (searchOpen) { setSearchOpen(false); return; }
        if (contextMenu) { setContextMenu(null); return; }
        // Fullscreen takes priority over focus-mode so Esc reliably
        // shrinks the overlay back to its canvas slot before doing
        // anything else with selection state.
        if (fullscreenActive) { onExitFullscreen?.(); return; }
        if (focusModeEnabled) { onExitFocusMode?.(); return; }
        if (selectedEdgeId) { setSelectedEdgeId(null); return; }
        setSelectedNodeIds([]);
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && !isEditable) {
        if (selectedEdgeId) {
          e.preventDefault();
          void removeEdge(selectedEdgeId);
          return;
        }
        if (selectedNodeIds.length > 0) {
          e.preventDefault();
          void removeNodes(selectedNodeIds);
        }
        return;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [canvasId, undo, redo, nodes, selectedNodeIds, setSelectedNodeIds, selectedEdgeId, setSelectedEdgeId, removeEdge, duplicateNode, clipboard, setClipboard, pasteNodes, pasteReferencedNodes, groupSelectedNodes, ungroupSelectedNodes, removeNodes, moveNodes, commitHistory, searchOpen, setSearchOpen, findOpen, toggleFindBar, closeFindBar, findNext, findPrev, findHasMatches, contextMenu, setContextMenu, focusModeEnabled, canToggleFocusMode, onToggleFocusMode, onExitFocusMode, fullscreenActive, onExitFullscreen, keyboardLocked]);

  // Cmd/Ctrl+Tab to cycle through nodes (Shift reverses direction)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (keyboardLocked) return;
      if (e.defaultPrevented) return;

      if ((e.metaKey || e.ctrlKey) && e.key === 'Tab') {
        const activeEl = document.activeElement;
        const isEditable = isEditableElement(activeEl);
        if (!isEditable && nodes.length > 0) {
          e.preventDefault();
          const currentIndex = nodes.findIndex((n) => n.id === selectedNodeIds[0]);
          let nextIndex: number;
          if (e.shiftKey) {
            nextIndex = currentIndex <= 0 ? nodes.length - 1 : currentIndex - 1;
          } else {
            nextIndex = currentIndex >= nodes.length - 1 ? 0 : currentIndex + 1;
          }
          const nextNode = nodes[nextIndex];
          setSelectedNodeIds([nextNode.id]);
          setHighlightedId(nextNode.id);
          // In focus mode the dedicated reframe effect handles the zoom
          // with tighter padding/maxScale; calling handleFocusNode here
          // too would produce a double reframe at different scales.
          if (!focusModeEnabled) handleFocusNode(nextNode);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [nodes, selectedNodeIds, setSelectedNodeIds, setHighlightedId, handleFocusNode, keyboardLocked, focusModeEnabled]);
};
