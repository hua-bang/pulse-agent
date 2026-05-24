import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './index.css';
import type { CanvasNode, ReferenceNodeData } from '../../types';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import { CanvasNodeView } from '../CanvasNodeView';
import { IframeNodeBody } from '../IframeNodeBody';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';
import { copyTextToClipboard } from '../../utils/clipboard';

const DEFAULT_REFERENCE_DRAWER_WIDTH = 420;
const MIN_REFERENCE_DRAWER_WIDTH = 260;
const MAX_REFERENCE_DRAWER_WIDTH = 1000;
const REFERENCE_SEARCH_DEBOUNCE_MS = 180;

const NODE_TYPE_LABELS: Record<CanvasNode['type'], string> = {
  agent: 'Agent',
  file: 'File',
  frame: 'Frame',
  group: 'Group',
  iframe: 'Web',
  image: 'Image',
  mindmap: 'Mindmap',
  reference: 'Reference',
  shape: 'Shape',
  terminal: 'Terminal',
  text: 'Text',
};

interface NodeReferenceEntry {
  kind: 'node';
  workspaceId: string;
  nodeId: string;
  titleSnapshot?: string;
  typeSnapshot?: CanvasNode['type'];
  workspaceNameSnapshot?: string;
}

interface UrlReferenceEntry {
  kind: 'url';
  id: string;
  url: string;
  title?: string;
  group?: string;
}

export type ReferenceEntry = NodeReferenceEntry | UrlReferenceEntry;

type ReferenceGroupKey = CanvasNode['type'] | 'url' | 'missing';
type ReferencePickerMode = 'current' | 'other';

const REFERENCE_GROUP_ORDER: ReferenceGroupKey[] = [
  'file',
  'text',
  'image',
  'iframe',
  'url',
  'agent',
  'terminal',
  'mindmap',
  'reference',
  'shape',
  'frame',
  'group',
  'missing',
];

const PICKER_NODE_TYPE_GROUP_ORDER: CanvasNode['type'][] = [
  'iframe',
  'file',
  'text',
  'image',
  'agent',
  'terminal',
  'mindmap',
  'reference',
  'shape',
  'frame',
  'group',
];

const isUrlReference = (entry: ReferenceEntry): entry is UrlReferenceEntry => entry.kind === 'url';
const getReferenceId = (entry: ReferenceEntry) => isUrlReference(entry)
  ? entry.id
  : `${entry.workspaceId}:${entry.nodeId}`;
const getNodeReferenceId = (workspaceId: string, nodeId: string) => `${workspaceId}:${nodeId}`;

const getReferenceGroupLabel = (type: ReferenceGroupKey) => {
  if (type === 'url') return 'URL';
  if (type === 'missing') return 'Missing nodes';
  return NODE_TYPE_LABELS[type];
};

const getReferenceGroupIcon = (type: ReferenceGroupKey) => {
  switch (type) {
    case 'file': return 'N';
    case 'text': return 'T';
    case 'image': return 'I';
    case 'iframe': return 'W';
    case 'url': return '@';
    case 'agent': return 'A';
    case 'terminal': return '$';
    case 'mindmap': return 'M';
    case 'reference': return 'R';
    case 'shape': return 'S';
    case 'frame': return 'F';
    case 'group': return 'G';
    case 'missing': return '?';
  }
};

const getUrlHostname = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
};

const getUrlReferenceLabel = (entry: UrlReferenceEntry) => entry.title?.trim() || getUrlHostname(entry.url) || entry.url;

const createUrlPreviewNode = (entry: UrlReferenceEntry, drawerWidth: number): CanvasNode => ({
  id: entry.id,
  type: 'iframe',
  title: getUrlReferenceLabel(entry),
  x: 0,
  y: 0,
  width: Math.max(MIN_REFERENCE_DRAWER_WIDTH - 32, drawerWidth - 32),
  height: 420,
  data: {
    mode: 'url',
    url: entry.url,
    pageTitle: entry.title,
  },
});

const normalizeReferenceUrl = (value: string) => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const withProtocol = /^[a-z][a-z\d+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(withProtocol);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined;
    return url.href;
  } catch {
    return undefined;
  }
};

