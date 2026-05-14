import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import type { CanvasNode } from '../../types';
import { CanvasNodeView } from '../CanvasNodeView';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';

const DEFAULT_REFERENCE_DRAWER_WIDTH = 420;
const MIN_REFERENCE_DRAWER_WIDTH = 320;
const MAX_REFERENCE_DRAWER_WIDTH = 720;

const UNGROUPED_LABEL = 'Ungrouped';

export interface ReferenceEntry {
  nodeId: string;
  group?: string;
}

interface ReferenceDrawerProps {
  open: boolean;
  references: ReferenceEntry[];
  activeReferenceNode?: CanvasNode;
  activeReferenceGroup?: string;
  nodes: CanvasNode[];
  selectedNode?: CanvasNode;
  onOpenChange: (open: boolean) => void;
  onSelectReference: (nodeId: string | undefined) => void;
  onRemoveReference: (nodeId: string) => void;
  onClearAll: () => void;
  onAddReference: (nodeId: string, group?: string) => void;
  onSetReferenceGroup: (nodeId: string, group: string | undefined) => void;
  onFocusNode: (nodeId: string) => void;
}

export const ReferenceDrawer = ({
  open,
  references,
  activeReferenceNode,
  activeReferenceGroup,
  nodes,
  selectedNode,
  onOpenChange,
  onSelectReference,
  onRemoveReference,
  onClearAll,
  onAddReference,
  onSetReferenceGroup,
  onFocusNode,
}: ReferenceDrawerProps) => {
  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_REFERENCE_DRAWER_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [isActive, setIsActive] = useState(open);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [groupEditorOpen, setGroupEditorOpen] = useState(false);
  const [groupDraft, setGroupDraft] = useState('');
  const groupEditorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      const frame = window.requestAnimationFrame(() => setIsActive(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setIsActive(false);
    const timer = window.setTimeout(() => setShouldRender(false), 240);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!groupEditorOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!groupEditorRef.current?.contains(event.target as Node)) {
        setGroupEditorOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [groupEditorOpen]);

  const drawerStyle = useMemo(
    () => ({
      '--reference-drawer-width': `${drawerWidth}px`,
    }) as React.CSSProperties,
    [drawerWidth],
  );

  const handleResizeStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = drawerWidth;
    setIsResizing(true);

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = startWidth + event.clientX - startX;
      setDrawerWidth(Math.min(MAX_REFERENCE_DRAWER_WIDTH, Math.max(MIN_REFERENCE_DRAWER_WIDTH, nextWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [drawerWidth]);

  const nodeById = useMemo(() => {
    const map = new Map<string, CanvasNode>();
    for (const node of nodes) map.set(node.id, node);
    return map;
  }, [nodes]);

  const groups = useMemo(() => {
    const map = new Map<string, ReferenceEntry[]>();
    for (const entry of references) {
      const key = entry.group?.trim() || UNGROUPED_LABEL;
      const list = map.get(key);
      if (list) list.push(entry);
      else map.set(key, [entry]);
    }
    const ordered: { name: string; entries: ReferenceEntry[] }[] = [];
    const ungrouped = map.get(UNGROUPED_LABEL);
    if (ungrouped) ordered.push({ name: UNGROUPED_LABEL, entries: ungrouped });
    for (const [name, entries] of map) {
      if (name === UNGROUPED_LABEL) continue;
      ordered.push({ name, entries });
    }
    return ordered;
  }, [references]);

  const knownGroupNames = useMemo(() => {
    const set = new Set<string>();
    for (const entry of references) {
      if (entry.group?.trim()) set.add(entry.group.trim());
    }
    return Array.from(set);
  }, [references]);

  const pickableNodes = useMemo(() => {
    const referenced = new Set(references.map((entry) => entry.nodeId));
    return nodes
      .filter((node) => !referenced.has(node.id))
      .filter((node) => node.type !== 'frame' && node.type !== 'group');
  }, [nodes, references]);

  const handlePinSelected = useCallback(() => {
    if (!selectedNode) return;
    onAddReference(selectedNode.id);
  }, [selectedNode, onAddReference]);

  const handleAddFromPicker = useCallback((nodeId: string) => {
    onAddReference(nodeId);
    setPickerOpen(false);
  }, [onAddReference]);

  const handleApplyGroup = useCallback(() => {
    if (!activeReferenceNode) return;
    const next = groupDraft.trim();
    onSetReferenceGroup(activeReferenceNode.id, next || undefined);
    setGroupEditorOpen(false);
  }, [activeReferenceNode, groupDraft, onSetReferenceGroup]);

  const openGroupEditor = useCallback(() => {
    setGroupDraft(activeReferenceGroup ?? '');
    setGroupEditorOpen(true);
  }, [activeReferenceGroup]);

  if (!shouldRender) return null;

  const hasReferences = references.length > 0;
  const canPinSelected = !!selectedNode && !references.some((entry) => entry.nodeId === selectedNode.id);

  return (
    <aside
      className={`reference-drawer${isActive ? ' reference-drawer--open' : ''}${isResizing ? ' reference-drawer--resizing' : ''}`}
      style={drawerStyle}
      aria-hidden={!isActive}
    >
      <div
        className="reference-drawer-resize-handle"
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize reference drawer"
        title="Drag to resize"
      />
      <header className="reference-drawer-header">
        <div>
          <div className="reference-drawer-kicker">Pinned context</div>
          <h2>Reference</h2>
        </div>
        <button
          className="reference-drawer-icon-button"
          type="button"
          onClick={() => onOpenChange(false)}
          title="Close reference panel"
          aria-label="Close reference panel"
        >
          ×
        </button>
      </header>

      <div className="reference-drawer-toolbar">
        <button
          className="reference-drawer-action"
          type="button"
          onClick={handlePinSelected}
          disabled={!canPinSelected}
          title={
            selectedNode
              ? canPinSelected
                ? `Pin "${getNodeDisplayLabel(selectedNode)}"`
                : 'Already pinned'
              : 'Select a node on the canvas first'
          }
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
          Pin selection
        </button>
        <button
          className="reference-drawer-action reference-drawer-action--ghost"
          type="button"
          onClick={() => setPickerOpen((prev) => !prev)}
          disabled={pickableNodes.length === 0}
          title={pickableNodes.length === 0 ? 'No more nodes to pin' : 'Pick a node to pin'}
        >
          <svg width="13" height="13" viewBox="0 0 16 16" fill="none">
            <path d="M3 6h10M3 10h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          From canvas
          <svg width="9" height="9" viewBox="0 0 12 12" fill="none">
            <path d="M3 4.5l3 3 3-3" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>

      {pickerOpen && (
        <div className="reference-picker">
          <div className="reference-picker-list" role="listbox">
            {pickableNodes.length === 0 ? (
              <div className="reference-picker-empty">All eligible nodes are pinned.</div>
            ) : (
              pickableNodes.map((node) => (
                <button
                  key={node.id}
                  className="reference-picker-item"
                  type="button"
                  onClick={() => handleAddFromPicker(node.id)}
                >
                  <span className="reference-picker-item-type">{node.type}</span>
                  <span className="reference-picker-item-label">{getNodeDisplayLabel(node)}</span>
                </button>
              ))
            )}
          </div>
        </div>
      )}

      <div className="reference-drawer-content">
        {!hasReferences ? (
          <ReferenceEmptyState selectedNode={selectedNode} />
        ) : (
          <>
            <div className="reference-group-list">
              {groups.map((group) => (
                <ReferenceGroupSection
                  key={group.name}
                  name={group.name}
                  entries={group.entries}
                  nodeById={nodeById}
                  activeId={activeReferenceNode?.id}
                  onSelect={onSelectReference}
                  onFocus={onFocusNode}
                  onRemove={onRemoveReference}
                />
              ))}
            </div>

            {activeReferenceNode ? (
              <div className="reference-native-card">
                <div className="reference-card-meta">
                  <span className="reference-card-meta-type">{activeReferenceNode.type}</span>
                  <span className="reference-card-meta-title" title={getNodeDisplayLabel(activeReferenceNode)}>
                    {getNodeDisplayLabel(activeReferenceNode)}
                  </span>
                  <div className="reference-card-meta-group" ref={groupEditorRef}>
                    <button
                      type="button"
                      className="reference-group-chip"
                      onClick={openGroupEditor}
                      title="Change group"
                    >
                      {activeReferenceGroup ?? 'Add to group'}
                    </button>
                    {groupEditorOpen && (
                      <div className="reference-group-editor" role="dialog">
                        <input
                          autoFocus
                          className="reference-group-input"
                          value={groupDraft}
                          placeholder="Group name"
                          onChange={(e) => setGroupDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                              e.preventDefault();
                              handleApplyGroup();
                            } else if (e.key === 'Escape') {
                              setGroupEditorOpen(false);
                            }
                          }}
                        />
                        {knownGroupNames.length > 0 && (
                          <div className="reference-group-suggestions">
                            {knownGroupNames
                              .filter((name) => name !== activeReferenceGroup)
                              .map((name) => (
                                <button
                                  key={name}
                                  type="button"
                                  className="reference-group-suggestion"
                                  onClick={() => {
                                    onSetReferenceGroup(activeReferenceNode.id, name);
                                    setGroupEditorOpen(false);
                                  }}
                                >
                                  {name}
                                </button>
                              ))}
                          </div>
                        )}
                        <div className="reference-group-editor-actions">
                          {activeReferenceGroup && (
                            <button
                              type="button"
                              className="reference-drawer-secondary"
                              onClick={() => {
                                onSetReferenceGroup(activeReferenceNode.id, undefined);
                                setGroupEditorOpen(false);
                              }}
                            >
                              Remove group
                            </button>
                          )}
                          <button
                            type="button"
                            className="reference-drawer-primary"
                            onClick={handleApplyGroup}
                          >
                            Apply
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                <CanvasNodeView
                  node={{
                    ...activeReferenceNode,
                    x: 0,
                    y: 0,
                    width: Math.max(MIN_REFERENCE_DRAWER_WIDTH - 32, drawerWidth - 32),
                    height: 420,
                  }}
                  getAllNodes={() => [activeReferenceNode]}
                  isDragging={false}
                  isResizing={false}
                  isSelected={false}
                  isHighlighted={false}
                  onDragStart={() => undefined}
                  onResizeStart={() => undefined}
                  onUpdate={() => undefined}
                  onAutoResize={() => undefined}
                  onRemove={() => undefined}
                  onExportMindmapImage={() => undefined}
                  onSelect={() => undefined}
                  onFocus={() => onFocusNode(activeReferenceNode.id)}
                  readOnly
                />
                <div className="reference-card-footer">
                  <button
                    className="reference-drawer-secondary"
                    type="button"
                    onClick={() => onFocusNode(activeReferenceNode.id)}
                    title="Focus on canvas"
                  >
                    Focus
                  </button>
                  <button
                    className="reference-drawer-secondary"
                    type="button"
                    onClick={() => onRemoveReference(activeReferenceNode.id)}
                  >
                    Unpin
                  </button>
                  <button
                    className="reference-drawer-secondary"
                    type="button"
                    onClick={onClearAll}
                    title="Remove all references"
                  >
                    Clear all
                  </button>
                </div>
              </div>
            ) : (
              <div className="reference-pick-hint">Pick a reference above to preview it here.</div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};

interface ReferenceGroupSectionProps {
  name: string;
  entries: ReferenceEntry[];
  nodeById: Map<string, CanvasNode>;
  activeId?: string;
  onSelect: (nodeId: string | undefined) => void;
  onFocus: (nodeId: string) => void;
  onRemove: (nodeId: string) => void;
}

const ReferenceGroupSection = ({
  name,
  entries,
  nodeById,
  activeId,
  onSelect,
  onFocus,
  onRemove,
}: ReferenceGroupSectionProps) => {
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className={`reference-group${collapsed ? ' reference-group--collapsed' : ''}`}>
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
        <span className="reference-group-name">{name}</span>
        <span className="reference-group-count">{entries.length}</span>
      </button>
      {!collapsed && (
        <ul className="reference-group-items">
          {entries.map((entry) => {
            const node = nodeById.get(entry.nodeId);
            const label = node ? getNodeDisplayLabel(node) : entry.nodeId;
            const active = entry.nodeId === activeId;
            return (
              <li key={entry.nodeId}>
                <button
                  type="button"
                  className={`reference-group-item${active ? ' reference-group-item--active' : ''}`}
                  onClick={() => onSelect(entry.nodeId)}
                  onDoubleClick={() => onFocus(entry.nodeId)}
                >
                  <span className="reference-group-item-label" title={label}>
                    {label}
                  </span>
                  {node && (
                    <span className="reference-group-item-type">{node.type}</span>
                  )}
                  <span
                    className="reference-group-item-remove"
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemove(entry.nodeId);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        onRemove(entry.nodeId);
                      }
                    }}
                    aria-label="Remove from references"
                    title="Remove"
                  >
                    ×
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

const ReferenceEmptyState = ({ selectedNode }: { selectedNode?: CanvasNode }) => (
  <div className="reference-empty">
    <div className="reference-empty-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M5.2 2.8h7.6a1.4 1.4 0 011.4 1.4v10.6L9 11.8l-5.2 3V4.2a1.4 1.4 0 011.4-1.4z"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinejoin="round"
        />
        <path d="M6.6 6.2h4.8M6.6 8.7h3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    </div>
    <h3>No reference pinned</h3>
    <p>Pin canvas nodes to keep them at hand. Use "Pin selection" or "From canvas" above.</p>
    {selectedNode ? (
      <div className="reference-selected-hint">
        <span>Selected</span>
        <strong>{getNodeDisplayLabel(selectedNode)}</strong>
      </div>
    ) : (
      <div className="reference-selected-hint reference-selected-hint--muted">
        Select a single node to enable "Pin selection".
      </div>
    )}
  </div>
);
