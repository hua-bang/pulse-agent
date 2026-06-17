import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import type { LayerTreeNode } from './utils/layers';
import { LayerItem } from './LayerItem';
import { CloseIcon } from '../icons';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import { CANVAS_NODE_TYPE_LABEL_KEY } from '../../utils/nodeTypeI18n';
import { useI18n } from '../../i18n';

interface LayersPanelProps {
  layerTree: LayerTreeNode[];
  frameIds: string[];
  nodeCount: number;
  anyFrameExpanded: boolean;
  collapsedLayers: Set<string>;
  selectedNodeIds: Set<string>;
  primarySelectedNodeId?: string;
  onNodeFocus: (nodeId: string) => void;
  onContextMenu: (e: ReactMouseEvent, nodeId: string) => void;
  onToggleCollapse: (id: string) => void;
  onToggleAll: () => void;
  renamingLayerId: string | null;
  renameLayerValue: string;
  renameLayerInputRef: RefObject<HTMLInputElement>;
  onLayerRenameChange: (value: string) => void;
  onLayerRenameCommit: () => void;
  onLayerRenameCancel: () => void;
}

const EMPTY_COLLAPSED_LAYERS = new Set<string>();

const normalizeLayerQuery = (value: string) => value.trim().toLocaleLowerCase();

const collectVisibleLayerIds = (items: LayerTreeNode[], collapsedLayers: Set<string>): string[] => {
  const ids: string[] = [];
  const walk = (nodes: LayerTreeNode[]) => {
    for (const item of nodes) {
      ids.push(item.node.id);
      if (item.children.length > 0 && !collapsedLayers.has(item.node.id)) {
        walk(item.children);
      }
    }
  };
  walk(items);
  return ids;
};