interface ReferenceDrawerProps {
  open: boolean;
  activeWorkspaceId: string;
  workspaces: WorkspaceEntry[];
  references: ReferenceEntry[];
  activeReference?: ReferenceEntry;
  activeReferenceNode?: CanvasNode;
  nodes: CanvasNode[];
  allNodes: Record<string, CanvasNode[]>;
  selectedNode?: CanvasNode;
  onOpenChange: (open: boolean) => void;
  onSelectReference: (referenceId: string | undefined) => void;
  onRemoveReference: (referenceId: string) => void;
  onClearAll: () => void;
  onAddReference: (workspaceId: string, nodeId: string) => void;
  onAddUrlReference: (url: string, title?: string) => void;
  onFocusNode: (workspaceId: string, nodeId: string) => void;
  onAddReferenceToCanvas: (entry: NodeReferenceEntry) => void;
  onWorkspaceNodesRequest: (workspaceId: string) => void;
}

export const ReferenceDrawer = ({
  open,
  activeWorkspaceId,
  workspaces,
  references,
  activeReference,
  activeReferenceNode,
  nodes,
  allNodes,
  selectedNode,
  onOpenChange,
  onSelectReference,
  onRemoveReference,
  onClearAll,
  onAddReference,
  onAddUrlReference,
  onFocusNode,
  onAddReferenceToCanvas,
  onWorkspaceNodesRequest,
}: ReferenceDrawerProps) => {
  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_REFERENCE_DRAWER_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [isActive, setIsActive] = useState(open);
  const [pickerOpen, setPickerOpen] = useState<ReferencePickerMode | null>(null);
  const [externalWorkspaceId, setExternalWorkspaceId] = useState<string | undefined>();
  const [urlEditorOpen, setUrlEditorOpen] = useState(false);
  const [urlDraft, setUrlDraft] = useState('');
  const [urlError, setUrlError] = useState<string | undefined>();
  const [searchDraft, setSearchDraft] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const pickerRef = useRef<HTMLDivElement>(null);
  const urlEditorRef = useRef<HTMLDivElement>(null);

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
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchDraft.trim().toLowerCase());
    }, REFERENCE_SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [searchDraft]);

  useEffect(() => {
    if (!pickerOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!pickerRef.current?.contains(event.target as Node)) {
        setPickerOpen(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [pickerOpen]);

  useEffect(() => {
    if (!urlEditorOpen) return;
    const handleClickOutside = (event: MouseEvent) => {
      if (!urlEditorRef.current?.contains(event.target as Node)) {
        setUrlEditorOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [urlEditorOpen]);

  useEffect(() => {
    if (!externalWorkspaceId || externalWorkspaceId === activeWorkspaceId) return;
    onWorkspaceNodesRequest(externalWorkspaceId);
  }, [activeWorkspaceId, externalWorkspaceId, onWorkspaceNodesRequest]);

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

  const workspaceNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const workspace of workspaces) map.set(workspace.id, workspace.name);
    return map;
  }, [workspaces]);

  const externalWorkspaces = useMemo(
    () => workspaces.filter((workspace) => workspace.id !== activeWorkspaceId),
    [activeWorkspaceId, workspaces],
  );

  useEffect(() => {
    if (externalWorkspaceId && externalWorkspaces.some((workspace) => workspace.id === externalWorkspaceId)) return;
    setExternalWorkspaceId(externalWorkspaces[0]?.id);
  }, [externalWorkspaceId, externalWorkspaces]);

  const currentNodeById = useMemo(() => {
    const map = new Map<string, CanvasNode>();
    for (const node of nodes) map.set(node.id, node);
    return map;
  }, [nodes]);

  const getNodeByEntry = useCallback(
    (entry: NodeReferenceEntry) => {
      if (entry.workspaceId === activeWorkspaceId) return currentNodeById.get(entry.nodeId);
      return (allNodes[entry.workspaceId] ?? []).find((node) => node.id === entry.nodeId);
    },
    [activeWorkspaceId, allNodes, currentNodeById],
  );

  const referenced = useMemo(() => {
    const set = new Set<string>();
    for (const entry of references) {
      if (!isUrlReference(entry)) set.add(getReferenceId(entry));
    }
    return set;
  }, [references]);

  const eligibleCurrentNodes = useMemo(() => (
    nodes
      .filter((node) => !referenced.has(getNodeReferenceId(activeWorkspaceId, node.id)))
      .filter((node) => node.type !== 'frame' && node.type !== 'group')
  ), [activeWorkspaceId, nodes, referenced]);

  const selectedExternalWorkspaceNodes = externalWorkspaceId
    ? allNodes[externalWorkspaceId] ?? []
    : [];

  const eligibleExternalNodes = useMemo(() => {
    if (!externalWorkspaceId) return [];
    return selectedExternalWorkspaceNodes
      .filter((node) => !referenced.has(getNodeReferenceId(externalWorkspaceId, node.id)))
      .filter((node) => node.type !== 'frame' && node.type !== 'group');
  }, [externalWorkspaceId, referenced, selectedExternalWorkspaceNodes]);

  const filterNodes = useCallback((items: CanvasNode[]) => {
    if (!debouncedSearch) return items;
    return items.filter((node) => {
      const label = getNodeDisplayLabel(node);
      const typeLabel = NODE_TYPE_LABELS[node.type] ?? node.type;
      return [label, node.type, typeLabel, node.id]
        .some((value) => value.toLowerCase().includes(debouncedSearch));
    });
  }, [debouncedSearch]);

  const pickableNodes = useMemo(
    () => filterNodes(pickerOpen === 'other' ? eligibleExternalNodes : eligibleCurrentNodes),
    [eligibleCurrentNodes, eligibleExternalNodes, filterNodes, pickerOpen],
  );

  const pickableNodeGroups = useMemo(() => {
    const map = new Map<CanvasNode['type'], CanvasNode[]>();
    for (const node of pickableNodes) {
      const list = map.get(node.type);
      if (list) list.push(node);
      else map.set(node.type, [node]);
    }

    return PICKER_NODE_TYPE_GROUP_ORDER
      .filter((type) => map.has(type))
      .map((type) => ({
        type,
        name: getReferenceGroupLabel(type),
        nodes: map.get(type) ?? [],
      }));
  }, [pickableNodes]);

  const handleAddFromPicker = useCallback((nodeId: string) => {
    const workspaceId = pickerOpen === 'other' ? externalWorkspaceId : activeWorkspaceId;
    if (!workspaceId) return;
    onAddReference(workspaceId, nodeId);
    setPickerOpen(null);
  }, [activeWorkspaceId, externalWorkspaceId, onAddReference, pickerOpen]);

  const handleAddUrl = useCallback(() => {
    const normalized = normalizeReferenceUrl(urlDraft);
    if (!normalized) {
      setUrlError('Enter a valid http(s) URL.');
      return;
    }
    onAddUrlReference(normalized, getUrlHostname(normalized) || normalized);
    setUrlDraft('');
    setUrlError(undefined);
    setUrlEditorOpen(false);
  }, [onAddUrlReference, urlDraft]);

  const activeReferenceId = activeReference ? getReferenceId(activeReference) : undefined;

  const openUrl = useCallback((url: string) => {
    void window.canvasWorkspace?.shell.openExternal(url);
  }, []);

  const copyUrl = useCallback((url: string) => {
    void copyTextToClipboard(url).catch(() => undefined);
  }, []);

  if (!shouldRender) return null;

  const hasReferences = references.length > 0;
  const searchActive = debouncedSearch.length > 0;

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
          x
        </button>
      </header>

      <div className="reference-drawer-toolbar">
        <div className="reference-picker-anchor" ref={pickerRef}>
          <button
            className={`reference-drawer-action reference-drawer-action--ghost${pickerOpen === 'current' ? ' reference-drawer-action--open' : ''}`}
            type="button"
            onClick={() => {
              setSearchDraft('');
              setPickerOpen((prev) => prev === 'current' ? null : 'current');
            }}
            disabled={eligibleCurrentNodes.length === 0}
            title={eligibleCurrentNodes.length === 0 ? 'No more current workspace nodes to pin' : 'Pick a current workspace node'}
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
                  <label htmlFor="reference-workspace-select">Workspace</label>
                  <select
                    id="reference-workspace-select"
                    value={externalWorkspaceId ?? ''}
                    onChange={(event) => {
                      setExternalWorkspaceId(event.target.value || undefined);
                      setSearchDraft('');
                    }}
                  >
                    {externalWorkspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
                    ))}
                  </select>
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
                      onPick={handleAddFromPicker}
                    />
                  ))
                )}
              </div>
            </div>
          )}
        </div>

        <div className="reference-url-anchor" ref={urlEditorRef}>
          <button
            className={`reference-drawer-action reference-drawer-action--ghost${urlEditorOpen ? ' reference-drawer-action--open' : ''}`}
            type="button"
            onClick={() => {
              setUrlEditorOpen((prev) => !prev);
              setUrlError(undefined);
            }}
            aria-haspopup="dialog"
            aria-expanded={urlEditorOpen}
            title="Add URL reference"
          >
            <LinkIcon />
            URL
          </button>
          {urlEditorOpen && (
            <div className="reference-url-popover" role="dialog" aria-label="Add URL reference">
              <label className="reference-url-label" htmlFor="reference-url-input">Reference URL</label>
              <input
                id="reference-url-input"
                autoFocus
                className="reference-url-input"
                value={urlDraft}
                placeholder="https://example.com/article"
                onChange={(e) => {
                  setUrlDraft(e.target.value);
                  setUrlError(undefined);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    handleAddUrl();
                  } else if (e.key === 'Escape') {
                    setUrlEditorOpen(false);
                  }
                }}
              />
              {urlError && <div className="reference-url-error">{urlError}</div>}
              <div className="reference-url-actions">
                <button
                  type="button"
                  className="reference-drawer-secondary"
                  onClick={() => setUrlEditorOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="reference-drawer-primary"
                  onClick={handleAddUrl}
                  disabled={!urlDraft.trim()}
                >
                  Add URL
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="reference-drawer-content">
        {!hasReferences ? (
          <ReferenceEmptyState selectedNode={selectedNode} />
        ) : (
          <>
            <div className="reference-entry-list">
              <ReferenceEntryList
                entries={references}
                activeWorkspaceId={activeWorkspaceId}
                workspaceNameById={workspaceNameById}
                getNodeByEntry={getNodeByEntry}
                activeId={activeReferenceId}
                onSelect={onSelectReference}
                onFocus={onFocusNode}
                onOpenUrl={openUrl}
                onRemove={onRemoveReference}
              />
            </div>

            {activeReference && isUrlReference(activeReference) ? (
              <div className="reference-url-card reference-url-card--preview">
                <ReferenceUrlWebPreview reference={activeReference} drawerWidth={drawerWidth} />
                <div className="reference-card-footer">
                  <button
                    className="reference-drawer-secondary"
                    type="button"
                    onClick={() => openUrl(activeReference.url)}
                  >
                    Open
                  </button>
                  <button
                    className="reference-drawer-secondary"
                    type="button"
                    onClick={() => copyUrl(activeReference.url)}
                  >
                    Copy URL
                  </button>
                  <button
                    className="reference-drawer-secondary"
                    type="button"
                    onClick={() => onRemoveReference(activeReference.id)}
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
            ) : activeReference && !isUrlReference(activeReference) && activeReferenceNode ? (
              <div className="reference-native-card">
                <ReferenceNativeNodePreview
                  node={activeReferenceNode}
                  drawerWidth={drawerWidth}
                  workspaceName={workspaceNameById.get(activeReference.workspaceId) ?? activeReference.workspaceNameSnapshot}
                  onFocusNode={() => onFocusNode(activeReference.workspaceId, activeReference.nodeId)}
                />
                <div className="reference-card-footer">
                  <button
                    className="reference-drawer-secondary"
                    type="button"
                    onClick={() => onFocusNode(activeReference.workspaceId, activeReference.nodeId)}
                    title="Open source"
                  >
                    Open source
                  </button>
                  <button
                    className="reference-drawer-secondary"
                    type="button"
                    onClick={() => onAddReferenceToCanvas(activeReference)}
                  >
                    Add to canvas
                  </button>
                  <button
                    className="reference-drawer-secondary"
                    type="button"
                    onClick={() => onRemoveReference(getReferenceId(activeReference))}
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
            ) : activeReference && !isUrlReference(activeReference) ? (
              <div className="reference-pick-hint">Source node is not loaded or no longer exists.</div>
            ) : (
              <div className="reference-pick-hint">Pick a reference above to preview it here.</div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};

interface ReferenceUrlWebPreviewProps {
  reference: UrlReferenceEntry;
  drawerWidth: number;
}

const ReferenceUrlWebPreview = memo(({ reference, drawerWidth }: ReferenceUrlWebPreviewProps) => {
  const previewNode = useMemo(
    () => createUrlPreviewNode(reference, drawerWidth),
    [reference, drawerWidth],
  );

  return (
    <div className="reference-url-preview">
      <IframeNodeBody
        node={previewNode}
        onUpdate={() => undefined}
        isResizing={false}
        readOnly
      />
    </div>
  );
});

ReferenceUrlWebPreview.displayName = 'ReferenceUrlWebPreview';

interface ReferenceNativeNodePreviewProps {
  node: CanvasNode;
  drawerWidth: number;
  workspaceName?: string;
  onFocusNode: () => void;
}

const ReferenceNativeNodePreview = memo(({ node, drawerWidth, workspaceName, onFocusNode }: ReferenceNativeNodePreviewProps) => {
  const previewNode = useMemo(
    () => ({
      ...node,
      x: 0,
      y: 0,
      width: Math.max(MIN_REFERENCE_DRAWER_WIDTH - 32, drawerWidth - 32),
      height: 420,
    }),
    [drawerWidth, node],
  );

  const getPreviewNodes = useCallback(() => [node], [node]);
  const handleFocus = useCallback(() => onFocusNode(), [onFocusNode]);

  return (
    <CanvasNodeView
      node={previewNode}
      getAllNodes={getPreviewNodes}
      workspaceName={workspaceName}
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
      onFocus={handleFocus}
      readOnly
    />
  );
});

ReferenceNativeNodePreview.displayName = 'ReferenceNativeNodePreview';

interface ReferenceEntryListProps {
  entries: ReferenceEntry[];
  activeWorkspaceId: string;
  workspaceNameById: Map<string, string>;
  getNodeByEntry: (entry: NodeReferenceEntry) => CanvasNode | undefined;
  activeId?: string;
  onSelect: (referenceId: string | undefined) => void;
  onFocus: (workspaceId: string, nodeId: string) => void;
  onOpenUrl: (url: string) => void;
  onRemove: (referenceId: string) => void;
}

const ReferenceEntryList = ({
  entries,
  activeWorkspaceId,
  workspaceNameById,
  getNodeByEntry,
  activeId,
  onSelect,
  onFocus,
  onOpenUrl,
  onRemove,
}: ReferenceEntryListProps) => (
  <ul className="reference-group-items">
    {entries.map((entry) => {
      const id = getReferenceId(entry);
      const node = isUrlReference(entry) ? undefined : getNodeByEntry(entry);
      const label = isUrlReference(entry)
        ? getUrlReferenceLabel(entry)
        : node
          ? getNodeDisplayLabel(node)
          : entry.titleSnapshot ?? entry.nodeId;
      const type = isUrlReference(entry) ? 'url' : node?.type ?? entry.typeSnapshot ?? 'missing';
      const active = id === activeId;
      const workspaceLabel = isUrlReference(entry)
        ? getUrlHostname(entry.url)
        : entry.workspaceId === activeWorkspaceId
          ? 'Current'
          : workspaceNameById.get(entry.workspaceId) ?? entry.workspaceNameSnapshot ?? 'Workspace';
      return (
        <li key={id}>
          <button
            type="button"
            className={`reference-group-item${active ? ' reference-group-item--active' : ''}`}
            onClick={() => onSelect(id)}
            onDoubleClick={() => isUrlReference(entry) ? onOpenUrl(entry.url) : onFocus(entry.workspaceId, entry.nodeId)}
          >
            <span className="reference-group-item-label" title={label}>
              {label}
            </span>
            <span className="reference-group-item-meta" title={workspaceLabel}>{workspaceLabel}</span>
            <span className="reference-group-item-type">{type}</span>
            <span
              className="reference-group-item-remove"
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(id);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  e.stopPropagation();
                  onRemove(id);
                }
              }}
              aria-label="Remove from references"
              title="Remove"
            >
              x
            </span>
          </button>
        </li>
      );
    })}
  </ul>
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
    <p>Pin nodes from the current workspace, another workspace, or a URL.</p>
    {selectedNode ? (
      <div className="reference-selected-hint">
        <span>Selected</span>
        <strong>{getNodeDisplayLabel(selectedNode)}</strong>
      </div>
    ) : (
      <div className="reference-selected-hint reference-selected-hint--muted">
        Use the current workspace picker for nearby nodes, or the other workspace picker for cross-canvas reuse.
      </div>
    )}
  </div>
);

const ListIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M3 6h10M3 10h7" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
  </svg>
);

const BranchIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M4 3v9M4 6h5a3 3 0 003-3M4 10h5a3 3 0 013 3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const SearchIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path
      d="M7.1 12.2a5.1 5.1 0 100-10.2 5.1 5.1 0 000 10.2zM11 11l3 3"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
    />
  </svg>
);

const LinkIcon = () => (
  <svg width="13" height="13" viewBox="0 0 16 16" fill="none" aria-hidden="true">
    <path d="M6.4 5.2l1.1-1.1a3 3 0 014.2 4.2l-1.2 1.2M9.6 10.8l-1.1 1.1a3 3 0 01-4.2-4.2l1.2-1.2M6.4 9.6l3.2-3.2" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
  </svg>
);

export type NodeReferenceEntryForCanvas = NodeReferenceEntry;
export const createReferenceNodeDataSnapshot = (
  node: CanvasNode,
  workspaceName?: string,
): ReferenceNodeData => ({
  titleSnapshot: getNodeDisplayLabel(node),
  typeSnapshot: node.type === 'reference' ? undefined : node.type,
  workspaceNameSnapshot: workspaceName,
});
