import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type RefObject,
} from 'react';
import type { LayerTreeNode } from './utils/layers';
import { ChevronRightIcon, NodeTypeIcon } from '../icons';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import { isContainerNode } from '../../utils/frameHierarchy';
import { isImeComposing } from '../../utils/ime';
import { useI18n } from '../../i18n';

interface LayerItemProps {
  tree: LayerTreeNode;
  collapsedLayers: Set<string>;
  searchActive: boolean;
  selectedNodeIds: Set<string>;
  primarySelectedNodeId?: string;
  onFocus: (nodeId: string) => void;
  onContextMenu: (e: ReactMouseEvent, nodeId: string) => void;
  onToggleCollapse: (id: string) => void;
  onRegisterLayerButton: (nodeId: string, element: HTMLButtonElement | null) => void;
  onLayerKeyDown: (event: ReactKeyboardEvent<HTMLButtonElement>, nodeId: string) => void;
  renamingLayerId: string | null;
  renameLayerValue: string;
  renameLayerInputRef: RefObject<HTMLInputElement>;
  onRenameChange: (value: string) => void;
  onRenameCommit: () => void;
  onRenameCancel: () => void;
}

export const LayerItem = ({
  tree,
  collapsedLayers,
  searchActive,
  selectedNodeIds,
  primarySelectedNodeId,
  onFocus,
  onContextMenu,
  onToggleCollapse,
  onRegisterLayerButton,
  onLayerKeyDown,
  renamingLayerId,
  renameLayerValue,
  renameLayerInputRef,
  onRenameChange,
  onRenameCommit,
  onRenameCancel,
}: LayerItemProps) => {
  const { t } = useI18n();
  const { node, children } = tree;
  const isContainer = isContainerNode(node);
  const isOpen = isContainer && !collapsedLayers.has(node.id);
  const isRenaming = renamingLayerId === node.id;
  const isSelected = selectedNodeIds.has(node.id);
  const isPrimarySelected = primarySelectedNodeId === node.id;
  const displayLabel = getNodeDisplayLabel(node);
  const layerItemRef = useRef<HTMLElement | null>(null);
  const setLayerItemElement = useCallback((element: HTMLElement | null) => {
    layerItemRef.current = element;
    onRegisterLayerButton(node.id, element instanceof HTMLButtonElement ? element : null);
  }, [node.id, onRegisterLayerButton]);
  const layerItemClassName = [
    'sidebar-layer-item',
    isContainer ? 'sidebar-layer-item--frame' : '',
    isSelected ? 'sidebar-layer-item--selected' : '',
    isPrimarySelected ? 'sidebar-layer-item--primary-selected' : '',
  ].filter(Boolean).join(' ');

  useEffect(() => {
    if (!isPrimarySelected) return;
    layerItemRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isPrimarySelected]);

  const handleButtonKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (isContainer && !searchActive) {
      if (event.key === 'ArrowRight' && !isOpen) {
        event.preventDefault();
        onToggleCollapse(node.id);
        return;
      }
      if (event.key === 'ArrowLeft' && isOpen) {
        event.preventDefault();
        onToggleCollapse(node.id);
        return;
      }
    }

    onLayerKeyDown(event, node.id);
  }, [isContainer, isOpen, node.id, onLayerKeyDown, onToggleCollapse, searchActive]);

  return (
    <div className="sidebar-layer-group">
      {isRenaming ? (
        <div ref={setLayerItemElement} className={`${layerItemClassName} sidebar-layer-item--editing`}>
          {isContainer ? (
            <span
              className={`sidebar-layer-chevron${isOpen ? ' sidebar-layer-chevron--open' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.id); }}
            >
              <ChevronRightIcon size={10} />
            </span>
          ) : (
            <span className="sidebar-layer-spacer" aria-hidden="true" />
          )}
          <span className="sidebar-layer-icon">
            <NodeTypeIcon type={node.type} />
          </span>
          <input
            ref={renameLayerInputRef}
            className="sidebar-layer-rename-input"
            value={renameLayerValue}
            onChange={(event) => onRenameChange(event.target.value)}
            onBlur={onRenameCommit}
            onKeyDown={(event) => {
              if (isImeComposing(event)) return;
              if (event.key === 'Enter') onRenameCommit();
              if (event.key === 'Escape') onRenameCancel();
            }}
            onMouseDown={(event) => event.stopPropagation()}
            aria-label={t('sidebar.layerRenameInput')}
          />
        </div>
      ) : (
        <button
          ref={setLayerItemElement}
          className={layerItemClassName}
          onClick={() => onFocus(node.id)}
          onContextMenu={(e) => onContextMenu(e, node.id)}
          onKeyDown={handleButtonKeyDown}
          title={displayLabel}
          aria-current={isPrimarySelected ? 'true' : undefined}
        >
          {isContainer ? (
            <span
              className={`sidebar-layer-chevron${isOpen ? ' sidebar-layer-chevron--open' : ''}`}
              onClick={(e) => { e.stopPropagation(); onToggleCollapse(node.id); }}
            >
              <ChevronRightIcon size={10} />
            </span>
          ) : (
            <span className="sidebar-layer-spacer" aria-hidden="true" />
          )}
          <span className="sidebar-layer-icon">
            <NodeTypeIcon type={node.type} />
          </span>
          <span className="sidebar-layer-name">
            {isContainer
              ? (node.title || (node.data as { label?: string }).label || t('node.type.frame'))
              : displayLabel}
          </span>
          {isContainer && children.length > 0 && (
            <span className="sidebar-layer-child-count">{children.length}</span>
          )}
        </button>
      )}

      {isContainer && children.length > 0 && (
        <div
          className={`sidebar-layer-children${!isOpen ? ' sidebar-layer-children--collapsed' : ''}`}
          aria-hidden={!isOpen}
        >
          <div className="sidebar-layer-children-inner">
            {children.map((child) => (
              <LayerItem
                key={child.node.id}
                tree={child}
                collapsedLayers={collapsedLayers}
                searchActive={searchActive}
                selectedNodeIds={selectedNodeIds}
                primarySelectedNodeId={primarySelectedNodeId}
                onFocus={onFocus}
                onContextMenu={onContextMenu}
                onToggleCollapse={onToggleCollapse}
                onRegisterLayerButton={onRegisterLayerButton}
                onLayerKeyDown={onLayerKeyDown}
                renamingLayerId={renamingLayerId}
                renameLayerValue={renameLayerValue}
                renameLayerInputRef={renameLayerInputRef}
                onRenameChange={onRenameChange}
                onRenameCommit={onRenameCommit}
                onRenameCancel={onRenameCancel}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
