import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react';
import { buildLayerTree, collectFrameIds, type LayerTreeNode } from './utils/layers';
import { useAppShell } from '../AppShellProvider';
import { getNodeDisplayLabel } from '../../../utils/nodeLabel';
import { buildCanvasNodeLink } from '../../../utils/canvasLinks';
import { copyTextToClipboard } from '../../../utils/clipboard';
import { useI18n } from '../../../i18n';
import type { SidebarProps } from './types';

type Options = Pick<SidebarProps, 'activeId' | 'activeNodes' | 'selectedNodeIds' | 'onNodeRename' | 'onNodeDelete'>;

export const useSidebarLayers = ({
  activeId,
  activeNodes = [],
  selectedNodeIds = [],
  onNodeRename,
  onNodeDelete,
}: Options) => {
  const { notify } = useAppShell();
  const { t } = useI18n();
  const [renamingLayerId, setRenamingLayerId] = useState<string | null>(null);
  const [renameLayerValue, setRenameLayerValue] = useState('');
  const [collapsedLayers, setCollapsedLayers] = useState<Set<string>>(new Set());
  const [layerContextMenu, setLayerContextMenu] = useState<{ x: number; y: number; nodeId: string; } | null>(null);
  const layerTree = useMemo(() => buildLayerTree(activeNodes), [activeNodes]);
  const frameIds = useMemo(() => collectFrameIds(layerTree), [layerTree]);
  const selectedLayerIds = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);
  const primarySelectedNodeId = selectedNodeIds[0];
  const anyFrameExpanded = useMemo(() => frameIds.some((id) => !collapsedLayers.has(id)), [frameIds, collapsedLayers]);

  useEffect(() => {
    if (selectedLayerIds.size === 0 || layerTree.length === 0) return;

    const ancestorIds = new Set<string>();
    const walk = (items: LayerTreeNode[], ancestors: string[]) => {
      for (const item of items) {
        if (selectedLayerIds.has(item.node.id)) {
          for (const id of ancestors) ancestorIds.add(id);
        }
        if (item.children.length > 0) {
          walk(item.children, [...ancestors, item.node.id]);
        }
      }
    };

    walk(layerTree, []);
    if (ancestorIds.size === 0) return;

    setCollapsedLayers((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of ancestorIds) {
        if (next.delete(id)) changed = true;
      }
      return changed ? next : prev;
    });
  }, [layerTree, selectedLayerIds]);

  const toggleAllLayers = useCallback(() => {
    setCollapsedLayers((prev) => {
      if (frameIds.length === 0) return prev;
      return frameIds.some((id) => !prev.has(id)) ? new Set(frameIds) : new Set<string>();
    });
  }, [frameIds]);

  const handleLayerContextMenu = useCallback((e: ReactMouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setLayerContextMenu({ x: e.clientX, y: e.clientY, nodeId });
  }, []);

  // Dismissal (outside-press + Escape) is owned by LayerContextMenu's
  // Popover shell (useClickOutside + useMenuKeyboardNav/useEscapeClose), so
  // no hand-rolled listeners live here anymore.

  const toggleLayerCollapse = useCallback((id: string) => {
    setCollapsedLayers((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }, []);

  const renameLayerInputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (renamingLayerId && renameLayerInputRef.current) {
      renameLayerInputRef.current.focus();
      renameLayerInputRef.current.select();
    }
  }, [renamingLayerId]);

  const startLayerRename = (nodeId: string) => {
    const node = activeNodes.find((item) => item.id === nodeId);
    if (!node) return;
    setRenamingLayerId(nodeId);
    setRenameLayerValue(node.title || getNodeDisplayLabel(node));
  };
  const commitLayerRename = () => {
    if (!renamingLayerId) return;
    const nextTitle = renameLayerValue.trim();
    const node = activeNodes.find((item) => item.id === renamingLayerId);
    setRenamingLayerId(null);
    if (!node || !onNodeRename || !nextTitle || node.title === nextTitle) return;
    onNodeRename(renamingLayerId, nextTitle);
    notify({
      tone: 'success',
      title: t('sidebar.layerRenamed'),
      description: `${getNodeDisplayLabel(node)} -> ${nextTitle}`,
    });
  };
  const handleLayerDelete = useCallback((nodeId: string) => {
    const node = activeNodes.find((item) => item.id === nodeId);
    if (!node || !onNodeDelete) return;

    onNodeDelete(nodeId);
  }, [activeNodes, onNodeDelete]);

  const handleLayerCopyLink = useCallback(async (nodeId: string) => {
    const node = activeNodes.find((item) => item.id === nodeId);
    if (!node) return;

    try {
      await copyTextToClipboard(buildCanvasNodeLink(activeId, nodeId));
      notify({
        tone: 'success',
        title: t('sidebar.nodeLinkCopied'),
        description: getNodeDisplayLabel(node),
      });
    } catch (error) {
      notify({
        tone: 'error',
        title: t('sidebar.copyFailed'),
        description: error instanceof Error ? error.message : t('sidebar.copyFailedDescription'),
        autoCloseMs: 4200,
      });
    }
  }, [activeNodes, activeId, notify, t]);

  return {
    layerTree,
    frameIds,
    selectedLayerIds,
    primarySelectedNodeId,
    anyFrameExpanded,
    collapsedLayers,
    layerContextMenu,
    setLayerContextMenu,
    toggleAllLayers,
    handleLayerContextMenu,
    toggleLayerCollapse,
    renamingLayerId,
    setRenamingLayerId,
    renameLayerValue,
    setRenameLayerValue,
    renameLayerInputRef,
    startLayerRename,
    commitLayerRename,
    handleLayerDelete,
    handleLayerCopyLink,
  };
};
