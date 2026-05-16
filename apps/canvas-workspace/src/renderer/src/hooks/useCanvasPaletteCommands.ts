import { useMemo, type MutableRefObject } from 'react';
import type { CanvasNode } from '../types';
import type { PaletteCommand } from '../components/CommandPalette';

interface Options {
  selectedNodeIds: string[];
  setSelectedNodeIds: (ids: string[]) => void;
  /** Live ref to the latest `nodes` array. Used inside command `enabled`
   *  predicates / `run` callbacks so commands captured by the memo see
   *  fresh state without forcing the memo to invalidate on every node
   *  edit. */
  nodesRef: MutableRefObject<CanvasNode[]>;
  duplicateNode: (id: string) => CanvasNode | null;
  requestRemoveNodes: (ids: string[]) => void | Promise<void>;
  groupSelectedNodes: () => void;
  ungroupSelectedNodes: () => void;
  wrapSelectedNodesInFrame: () => void;
  handleToolbarAddNode: (
    type: 'file' | 'terminal' | 'frame' | 'group' | 'agent' | 'text' | 'iframe' | 'mindmap',
  ) => void;
  fitAllNodes: (nodes: CanvasNode[]) => void;
  resetTransform: () => void;
  chatPanelOpen?: boolean;
  onChatToggle?: () => void;
  referenceDrawerOpen?: boolean;
  onReferenceToggle?: () => void;
  onPinReferenceNode?: (nodeId: string) => void;
  openShortcuts: () => void;
  focusModeActive: boolean;
  focusModeAvailable: boolean;
  toggleFocusMode: () => void;
}

/**
 * Builds the command list for the Cmd+K palette. Each entry captures
 * the latest selection / tool / chat state at invocation time — the
 * palette is only mounted while open, so rebuilding on every render is
 * cheap compared to the clarity of inlining the bindings here.
 */
