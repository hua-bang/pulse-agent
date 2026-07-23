import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SetStateAction,
} from 'react';
import type { CanvasNode } from '../../types';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { useMenuKeyboardNav } from '../../hooks/useMenuKeyboardNav';
import { Button } from '../ui';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import { CANVAS_NODE_TYPE_LABEL_KEY } from '../../utils/nodeTypeI18n';
import { useI18n } from '../../i18n';
import { BranchIcon, ListIcon, SearchIcon } from './Icons';
import type { ReferencePickerMode, ReferencePickerNodeGroup } from './types';
import { getReferenceGroupIcon } from './utils';

interface ReferencePickerProps {
  allNodes: Record<string, CanvasNode[]>;
  currentNodeCount: number;
  externalWorkspaceId?: string;
  externalWorkspaces: WorkspaceEntry[];
  pickerOpen: ReferencePickerMode | null;
  pickerRef: RefObject<HTMLDivElement>;
  pickableNodeGroups: ReferencePickerNodeGroup[];
  pickableNodes: CanvasNode[];
  searchActive: boolean;
  searchDraft: string;
  setExternalWorkspaceId: (workspaceId: string | undefined) => void;
  setPickerOpen: Dispatch<SetStateAction<ReferencePickerMode | null>>;
  setSearchDraft: (value: string) => void;
  workspaceNameById: Map<string, string>;
  onPick: (nodeId: string) => void;
}

