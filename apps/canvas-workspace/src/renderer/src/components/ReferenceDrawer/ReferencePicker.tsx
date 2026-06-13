import { useEffect, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import type { CanvasNode } from '../../types';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
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
  const [workspaceMenuOpen, setWorkspaceMenuOpen] = useState(false);
  const selectedWorkspace = externalWorkspaces.find((workspace) => workspace.id === externalWorkspaceId);

  useEffect(() => {
    if (pickerOpen !== 'other') setWorkspaceMenuOpen(false);
  }, [pickerOpen]);

  return (
    <div className="reference-picker-anchor" ref={pickerRef}>
      <button
        className={`reference-drawer-action reference-drawer-action--ghost${pickerOpen === 'current' ? ' reference-drawer-action--open' : ''}`}
        type="button"
        onClick={() => {
          setWorkspaceMenuOpen(false);
          setSearchDraft('');
          setPickerOpen((prev) => prev === 'current' ? null : 'current');
        }}
        disabled={currentNodeCount === 0}
        title={currentNodeCount === 0 ? 'No more current workspace nodes to pin' : 'Pick a current workspace node'}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen === 'current'}
      >
        <ListIcon />
        Current workspace
      </button>

      <button
        className={`reference-drawer-action reference-drawer-action--ghost${pickerOpen === 'other' ? ' reference-drawer-action--open' : ''}`}
        type="button"
        onClick={() => {
          setWorkspaceMenuOpen(false);
          setSearchDraft('');
          setPickerOpen((prev) => prev === 'other' ? null : 'other');
        }}
        disabled={externalWorkspaces.length === 0}
        title={externalWorkspaces.length === 0 ? 'No other workspaces yet' : 'Pick a node from another workspace'}
        aria-haspopup="dialog"
        aria-expanded={pickerOpen === 'other'}
      >
        <BranchIcon />
        Other workspace
      </button>

      {pickerOpen && (
        <div className="reference-picker-popover" role="dialog" aria-label="Pick canvas reference">
          {pickerOpen === 'other' && (
            <div className="reference-workspace-picker">
              <span className="reference-workspace-picker-label">Workspace</span>
              <button
                type="button"
                className={`reference-workspace-select${workspaceMenuOpen ? ' reference-workspace-select--open' : ''}`}
                onClick={() => setWorkspaceMenuOpen((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={workspaceMenuOpen}
              >
                <span className="reference-workspace-select-name">
                  {selectedWorkspace?.name ?? 'Choose workspace'}
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
                <div className="reference-workspace-options" role="listbox" aria-label="Workspace">
                  {externalWorkspaces.map((workspace) => {
                    const selected = workspace.id === externalWorkspaceId;
                    return (
                      <button
                        key={workspace.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
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
                value={searchDraft}
                onChange={(e) => setSearchDraft(e.target.value)}
                placeholder={pickerOpen === 'other' ? 'Search selected workspace' : 'Search current workspace'}
                aria-label="Search canvas nodes"
              />
              {searchDraft && (
                <button
                  type="button"
                  className="reference-search-clear"
                  onClick={() => setSearchDraft('')}
                  aria-label="Clear canvas node search"
                  title="Clear search"
                >
                  x
                </button>
              )}
            </div>
          </div>
          <ReferencePickerList
            allNodes={allNodes}
            externalWorkspaceId={externalWorkspaceId}
            pickerOpen={pickerOpen}
            pickableNodeGroups={pickableNodeGroups}
            pickableNodes={pickableNodes}
            searchActive={searchActive}
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
  pickerOpen: ReferencePickerMode;
  pickableNodeGroups: ReferencePickerNodeGroup[];
  pickableNodes: CanvasNode[];
  searchActive: boolean;
  workspaceNameById: Map<string, string>;
  onPick: (nodeId: string) => void;
}

const ReferencePickerList = ({
  allNodes,
  externalWorkspaceId,
  pickerOpen,
  pickableNodeGroups,
  pickableNodes,
  searchActive,
  workspaceNameById,
  onPick,
}: ReferencePickerListProps) => (
  <div className="reference-picker-list" role="listbox">
    {pickerOpen === 'other' && externalWorkspaceId && !Object.prototype.hasOwnProperty.call(allNodes, externalWorkspaceId) ? (
      <div className="reference-picker-empty">Loading workspace nodes...</div>
    ) : pickableNodes.length === 0 ? (
      <div className="reference-picker-empty">
        {searchActive ? 'No canvas nodes match this search.' : 'All eligible nodes are pinned.'}
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
              onClick={() => onPick(node.id)}
            >
              <span className="reference-picker-item-type">{node.type}</span>
              <span className="reference-picker-item-label">{getNodeDisplayLabel(node)}</span>
              {workspaceName ? <span className="reference-picker-item-workspace">{workspaceName}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};