export const LayersPanel = ({
  layerTree,
  frameIds,
  nodeCount,
  anyFrameExpanded,
  collapsedLayers,
  selectedNodeIds,
  primarySelectedNodeId,
  onNodeFocus,
  onContextMenu,
  onToggleCollapse,
  onToggleAll,
  renamingLayerId,
  renameLayerValue,
  renameLayerInputRef,
  onLayerRenameChange,
  onLayerRenameCommit,
  onLayerRenameCancel,
}: LayersPanelProps) => {
  const { t } = useI18n();
  const [layerQuery, setLayerQuery] = useState('');
  const layerButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const toggleAllLabel = anyFrameExpanded ? t('sidebar.layersCollapseAll') : t('sidebar.layersExpandAll');
  const normalizedLayerQuery = normalizeLayerQuery(layerQuery);
  const hasLayerQuery = normalizedLayerQuery.length > 0;
  const displayedLayerTree = useMemo(() => {
    if (!hasLayerQuery) return layerTree;

    const matchesLayer = (item: LayerTreeNode) => {
      const displayLabel = getNodeDisplayLabel(item.node);
      const typeLabel = t(CANVAS_NODE_TYPE_LABEL_KEY[item.node.type]);
      return `${displayLabel} ${typeLabel} ${item.node.type}`
        .toLocaleLowerCase()
        .includes(normalizedLayerQuery);
    };

    const filter = (items: LayerTreeNode[]): LayerTreeNode[] => (
      items.flatMap((item) => {
        const children = filter(item.children);
        if (matchesLayer(item) || children.length > 0) {
          return [{ ...item, children }];
        }
        return [];
      })
    );

    return filter(layerTree);
  }, [hasLayerQuery, layerTree, normalizedLayerQuery, t]);
  const effectiveCollapsedLayers = hasLayerQuery ? EMPTY_COLLAPSED_LAYERS : collapsedLayers;
  const visibleLayerIds = useMemo(
    () => collectVisibleLayerIds(displayedLayerTree, effectiveCollapsedLayers),
    [displayedLayerTree, effectiveCollapsedLayers],
  );
  const countLabel = hasLayerQuery
    ? t('sidebar.layersFilterCount', { shown: visibleLayerIds.length, total: nodeCount })
    : String(nodeCount);

  const focusLayerByIndex = useCallback((index: number) => {
    const nodeId = visibleLayerIds[index];
    if (!nodeId) return;
    layerButtonRefs.current.get(nodeId)?.focus();
  }, [visibleLayerIds]);

  const focusLayerByDelta = useCallback((nodeId: string, delta: 1 | -1) => {
    if (visibleLayerIds.length === 0) return;
    const currentIndex = visibleLayerIds.indexOf(nodeId);
    if (currentIndex < 0) return;
    const nextIndex = (currentIndex + delta + visibleLayerIds.length) % visibleLayerIds.length;
    focusLayerByIndex(nextIndex);
  }, [focusLayerByIndex, visibleLayerIds]);

  const registerLayerButton = useCallback((nodeId: string, element: HTMLButtonElement | null) => {
    if (element) layerButtonRefs.current.set(nodeId, element);
    else layerButtonRefs.current.delete(nodeId);
  }, []);

  const handleSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusLayerByIndex(0);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusLayerByIndex(visibleLayerIds.length - 1);
      return;
    }
    if (event.key === 'Enter') {
      const firstNodeId = visibleLayerIds[0];
      if (!firstNodeId) return;
      event.preventDefault();
      onNodeFocus(firstNodeId);
      return;
    }
    if (event.key === 'Escape' && layerQuery) {
      event.preventDefault();
      event.stopPropagation();
      setLayerQuery('');
    }
  }, [focusLayerByIndex, layerQuery, onNodeFocus, visibleLayerIds]);

  const handleLayerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>, nodeId: string) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      focusLayerByDelta(nodeId, 1);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      focusLayerByDelta(nodeId, -1);
    }
  }, [focusLayerByDelta]);

  return (
    <div className="sidebar-layers">
      <div className="sidebar-section-header">
        <span className="sidebar-section-title">{t('sidebar.layers')}</span>
        <div className="sidebar-section-actions">
          <span className="sidebar-layer-count">{countLabel}</span>
          {frameIds.length > 0 && (
            <button
              className="sidebar-section-btn"
              onClick={onToggleAll}
              title={toggleAllLabel}
              aria-label={toggleAllLabel}
            >
              {anyFrameExpanded ? (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M4 2l4 4 4-4M4 14l4-4 4 4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              ) : (
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                  <path
                    d="M4 6l4-4 4 4M4 10l4 4 4-4"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              )}
            </button>
          )}
        </div>
      </div>
      <div className="sidebar-layer-search">
        <input
          className="sidebar-layer-search-input"
          value={layerQuery}
          onChange={(event) => setLayerQuery(event.target.value)}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('sidebar.layersSearchPlaceholder')}
          aria-label={t('sidebar.layersSearchLabel')}
        />
        {layerQuery && (
          <button
            type="button"
            className="sidebar-layer-search-clear"
            onClick={() => setLayerQuery('')}
            title={t('sidebar.layersSearchClear')}
            aria-label={t('sidebar.layersSearchClear')}
          >
            <CloseIcon size={12} />
          </button>
        )}
      </div>
      <div className="sidebar-layers-scroll">
        {displayedLayerTree.length === 0 ? (
          <div className="sidebar-layers-empty">
            <strong>{hasLayerQuery ? t('sidebar.layersSearchNoResultsTitle') : t('sidebar.layersEmptyTitle')}</strong>
            <span>{hasLayerQuery ? t('sidebar.layersSearchNoResultsDescription') : t('sidebar.layersEmptyDescription')}</span>
          </div>
        ) : (
          displayedLayerTree.map((tree) => (
            <LayerItem
              key={tree.node.id}
              tree={tree}
              collapsedLayers={effectiveCollapsedLayers}
              searchActive={hasLayerQuery}
              selectedNodeIds={selectedNodeIds}
              primarySelectedNodeId={primarySelectedNodeId}
              onFocus={onNodeFocus}
              onContextMenu={onContextMenu}
              onToggleCollapse={onToggleCollapse}
              onRegisterLayerButton={registerLayerButton}
              onLayerKeyDown={handleLayerKeyDown}
              renamingLayerId={renamingLayerId}
              renameLayerValue={renameLayerValue}
              renameLayerInputRef={renameLayerInputRef}
              onRenameChange={onLayerRenameChange}
              onRenameCommit={onLayerRenameCommit}
              onRenameCancel={onLayerRenameCancel}
            />
          ))
        )}
      </div>
    </div>
  );
};
