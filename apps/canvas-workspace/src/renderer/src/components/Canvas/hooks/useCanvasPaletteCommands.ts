import { useMemo, type MutableRefObject } from 'react';
import type { CanvasNode } from '../../../types';
import type { CreatableCanvasNodeType } from '../../../utils/nodeFactory';
import type { PaletteCommand } from '../../CommandPalette';
import type { AddNodeOptions } from '../../../hooks/useNodes';
import { useI18n } from '../../../i18n';

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
    type: CreatableCanvasNodeType,
    options?: AddNodeOptions & { label?: string },
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
  const { t } = useI18n();

  return useMemo<PaletteCommand[]>(() => {
    const selectionCount = selectedNodeIds.length;
    const list: PaletteCommand[] = [
      {
        id: 'duplicate-selection',
        group: 'edit',
        title: selectionCount > 1
          ? t('canvas.palette.command.duplicateMany', { count: selectionCount })
          : t('canvas.palette.command.duplicateOne'),
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
          ? t('canvas.palette.command.deleteMany', { count: selectionCount })
          : t('canvas.palette.command.deleteOne'),
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
          ? t('canvas.palette.command.groupMany', { count: selectionCount })
          : t('canvas.palette.command.groupOne'),
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
        title: t('canvas.palette.command.ungroup'),
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
          ? t('canvas.palette.command.wrapMany', { count: selectionCount })
          : t('canvas.palette.command.wrapOne'),
        aliases: ['frame', 'wrap'],
        enabled: selectionCount > 0,
        run: () => {
          wrapSelectedNodesInFrame();
        },
      },
      {
        id: 'pin-reference',
        group: 'view',
        title: selectionCount === 1
          ? t('canvas.palette.command.pinSelected')
          : t('canvas.palette.command.pinNode'),
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
        title: focusModeActive
          ? t('canvas.palette.command.exitFocus')
          : t('canvas.palette.command.focusSelected'),
        shortcut: 'F',
        aliases: ['focus', 'spotlight', 'dim'],
        enabled: focusModeActive || focusModeAvailable,
        run: toggleFocusMode,
      },
      {
        id: 'create-note',
        group: 'create',
        title: t('canvas.palette.command.newNote'),
        hint: t('canvas.palette.command.newNoteHint'),
        aliases: ['file', 'markdown', 'doc', 'md'],
        run: () => handleToolbarAddNode('file'),
      },
      {
        id: 'create-agent',
        group: 'create',
        title: t('canvas.palette.command.createAgent'),
        hint: t('canvas.palette.command.createAgentHint'),
        aliases: ['ai', 'chat', 'assistant', 'claude'],
        run: () => handleToolbarAddNode('agent'),
      },
      {
        id: 'create-text',
        group: 'create',
        title: t('canvas.palette.command.addText'),
        aliases: ['label', 'sticky', 'note'],
        run: () => handleToolbarAddNode('text'),
      },
      {
        id: 'create-frame',
        group: 'create',
        title: t('canvas.palette.command.addFrame'),
        hint: t('canvas.palette.command.addFrameHint'),
        aliases: ['section', 'box', 'container'],
        run: () => handleToolbarAddNode('frame'),
      },
      {
        id: 'create-link',
        group: 'create',
        title: t('canvas.palette.command.webPage'),
        hint: t('canvas.palette.command.webPageHint'),
        aliases: ['iframe', 'web', 'url', 'browser', 'blank', 'page', 'link'],
        run: () => handleToolbarAddNode('iframe'),
      },
      {
        id: 'create-terminal',
        group: 'create',
        title: t('canvas.palette.command.newTerminal'),
        hint: t('canvas.palette.command.newTerminalHint'),
        aliases: ['shell', 'pty', 'command', 'run'],
        run: () => handleToolbarAddNode('terminal'),
      },
      {
        id: 'create-mindmap',
        group: 'create',
        title: t('canvas.palette.command.newMindmap'),
        aliases: ['tree', 'topic', 'outline'],
        run: () => handleToolbarAddNode('mindmap'),
      },
      {
        id: 'fit-all',
        group: 'navigate',
        title: t('canvas.palette.command.fitAll'),
        hint: t('canvas.palette.command.fitAllHint'),
        aliases: ['zoom', 'overview', 'show all'],
        enabled: nodesRef.current.length > 0,
        run: () => fitAllNodes(nodesRef.current),
      },
      {
        id: 'reset-zoom',
        group: 'navigate',
        title: t('canvas.palette.command.resetZoom'),
        aliases: ['1:1', 'actual size'],
        run: () => resetTransform(),
      },
      {
        id: 'toggle-reference',
        group: 'view',
        title: referenceDrawerOpen
          ? t('canvas.palette.command.hideReference')
          : t('canvas.palette.command.showReference'),
        aliases: ['reference', 'ref', 'drawer', 'context'],
        enabled: !!onReferenceToggle,
        run: () => onReferenceToggle?.(),
      },
      {
        id: 'toggle-chat',
        group: 'view',
        title: chatPanelOpen
          ? t('canvas.palette.command.hideChat')
          : t('canvas.palette.command.showChat'),
        shortcut: 'Cmd+Shift+A',
        aliases: ['ai', 'sidebar', 'assistant'],
        enabled: !!onChatToggle,
        run: () => onChatToggle?.(),
      },
      {
        id: 'shortcuts',
        group: 'help',
        title: t('canvas.palette.command.shortcuts'),
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
    t,
  ]);
};
