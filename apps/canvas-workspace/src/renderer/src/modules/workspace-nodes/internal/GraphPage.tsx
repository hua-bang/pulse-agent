import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { WorkspaceEntry } from '../../../hooks/useWorkspaces';
import type { KnowledgeNodeSelection } from '../../../types';
import { useAllWorkspaceNodeList } from './useWorkspaceNodes';
import { getNodeTitle, getNodeWorkspaceId } from './utils';
import { useI18n } from '../../../i18n';
import { isImeComposing } from '../../../utils/ime';
import { DropdownShell } from '../../../components/ui';
import { useRightDock } from '../../../shared/dockPort';
import {
  buildWorkspaceGraph,
  getGraphId,
  getWorkspaceGraphHighlight,
  nodeGraphId,
  searchWorkspaceGraph,
  type WorkspaceGraphNode as GraphNode,
  type WorkspaceGraphSearchResult as GraphSearchResult,
} from '../model/graphModel';
import {
  ForceGraphCanvas,
  type ForceGraphCanvasHandle,
  type GraphLayoutPreset,
} from './ForceGraphCanvas';

interface GraphPageProps {
  workspaces: WorkspaceEntry[];
  selectedNode?: KnowledgeNodeSelection | null;
  onSelectNode?: (selection: KnowledgeNodeSelection | null) => void;
}

function selectedGraphId(selectedNode?: KnowledgeNodeSelection | null): string | null {
  if (!selectedNode) return null;
  return nodeGraphId(selectedNode.workspaceId, selectedNode.nodeId);
}

function isNodeGraphNode(node: GraphNode): node is GraphNode & {
  workspaceId: string;
  nodeId: string;
} {
  return node.kind === 'node' && Boolean(node.workspaceId && node.nodeId);
}