export const ReferencePicker = ({
  allNodes,
  currentNodeCount,
  externalWorkspaceId,
  externalWorkspaces,
  pickerOpen,
  pickerRef,
  pickableNodeGroups,
  pickableNodes,
  searchActive,
  searchDraft,
  setExternalWorkspaceId,
  setPickerOpen,
  setSearchDraft,
  workspaceNameById,
  onPick,
}: ReferencePickerProps) => {
  const { t } = useI18n();
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const pickerPopoverId = useId();
  const pickerListId = useId();
  const workspaceOptionsId = useId();
  const workspaceOptionsRef = useRef<HTMLDivElement>(null);
  const pickerListRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const currentTriggerRef = useRef<HTMLButtonElement>(null);
  const otherTriggerRef = useRef<HTMLButtonElement>(null);
  const lastPickerTriggerRef = useRef<HTMLButtonElement | null>(null);
  const workspaceSelectRef = useRef<HTMLButtonElement>(null);
  const selectedWorkspace = externalWorkspaces.find((workspace) => workspace.id === externalWorkspaceId);

  useEffect(() => {
    if (pickerOpen !== 'other') setWorkspaceMenuOpen(false);
  }, [pickerOpen]);

  useEffect(() => {
    if (!pickerOpen) return;
    const frame = window.requestAnimationFrame(() => searchInputRef.current?.focus());
    return () => window.cancelAnimationFrame(frame);
  }, [pickerOpen]);

  const closePicker = useCallback((restoreFocus = false) => {
    setPickerOpen(null);
    setWorkspaceMenuOpen(false);
    if (restoreFocus) {
      lastPickerTriggerRef.current?.focus();
    }
  }, [setPickerOpen]);

  const closeWorkspaceMenu = useCallback((restoreFocus = false) => {
    setWorkspaceMenuOpen(false);
    if (restoreFocus) {
      workspaceSelectRef.current?.focus();
    }
  }, []);

  useMenuKeyboardNav(workspaceOptionsRef, () => closeWorkspaceMenu(true), workspaceMenuOpen);
  useMenuKeyboardNav(pickerListRef, () => closePicker(true), {
    enabled: !!pickerOpen && !workspaceMenuOpen,
    autoFocus: false,
    scope: 'within',
  });

  const focusPickerItem = useCallback((position: 'first' | 'last' = 'first') => {
    const items = Array.from(
      pickerListRef.current?.querySelectorAll<HTMLButtonElement>('.reference-picker-item:not(:disabled)') ?? [],
    );
    if (items.length === 0) return false;
    items[position === 'first' ? 0 : items.length - 1].focus();
    return true;
  }, []);

  const handleSearchKeyDown = useCallback((event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      closePicker(true);
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const moved = focusPickerItem(event.key === 'ArrowUp' ? 'last' : 'first');
    if (!moved) return;
    event.preventDefault();
    event.stopPropagation();
  }, [closePicker, focusPickerItem]);

  return (
    <div className="reference-picker-anchor" ref={pickerRef}>
      <Button
        ref={currentTriggerRef}
        size="sm"
        className={`reference-drawer-action reference-drawer-action--ghost${pickerOpen === 'current' ? ' reference-drawer-action--open' : ''}`}
        onClick={() => {
          lastPickerTriggerRef.current = currentTriggerRef.current;
          setWorkspaceMenuOpen(false);
          setSearchDraft('');
          setPickerOpen((prev) => prev === 'current' ? null : 'current');
        }}
        disabled={currentNodeCount === 0}
        title={currentNodeCount === 0 ? t('reference.currentWorkspaceEmptyTitle') : t('reference.currentWorkspaceTitle')}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen === 'current'}
        aria-controls={pickerOpen === 'current' ? pickerPopoverId : undefined}
      >
        <ListIcon />
        {t('reference.currentWorkspace')}
      </Button>

      <Button
        ref={otherTriggerRef}
        size="sm"
        className={`reference-drawer-action reference-drawer-action--ghost${pickerOpen === 'other' ? ' reference-drawer-action--open' : ''}`}
        onClick={() => {
          lastPickerTriggerRef.current = otherTriggerRef.current;
          setWorkspaceMenuOpen(false);
          setSearchDraft('');
          setPickerOpen((prev) => prev === 'other' ? null : 'other');
        }}
        disabled={externalWorkspaces.length === 0}
        title={externalWorkspaces.length === 0 ? t('reference.otherWorkspaceEmptyTitle') : t('reference.otherWorkspaceTitle')}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen === 'other'}
        aria-controls={pickerOpen === 'other' ? pickerPopoverId : undefined}
      >
        <BranchIcon />
        {t('reference.otherWorkspace')}
      </Button>

      {pickerOpen && (
        <div id={pickerPopoverId} className="reference-picker-popover" role="dialog" aria-label={t('reference.pickDialog')}>
          {pickerOpen === 'other' && (
            <div className="reference-workspace-picker">
              <span className="reference-workspace-picker-label">{t('reference.workspace')}</span>
              <button
                ref={workspaceSelectRef}
                type="button"
                className={`reference-workspace-select${workspaceMenuOpen ? ' reference-workspace-select--open' : ''}`}
                onClick={() => setWorkspaceMenuOpen((prev) => !prev)}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') {
                    return;
                  }
                  event.preventDefault();
                  event.stopPropagation();
                  setWorkspaceMenuOpen(true);
                }}
                aria-haspopup="listbox"
                aria-expanded={workspaceMenuOpen}
                aria-controls={workspaceMenuOpen ? workspaceOptionsId : undefined}
                aria-label={t('reference.workspace')}
              >
                <span className="reference-workspace-select-name">
                  {selectedWorkspace?.name ?? t('reference.chooseWorkspace')}
                </span>
                <svg
                  className="reference-workspace-select-caret"
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  aria-hidden="true"
                >
                  <path d="M3.5 4.5L6 7l2.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </button>
              {workspaceMenuOpen && (
                <div
                  ref={workspaceOptionsRef}
                  id={workspaceOptionsId}
                  className="reference-workspace-options"
                  role="listbox"
                  aria-label={t('reference.workspace')}
                >
                  {externalWorkspaces.map((workspace) => {
                    const selected = workspace.id === externalWorkspaceId;
                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        data-menu-autofocus={selected ? 'true' : undefined}
                        className={`reference-workspace-option${selected ? ' reference-workspace-option--selected' : ''}`}
                        onClick={() => {
                          setExternalWorkspaceId(workspace.id);
                          setSearchDraft('');
                          setWorkspaceMenuOpen(false);
                        }}
                      >
                        <span className="reference-workspace-option-check" aria-hidden="true">
                          {selected ? '✓' : ''}
                        </span>
                        <span className="reference-workspace-option-name">{workspace.name}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="reference-picker-controls">
            <div className="reference-picker-search">
              <SearchIcon />
              <input
                ref={searchInputRef}
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                placeholder={pickerOpen === 'other' ? t('reference.searchSelectedWorkspace') : t('reference.searchCurrentWorkspace')}
                role="combobox"
                aria-autocomplete="list"
                aria-expanded={true}
                aria-controls={pickerListId}
                aria-label={t('reference.searchNodes')}
              />
              {searchDraft && (
                <button
                  type="button"
                  className="reference-search-clear"
                  onClick={() => setSearchDraft('')}
                  aria-label={t('reference.clearSearch')}
                  title={t('reference.clearSearch')}
                >
                  x
                </button>
              )}
            </div>
          </div>
          <ReferencePickerList
            allNodes={allNodes}
            externalWorkspaceId={externalWorkspaceId}
            listId={pickerListId}
            listRef={pickerListRef}
            pickerOpen={pickerOpen}
            pickableNodeGroups={pickableNodeGroups}
            pickableNodes={pickableNodes}
            searchActiveText={searchActive ? t('reference.noSearchMatches') : t('reference.allEligiblePinned')}
            workspaceNameById={workspaceNameById}
            onPick={onPick}
          />
        </div>
      )}
    </div>
  );
};

interface ReferencePickerListProps {
  allNodes: Record<string, CanvasNode[]>;
  externalWorkspaceId?: string;
  listId: string;
  listRef: RefObject<HTMLDivElement>;
  pickerOpen: ReferencePickerMode;
  pickableNodeGroups: ReferencePickerNodeGroup[];
  pickableNodes: CanvasNode[];
  searchActiveText: string;
  workspaceNameById: Map<string, string>;
  onPick: (nodeId: string) => void;
}

const ReferencePickerList = ({
  allNodes,
  externalWorkspaceId,
  listId,
  listRef,
  pickerOpen,
  pickableNodeGroups,
  pickableNodes,
  searchActiveText,
  workspaceNameById,
  onPick,
}: ReferencePickerListProps) => {
  const { t } = useI18n();

  return (
    <div id={listId} ref={listRef} className="reference-picker-list" role="listbox" aria-label={t('reference.searchNodes')}>
      {pickerOpen === 'other' && externalWorkspaceId && !Object.prototype.hasOwnProperty.call(allNodes, externalWorkspaceId) ? (
        <div className="reference-picker-empty">{t('reference.loadingWorkspaceNodes')}</div>
      ) : pickableNodes.length === 0 ? (
        <div className="reference-picker-empty">
          {searchActiveText}
        </div>
      ) : (
        pickableNodeGroups.map((group) => (
          <ReferencePickerGroupSection
            key={group.type}
            type={group.type}
            name={group.name}
            nodes={group.nodes}
            workspaceName={pickerOpen === 'other' && externalWorkspaceId ? workspaceNameById.get(externalWorkspaceId) : undefined}
            onPick={onPick}
          />
        ))
      )}
    </div>
  );
};

interface ReferencePickerGroupSectionProps {
  name: string;
  type: CanvasNode['type'];
  nodes: CanvasNode[];
  workspaceName?: string;
  onPick: (nodeId: string) => void;
}

const ReferencePickerGroupSection = ({
  name,
  type,
  nodes,
  workspaceName,
  onPick,
}: ReferencePickerGroupSectionProps) => {
  const { t } = useI18n();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`reference-picker-group reference-group--type-${type}${collapsed ? ' reference-group--collapsed' : ''}`}>
      <button
        className="reference-group-header"
        type="button"
        onClick={() => setCollapsed((prev) => !prev)}
        aria-expanded={!collapsed}
      >
        <svg
          className="reference-group-caret"
          width="10"
          height="10"
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path d="M4 3l4 3-4 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="reference-group-type-icon" aria-hidden="true">{getReferenceGroupIcon(type)}</span>
        <span className="reference-group-name">{name}</span>
        <span className="reference-group-count">{nodes.length}</span>
      </button>
      {!collapsed && (
        <div className="reference-picker-group-items">
          {nodes.map((node) => (
            <button
              key={node.id}
              className="reference-picker-item"
              type="button"
              role="option"
              aria-selected={false}
              onClick={() => onPick(node.id)}
            >
              <span className="reference-picker-item-type">{t(CANVAS_NODE_TYPE_LABEL_KEY[node.type])}</span>
              <span className="reference-picker-item-label">{getNodeDisplayLabel(node)}</span>
              {workspaceName ? <span className="reference-picker-item-workspace">{workspaceName}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