export const useCanvasPaletteCommands = ({
  selectedNodeIds,
  setSelectedNodeIds,
  nodesRef,
  duplicateNode,
  requestRemoveNodes,
  groupSelectedNodes,
  ungroupSelectedNodes,
  wrapSelectedNodesInFrame,
  handleToolbarAddNode,
  fitAllNodes,
  resetTransform,
  chatPanelOpen,
  onChatToggle,
  referenceDrawerOpen,
  onReferenceToggle,
  onPinReferenceNode,
  openShortcuts,
  focusModeActive,
  focusModeAvailable,
  toggleFocusMode,
}: Options): PaletteCommand[] => {
  return useMemo<PaletteCommand[]>(() => {
    const selectionCount = selectedNodeIds.length;
    const list: PaletteCommand[] = [
      {
        id: 'duplicate-selection',
        group: 'edit',
        title: selectionCount > 1
          ? `Duplicate ${selectionCount} selected nodes`
          : 'Duplicate selected node',
        shortcut: 'Cmd+D',
        enabled: selectionCount > 0,
        run: () => {
          const created: string[] = [];
          for (const id of selectedNodeIds) {
            const copy = duplicateNode(id);
            if (copy) created.push(copy.id);
          }
          if (created.length > 0) setSelectedNodeIds(created);
        },
      },
      {
        id: 'delete-selection',
        group: 'edit',
        title: selectionCount > 1
          ? `Delete ${selectionCount} selected nodes`
          : 'Delete selected node',
        shortcut: 'Del',
        enabled: selectionCount > 0,
        run: () => {
          void requestRemoveNodes(selectedNodeIds);
        },
      },
      {
        id: 'group-selection',
        group: 'edit',
        title: selectionCount > 1
          ? `Group ${selectionCount} selected nodes`
          : 'Group selected node',
        shortcut: 'Cmd+G',
        aliases: ['group', 'bundle'],
        enabled: selectionCount > 0,
        run: () => {
          groupSelectedNodes();
        },
      },
      {
        id: 'ungroup-selection',
        group: 'edit',
        title: 'Ungroup selected group',
        shortcut: 'Cmd+Shift+G',
        aliases: ['ungroup', 'dissolve group', 'release group'],
        enabled: selectedNodeIds.some((id) =>
          nodesRef.current.some((node) => node.id === id && node.type === 'group'),
        ),
        run: () => {
          ungroupSelectedNodes();
        },
      },
      {
        id: 'wrap-selection-in-frame',
        group: 'edit',
        title: selectionCount > 1
          ? `Wrap ${selectionCount} selected nodes in frame`
          : 'Wrap selected node in frame',
        aliases: ['frame', 'wrap'],
        enabled: selectionCount > 0,
        run: () => {
          wrapSelectedNodesInFrame();
        },
      },
      {
        id: 'pin-reference',
        group: 'view',
        title: selectionCount === 1 ? 'Pin selected node as reference' : 'Pin node as reference',
        aliases: ['reference', 'pin', 'context'],
        enabled: selectionCount === 1 && !!onPinReferenceNode,
        run: () => {
          const [nodeId] = selectedNodeIds;
          if (nodeId) onPinReferenceNode?.(nodeId);
        },
      },
      {
        id: 'toggle-focus-mode',
        group: 'view',
        title: focusModeActive ? 'Exit Focus mode' : 'Focus selected node',
        shortcut: 'F',
        aliases: ['focus', 'spotlight', 'dim'],
        enabled: focusModeActive || focusModeAvailable,
        run: toggleFocusMode,
      },
      {
        id: 'create-note',
        group: 'create',
        title: 'New note',
        hint: 'Markdown file backed by disk',
        aliases: ['file', 'markdown', 'doc', 'md'],
        run: () => handleToolbarAddNode('file'),
      },
      {
        id: 'create-agent',
        group: 'create',
        title: 'Create agent',
        hint: 'Run an AI coding agent in a PTY',
        aliases: ['ai', 'chat', 'assistant', 'claude'],
        run: () => handleToolbarAddNode('agent'),
      },
      {
        id: 'create-text',
        group: 'create',
        title: 'Add text',
        aliases: ['label', 'sticky', 'note'],
        run: () => handleToolbarAddNode('text'),
      },
      {
        id: 'create-frame',
        group: 'create',
        title: 'Add frame',
        hint: 'Named spatial container',
        aliases: ['section', 'box', 'container'],
        run: () => handleToolbarAddNode('frame'),
      },
      {
        id: 'create-link',
        group: 'create',
        title: 'Web page',
        hint: 'URL, HTML, AI, or blank page',
        aliases: ['iframe', 'web', 'url', 'browser', 'blank', 'page', 'link'],
        run: () => handleToolbarAddNode('iframe'),
      },
      {
        id: 'create-mindmap',
        group: 'create',
        title: 'New mindmap',
        aliases: ['tree', 'topic', 'outline'],
        run: () => handleToolbarAddNode('mindmap'),
      },
      {
        id: 'fit-all',
        group: 'navigate',
        title: 'Fit all nodes in view',
        hint: 'Zoom and center to show every node',
        aliases: ['zoom', 'overview', 'show all'],
        enabled: nodesRef.current.length > 0,
        run: () => fitAllNodes(nodesRef.current),
      },
      {
        id: 'reset-zoom',
        group: 'navigate',
        title: 'Reset zoom to 100%',
        aliases: ['1:1', 'actual size'],
        run: () => resetTransform(),
      },
      {
        id: 'toggle-reference',
        group: 'view',
        title: referenceDrawerOpen ? 'Hide reference drawer' : 'Show reference drawer',
        aliases: ['reference', 'ref', 'drawer', 'context'],
        enabled: !!onReferenceToggle,
        run: () => onReferenceToggle?.(),
      },
      {
        id: 'toggle-chat',
        group: 'view',
        title: chatPanelOpen ? 'Hide chat panel' : 'Show chat panel',
        shortcut: 'Cmd+Shift+A',
        aliases: ['ai', 'sidebar', 'assistant'],
        enabled: !!onChatToggle,
        run: () => onChatToggle?.(),
      },
      {
        id: 'shortcuts',
        group: 'help',
        title: 'Show keyboard shortcuts',
        shortcut: '?',
        aliases: ['keys', 'bindings', 'cheatsheet'],
        run: () => openShortcuts(),
      },
    ];
    return list;
  }, [
    selectedNodeIds,
    setSelectedNodeIds,
    nodesRef,
    duplicateNode,
    requestRemoveNodes,
    groupSelectedNodes,
    ungroupSelectedNodes,
    wrapSelectedNodesInFrame,
    handleToolbarAddNode,
    fitAllNodes,
    resetTransform,
    chatPanelOpen,
    onChatToggle,
    referenceDrawerOpen,
    onReferenceToggle,
    onPinReferenceNode,
    openShortcuts,
    focusModeActive,
    focusModeAvailable,
    toggleFocusMode,
  ]);
};