export const GraphPage = ({
  workspaces,
  selectedNode,
  onSelectNode,
}: GraphPageProps) => {
  const { t } = useI18n();
  const dock = useRightDock();
  const graphRef = useRef<ForceGraphCanvasHandle>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastClickRef = useRef<{ nodeId: string; ts: number } | null>(null);
  const { nodes, tags, loading, error, reload } = useAllWorkspaceNodeList(workspaces);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [showTags, setShowTags] = useState(true);
  const [showLinks, setShowLinks] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [layoutPreset, setLayoutPreset] = useState<GraphLayoutPreset>('normal');
  const [query, setQuery] = useState('');
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(selectedGraphId(selectedNode));
  const [searchOpen, setSearchOpen] = useState(false);
  const [showWorkspaceHubs, setShowWorkspaceHubs] = useState(true);
  // Off-canvas nodes (knowledge records with no matching canvas node — e.g.
  // stale/orphan records) are hidden by default; toggle to reveal them.
  const [showOffCanvas, setShowOffCanvas] = useState(false);
  const searchListboxId = useId();
  const overflowMenuId = useId();
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchListboxRef = useRef<HTMLDivElement>(null);
  // ui/DropdownShell owns the overflow menu's open state, click-outside,
  // and Escape/arrow-nav now — this ref is only for restoring focus on an
  // Escape-close (the shell's onOpenChange close-reason).
  const overflowButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        setSearchOpen(true);
        requestAnimationFrame(() => searchInputRef.current?.focus());
      } else if (event.key === 'Escape' && searchOpen) {
        setSearchOpen(false);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [searchOpen]);

  useEffect(() => {
    setActiveNodeId(selectedGraphId(selectedNode));
  }, [selectedNode]);

  const visibleNodes = useMemo(
    () => (showOffCanvas ? nodes : nodes.filter((node) => node.onCanvas !== false)),
    [nodes, showOffCanvas],
  );

  const searchSuggestions = useMemo<GraphSearchResult[]>(() => searchWorkspaceGraph({
    nodes: visibleNodes,
    tags,
    query,
    showTags,
  }), [query, showTags, tags, visibleNodes]);

  const [suggestionIndex, setSuggestionIndex] = useState(0);
  useEffect(() => { setSuggestionIndex(0); }, [query]);
  useEffect(() => {
    setSuggestionIndex((index) => Math.min(index, Math.max(0, searchSuggestions.length - 1)));
  }, [searchSuggestions.length]);
  useEffect(() => {
    if (!query.trim()) return;
    const item = searchListboxRef.current?.querySelector<HTMLElement>(
      `[data-search-index="${suggestionIndex}"]`,
    );
    item?.scrollIntoView({ block: 'nearest' });
  }, [query, suggestionIndex, searchSuggestions.length]);

  const activeSearchOptionId = query.trim() && searchSuggestions[suggestionIndex]
    ? `${searchListboxId}-option-${suggestionIndex}`
    : undefined;

  const graphData = useMemo(
    () => buildWorkspaceGraph({
      nodes: visibleNodes,
      tags,
      workspaces,
      options: { showTags, showLinks, showWorkspaceHubs },
      untitled: t('workspaceNodes.untitled'),
    }),
    [showLinks, showTags, showWorkspaceHubs, tags, t, visibleNodes, workspaces],
  );
  const highlighted = useMemo(
    () => getWorkspaceGraphHighlight(graphData, hoverNodeId || activeNodeId),
    [activeNodeId, graphData, hoverNodeId],
  );

  const focusNode = useCallback((nodeId: string, zoom = 2.8) => {
    const node = graphData.nodes.find((item) => getGraphId(item.id) === nodeId);
    if (node) graphRef.current?.focusNode(node, zoom);
  }, [graphData.nodes]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return undefined;

    const update = () => {
      const rect = el.getBoundingClientRect();
      setDimensions({
        width: Math.max(320, Math.floor(rect.width)),
        height: Math.max(240, Math.floor(rect.height)),
      });
    };

    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(el);
    window.addEventListener('resize', update);
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener('resize', update);
    };
  }, []);

  // Note: we deliberately do NOT auto-focus when `selectedNode` changes.
  // Single-click on a graph node opens its dock tab, and a focus effect
  // here would yank the viewport on every click. Double-click remains the
  // explicit zoom gesture.

  const pickSuggestion = useCallback((result: GraphSearchResult) => {
    setSearchOpen(false);
    setQuery('');
    // Defer focus so the node has positions computed after the search
    // overlay closes.
    if (result.kind === 'tag') {
      setActiveNodeId(result.graphId);
      onSelectNode?.(null); // a tag isn't a workspace node — clear node selection
      window.setTimeout(() => focusNode(result.graphId), 80);
      return;
    }
    const item = result.node;
    const workspaceId = getNodeWorkspaceId(item);
    const graphId = nodeGraphId(workspaceId, item.id);
    setActiveNodeId(graphId);
    onSelectNode?.({ workspaceId, nodeId: item.id });
    dock.openNodeDetail(workspaceId, item.id, getNodeTitle(item, t('workspaceNodes.untitled')));
    window.setTimeout(() => focusNode(graphId), 80);
  }, [dock, focusNode, onSelectNode, t]);

  const handleNodeClick = useCallback((node: GraphNode, _event: MouseEvent) => {
    const nodeId = getGraphId(node.id);
    if (!nodeId) return;

    const now = Date.now();
    const last = lastClickRef.current;
    const isDoubleClick = last !== null && last.nodeId === nodeId && now - last.ts < 280;
    lastClickRef.current = { nodeId, ts: now };

    setActiveNodeId(nodeId);

    if (isDoubleClick) {
      // Double click: zoom to the node. Its dock tab stays open while the
      // user explores the graph.
      focusNode(nodeId);
      return;
    }

    // Single click: open a detail tab for real nodes. Don't reframe
    // the viewport — the user may be deliberately panning around.
    if (isNodeGraphNode(node)) {
      onSelectNode?.({ workspaceId: node.workspaceId, nodeId: node.nodeId });
      dock.openNodeDetail(node.workspaceId, node.nodeId, node.label);
    }
  }, [dock, focusNode, onSelectNode]);

  return (
    <main className="workspace-graph-page" ref={containerRef}>
      <div className="workspace-graph-toolbar">
        <div className="workspace-graph-toolbar__group">
          <button className={`workspace-node-chip${showLabels ? ' is-active' : ''}`} onClick={() => setShowLabels((value) => !value)}>
            {showLabels ? t('workspaceGraph.hideLabels') : t('workspaceGraph.showLabels')}
          </button>
          {workspaces.length > 1 && (
            <button className={`workspace-node-chip${showWorkspaceHubs ? ' is-active' : ''}`} onClick={() => setShowWorkspaceHubs((value) => !value)}>
              {showWorkspaceHubs ? t('workspaceGraph.hideWorkspaces') : t('workspaceGraph.groupByWorkspace')}
            </button>
          )}
          <button className={`workspace-node-chip${showOffCanvas ? ' is-active' : ''}`} onClick={() => setShowOffCanvas((value) => !value)}>
            {showOffCanvas ? t('workspaceGraph.hideOffCanvas') : t('workspaceGraph.showOffCanvas')}
          </button>
          <button className="workspace-node-chip workspace-node-chip--toolbar-action" onClick={() => graphRef.current?.zoomToFit()}>{t('workspaceGraph.fit')}</button>
          <DropdownShell
            className="workspace-graph-toolbar__more"
            panelClassName="workspace-graph-toolbar__menu"
            align="end"
            role="menu"
            ariaLabel={t('workspaceGraph.moreMenuLabel')}
            panelId={overflowMenuId}
            onOpenChange={(open, reason) => {
              // Escape restores focus to the trigger; an outside-press does
              // not — same distinction ChatAnchors uses this shell for.
              if (!open && reason === 'escape') overflowButtonRef.current?.focus();
            }}
            trigger={({ open, toggle }) => (
              <button
                ref={overflowButtonRef}
                type="button"
                className="workspace-node-chip workspace-node-chip--toolbar-action"
                onClick={toggle}
                onKeyDown={(event) => {
                  if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
                  // Once open, the shell's own useMenuKeyboardNav (global
                  // scope) already owns ArrowDown/Up and stops propagation
                  // before this handler sees the event.
                  if (open) return;
                  event.preventDefault();
                  event.stopPropagation();
                  toggle();
                }}
                title={t('workspaceGraph.moreOptions')}
                aria-label={t('workspaceGraph.moreOptions')}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? overflowMenuId : undefined}
              >
                {t('workspaceGraph.more')}
              </button>
            )}
          >
            {({ close }) => (
              <>
                <button
                  type="button"
                  className="workspace-graph-toolbar__menu-item"
                  role="menuitem"
                  onClick={() => {
                    graphRef.current?.setPaused(!isPaused);
                    setIsPaused((value) => !value);
                  }}
                >
                  {isPaused ? t('workspaceGraph.resumeLayout') : t('workspaceGraph.pauseLayout')}
                </button>
                <button
                  type="button"
                  className="workspace-graph-toolbar__menu-item"
                  role="menuitem"
                  onClick={() => setLayoutPreset((value) => value === 'compact' ? 'normal' : value === 'normal' ? 'loose' : 'compact')}
                >
                  {t('workspaceGraph.density', {
                    value: layoutPreset === 'compact'
                      ? t('workspaceGraph.density.compact')
                      : layoutPreset === 'loose'
                        ? t('workspaceGraph.density.loose')
                        : t('workspaceGraph.density.standard'),
                  })}
                </button>
                <button
                  type="button"
                  className="workspace-graph-toolbar__menu-item"
                  role="menuitem"
                  onClick={() => { close(); void reload(); }}
                >
                  {t('workspaceNodes.refresh')}
                </button>
              </>
            )}
          </DropdownShell>
        </div>
      </div>

      {searchOpen && (
        <div className="workspace-graph-search">
          <div className="workspace-graph-search__row">
            <input
              ref={searchInputRef}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t('workspaceGraph.searchPlaceholder')}
              role="combobox"
              aria-label={t('workspaceGraph.searchLabel')}
              aria-autocomplete="list"
              aria-expanded={Boolean(query.trim())}
              aria-controls={query.trim() ? searchListboxId : undefined}
              aria-activedescendant={activeSearchOptionId}
              onKeyDown={(event) => {
                if (isImeComposing(event)) return;
                if (event.key === 'Escape') {
                  setSearchOpen(false);
                  return;
                }
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setSuggestionIndex((i) => Math.min(i + 1, Math.max(0, searchSuggestions.length - 1)));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setSuggestionIndex((i) => Math.max(0, i - 1));
                } else if (event.key === 'Enter') {
                  event.preventDefault();
                  const target = searchSuggestions[suggestionIndex];
                  if (target) pickSuggestion(target);
                }
              }}
            />
            <button
              type="button"
              className="workspace-node-chip"
              onClick={() => { setQuery(''); setSearchOpen(false); }}
              title={t('workspaceGraph.close')}
              aria-label={t('workspaceGraph.close')}
            >
              ✕
            </button>
          </div>
          {query.trim() && (
            <div
              ref={searchListboxRef}
              id={searchListboxId}
              className="workspace-graph-search__list"
              role="listbox"
              aria-label={t('workspaceGraph.searchResults')}
            >
              {searchSuggestions.length === 0 ? (
                <div className="workspace-graph-search__empty">{t('workspaceGraph.noMatches')}</div>
              ) : (
                searchSuggestions.map((result, index) => {
                  const isTag = result.kind === 'tag';
                  const key = result.kind === 'tag'
                    ? result.graphId
                    : `${getNodeWorkspaceId(result.node)}:${result.node.id}`;
                  const title = result.kind === 'tag'
                    ? result.label
                    : getNodeTitle(result.node, t('workspaceNodes.untitled'));
                  const meta = result.kind === 'tag'
                    ? t('workspaceGraph.tagResult')
                    : (result.node.workspaceName ?? '');
                  return (
                    <button
                      key={key}
                      id={`${searchListboxId}-option-${index}`}
                      type="button"
                      role="option"
                      aria-selected={index === suggestionIndex}
                      aria-label={t('workspaceGraph.searchOption', { type: meta, title: isTag ? `# ${title}` : title })}
                      data-search-index={index}
                      className={`workspace-graph-search__item${index === suggestionIndex ? ' is-active' : ''}${isTag ? ' workspace-graph-search__item--tag' : ''}`}
                      onMouseEnter={() => setSuggestionIndex(index)}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => pickSuggestion(result)}
                    >
                      <span className="workspace-graph-search__title">{isTag ? `# ${title}` : title}</span>
                      <span className="workspace-graph-search__meta">{meta}</span>
                    </button>
                  );
                })
              )}
            </div>
          )}
        </div>
      )}

      {error && <div className="workspace-graph-state workspace-graph-state--error">{error}</div>}
      {loading && <div className="workspace-graph-state">{t('workspaceGraph.loading')}</div>}
      {!loading && visibleNodes.length === 0 && (
        <div className="workspace-graph-empty">
          <h2>{t('workspaceGraph.emptyTitle')}</h2>
          <p>{t('workspaceGraph.emptyDescription')}</p>
        </div>
      )}

      <div className="workspace-graph-force-layer">
        <ForceGraphCanvas
          ref={graphRef}
          view={{
            graph: graphData,
            width: dimensions.width,
            height: dimensions.height,
            activeNodeId,
            hoverNodeId,
            highlightedNodeIds: highlighted.nodeIds,
            highlightedLinkIds: highlighted.linkIds,
            showLabels,
            layoutPreset,
          }}
          actions={{
            hoverNode: setHoverNodeId,
            clickNode: handleNodeClick,
            clearSelection: () => {
              setActiveNodeId(null);
              onSelectNode?.(null);
            },
          }}
        />
      </div>

    </main>
  );
};
