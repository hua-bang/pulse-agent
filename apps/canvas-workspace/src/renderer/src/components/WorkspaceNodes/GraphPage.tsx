import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from 'react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type GraphData as ForceGraphData,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import type { WorkspaceEntry } from '../../hooks/useWorkspaces';
import type { AgentContextNodeRef, CanvasNode, WorkspaceNodeListItem } from '../../types';
import { useChatDock, useRegisterChatContext, type ChatActiveContext } from '../chat';
import { NodeDetailDrawer } from './NodeDetailDrawer';
import { useAllWorkspaceNodeList } from './useWorkspaceNodes';
import { getNodeTags, getNodeTitle, getNodeWorkspaceId, tagName } from './utils';
import { useI18n } from '../../i18n';

interface GraphPageProps {
  workspaces: WorkspaceEntry[];
  selectedNode?: { workspaceId: string; nodeId: string } | null;
  onSelectNode?: (selection: { workspaceId: string; nodeId: string } | null) => void;
  onOpenNode: (workspaceId: string, nodeId: string) => void;
}

type GraphNodeKind = 'node' | 'tag' | 'missing' | 'workspace';
type GraphLinkKind = 'tag' | 'link' | 'workspace';
type LayoutPreset = 'compact' | 'normal' | 'loose';

interface GraphNode {
  id: string;
  kind: GraphNodeKind;
  label: string;
  workspaceId?: string;
  nodeId?: string;
  source?: WorkspaceNodeListItem;
}

interface GraphLink {
  source: string;
  target: string;
  kind: GraphLinkKind;
  relation?: string;
}

const GRAPH_COLORS = {
  node: '#2383e2',
  nodeText: '#1d4f87',
  tag: '#d9730d',
  tagText: '#8a4b0d',
  missing: '#9b9a97',
  missingText: 'rgba(55, 53, 47, 0.58)',
  workspace: '#8b5cf6',
  workspaceText: '#5b21b6',
  link: 'rgba(55, 53, 47, 0.22)',
  linkHighlight: 'rgba(55, 53, 47, 0.72)',
  workspaceLink: 'rgba(139, 92, 246, 0.32)',
  labelBg: 'rgba(255, 255, 255, 0.92)',
};

function workspaceGraphId(workspaceId: string): string {
  return `ws:${workspaceId}`;
}

function getGraphId(value: string | number | NodeObject<GraphNode> | null | undefined): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return String(value.id ?? '');
  return String(value);
}

function linkKey(link: LinkObject<GraphNode, GraphLink>): string {
  return `${getGraphId(link.source)}->${getGraphId(link.target)}`;
}

function nodeGraphId(workspaceId: string, nodeId: string): string {
  return `${workspaceId}:${nodeId}`;
}

function selectedGraphId(selectedNode?: { workspaceId: string; nodeId: string } | null): string | null {
  if (!selectedNode) return null;
  return nodeGraphId(selectedNode.workspaceId, selectedNode.nodeId);
}

function isNodeGraphNode(node: NodeObject<GraphNode>): node is NodeObject<GraphNode> & {
  workspaceId: string;
  nodeId: string;
} {
  return node.kind === 'node' && Boolean(node.workspaceId && node.nodeId);
}

function buildGraphData(
  nodes: WorkspaceNodeListItem[],
  tagDefinitions: ReturnType<typeof useAllWorkspaceNodeList>['tags'],
  workspaces: WorkspaceEntry[],
  options: { showTags: boolean; showLinks: boolean; showWorkspaceHubs: boolean },
  labels: { untitled: string },
): ForceGraphData<GraphNode, GraphLink> {
  const graphNodes = new Map<string, NodeObject<GraphNode>>();
  const graphLinks: LinkObject<GraphNode, GraphLink>[] = [];
  const visibleNodeIds = new Set(nodes.map((node) => nodeGraphId(getNodeWorkspaceId(node), node.id)));
  const workspaceById = new Map(workspaces.map((ws) => [ws.id, ws] as const));
  const workspaceUsage = new Map<string, number>();

  for (const node of nodes) {
    const workspaceId = getNodeWorkspaceId(node);
    const id = nodeGraphId(workspaceId, node.id);
    graphNodes.set(id, {
      id,
      kind: 'node',
      label: getNodeTitle(node, labels.untitled),
      workspaceId,
      nodeId: node.id,
      source: node,
    });
    workspaceUsage.set(workspaceId, (workspaceUsage.get(workspaceId) ?? 0) + 1);
  }

  if (options.showWorkspaceHubs) {
    for (const [workspaceId, count] of workspaceUsage) {
      if (count === 0) continue;
      const hubId = workspaceGraphId(workspaceId);
      const ws = workspaceById.get(workspaceId);
      graphNodes.set(hubId, {
        id: hubId,
        kind: 'workspace',
        label: ws?.name ?? workspaceId,
        workspaceId,
      });
    }
    for (const node of nodes) {
      const workspaceId = getNodeWorkspaceId(node);
      const hubId = workspaceGraphId(workspaceId);
      if (!graphNodes.has(hubId)) continue;
      graphLinks.push({
        source: hubId,
        target: nodeGraphId(workspaceId, node.id),
        kind: 'workspace',
      });
    }
  }

  if (options.showTags) {
    for (const node of nodes) {
      const source = nodeGraphId(getNodeWorkspaceId(node), node.id);
      for (const tag of getNodeTags(node)) {
        const tagId = `tag:${tag}`;
        if (!graphNodes.has(tagId)) {
          graphNodes.set(tagId, {
            id: tagId,
            kind: 'tag',
            label: tagName(tag, tagDefinitions),
          });
        }
        graphLinks.push({ source, target: tagId, kind: 'tag' });
      }
    }
  }

  if (options.showLinks) {
    for (const node of nodes) {
      const workspaceId = getNodeWorkspaceId(node);
      const source = nodeGraphId(workspaceId, node.id);
      for (const link of node.links ?? []) {
        const targetWorkspaceId = link.target.workspaceId ?? workspaceId;
        const target = nodeGraphId(targetWorkspaceId, link.target.nodeId);
        if (!visibleNodeIds.has(target) && !graphNodes.has(target)) {
          graphNodes.set(target, {
            id: target,
            kind: 'missing',
            label: link.target.nodeId,
          });
        }
        graphLinks.push({ source, target, kind: 'link', relation: link.relation });
      }
    }
  }

  return {
    nodes: Array.from(graphNodes.values()),
    links: graphLinks,
  };
}

export const GraphPage = ({
  workspaces,
  selectedNode,
  onSelectNode,
  onOpenNode,
}: GraphPageProps) => {
  const { t } = useI18n();
  const graphRef = useRef<ForceGraphMethods<GraphNode, GraphLink> | undefined>(undefined);
  const containerRef = useRef<HTMLDivElement>(null);
  const lastClickRef = useRef<{ nodeId: string; ts: number } | null>(null);
  const { nodes, tags, loading, error, reload } = useAllWorkspaceNodeList(workspaces);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });
  const [showTags, setShowTags] = useState(true);
  const [showLinks, setShowLinks] = useState(true);
  const [showLabels, setShowLabels] = useState(true);
  const [isPaused, setIsPaused] = useState(false);
  const [layoutPreset, setLayoutPreset] = useState<LayoutPreset>('normal');
  const [query, setQuery] = useState('');
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(selectedGraphId(selectedNode));
  const [searchOpen, setSearchOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [showWorkspaceHubs, setShowWorkspaceHubs] = useState(true);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);

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
    if (!overflowOpen) return;
    const handler = (event: MouseEvent) => {
      if (!overflowRef.current?.contains(event.target as Node)) setOverflowOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [overflowOpen]);

  useEffect(() => {
    setActiveNodeId(selectedGraphId(selectedNode));
  }, [selectedNode]);

  const visibleNodes = nodes;

  const searchSuggestions = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [] as WorkspaceNodeListItem[];
    return nodes.filter((node) => [
      node.id,
      node.workspaceName ?? '',
      node.title ?? '',
      node.summary ?? '',
      ...node.tags.map((tagId) => tagName(tagId, tags)),
    ].some((value) => value.toLowerCase().includes(q))).slice(0, 12);
  }, [nodes, query, tags]);

  const [suggestionIndex, setSuggestionIndex] = useState(0);
  useEffect(() => { setSuggestionIndex(0); }, [query]);

  const graphData = useMemo(
    () => buildGraphData(
      visibleNodes,
      tags,
      workspaces,
      { showTags, showLinks, showWorkspaceHubs },
      { untitled: t('workspaceNodes.untitled') },
    ),
    [showLinks, showTags, showWorkspaceHubs, tags, t, visibleNodes, workspaces],
  );

  const neighbors = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const node of graphData.nodes) {
      map.set(getGraphId(node.id), new Set());
    }
    for (const link of graphData.links) {
      const source = getGraphId(link.source);
      const target = getGraphId(link.target);
      if (!map.has(source)) map.set(source, new Set());
      if (!map.has(target)) map.set(target, new Set());
      map.get(source)?.add(target);
      map.get(target)?.add(source);
    }
    return map;
  }, [graphData.links, graphData.nodes]);

  // ── Chat context: the selected node plus its same-workspace neighbours ──
  const { openDock } = useChatDock();
  const nodeByGraphId = useMemo(() => {
    const map = new Map<string, WorkspaceNodeListItem>();
    for (const node of nodes) map.set(nodeGraphId(getNodeWorkspaceId(node), node.id), node);
    return map;
  }, [nodes]);

  const chatContext = useMemo<ChatActiveContext | null>(() => {
    if (!selectedNode) return { source: 'graph' };
    const wsId = selectedNode.workspaceId;
    const selId = nodeGraphId(wsId, selectedNode.nodeId);
    const toRef = (n: WorkspaceNodeListItem): AgentContextNodeRef => ({
      id: n.id,
      title: getNodeTitle(n, t('workspaceNodes.untitled')),
      type: n.type as CanvasNode['type'],
    });
    const refs: AgentContextNodeRef[] = [];
    const selItem = nodeByGraphId.get(selId);
    if (selItem) refs.push(toRef(selItem));
    for (const neighbourId of neighbors.get(selId) ?? []) {
      const item = nodeByGraphId.get(neighbourId);
      // Skip tag/workspace/missing pseudo-nodes and cross-workspace neighbours
      // (the agent can only read content within the bound workspace scope).
      if (!item || getNodeWorkspaceId(item) !== wsId) continue;
      refs.push(toRef(item));
      if (refs.length >= 40) break;
    }
    return {
      source: 'graph',
      workspaceId: wsId,
      selectedNodeRefs: refs,
      onNodeFocus: (id) => onSelectNode?.({ workspaceId: wsId, nodeId: id }),
    };
  }, [selectedNode, neighbors, nodeByGraphId, onSelectNode, t]);
  useRegisterChatContext(chatContext);

  const handleDiscuss = useCallback(() => {
    openDock({
      scope: selectedNode ? { kind: 'workspace', workspaceId: selectedNode.workspaceId } : undefined,
      focusInput: true,
    });
  }, [openDock, selectedNode]);

  const highlighted = useMemo(() => {
    const anchorId = hoverNodeId || activeNodeId;
    const nodeIds = new Set<string>();
    const linkIds = new Set<string>();
    if (!anchorId) return { nodeIds, linkIds };

    nodeIds.add(anchorId);
    neighbors.get(anchorId)?.forEach((neighborId) => {
      nodeIds.add(neighborId);
      linkIds.add(`${anchorId}->${neighborId}`);
      linkIds.add(`${neighborId}->${anchorId}`);
    });
    return { nodeIds, linkIds };
  }, [activeNodeId, hoverNodeId, neighbors]);

  const focusNode = useCallback((nodeId: string, zoom = 2.8) => {
    const graph = graphRef.current;
    const node = graphData.nodes.find((item) => getGraphId(item.id) === nodeId);
    if (!graph || !node || node.x === undefined || node.y === undefined) return;
    graph.centerAt(node.x, node.y, 520);
    graph.zoom(zoom, 520);
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

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return undefined;

    const preset =
      layoutPreset === 'compact'
        ? { linkDistance: 58, charge: -110 }
        : layoutPreset === 'loose'
          ? { linkDistance: 120, charge: -280 }
          : { linkDistance: 82, charge: -165 };

    const charge = graph.d3Force('charge');
    charge?.strength?.(preset.charge);
    charge?.distanceMax?.(layoutPreset === 'loose' ? 1200 : 900);
    graph.d3Force('link')?.distance?.(preset.linkDistance);
    graph.d3ReheatSimulation();

    const timeout = window.setTimeout(() => {
      graph.zoomToFit(450, 140);
    }, 60);
    return () => window.clearTimeout(timeout);
  }, [graphData.links.length, graphData.nodes.length, layoutPreset]);

  // Note: we deliberately do NOT auto-focus when `selectedNode` changes.
  // Single-click on a graph node calls onSelectNode, and a focus effect
  // here would yank the viewport on every click — the opposite of the
  // "click = open drawer, double-click = zoom" interaction.

  const pickSuggestion = useCallback((item: WorkspaceNodeListItem) => {
    const workspaceId = getNodeWorkspaceId(item);
    const graphId = nodeGraphId(workspaceId, item.id);
    setActiveNodeId(graphId);
    setSearchOpen(false);
    setQuery('');
    onSelectNode?.({ workspaceId, nodeId: item.id });
    // Defer focus so the node has positions computed after the search
    // overlay closes.
    window.setTimeout(() => focusNode(graphId), 80);
  }, [focusNode, onSelectNode]);

  const handleNodeClick = useCallback((node: NodeObject<GraphNode>, _event: MouseEvent) => {
    const nodeId = getGraphId(node.id);
    if (!nodeId) return;

    const now = Date.now();
    const last = lastClickRef.current;
    const isDoubleClick = last !== null && last.nodeId === nodeId && now - last.ts < 280;
    lastClickRef.current = { nodeId, ts: now };

    setActiveNodeId(nodeId);

    if (isDoubleClick) {
      // Double click: zoom to the node. Drawer state is left alone so it
      // stays open if the user is exploring.
      focusNode(nodeId);
      return;
    }

    // Single click: open the detail drawer for real nodes. Don't reframe
    // the viewport — the user may be deliberately panning around.
    if (isNodeGraphNode(node)) {
      onSelectNode?.({ workspaceId: node.workspaceId, nodeId: node.nodeId });
    }
  }, [focusNode, onSelectNode]);

  const renderNode = useCallback((
    node: NodeObject<GraphNode>,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    const nodeId = getGraphId(node.id);
    const isTag = node.kind === 'tag';
    const isMissing = node.kind === 'missing';
    const isWorkspace = node.kind === 'workspace';
    const radius = isWorkspace ? 12 : isTag ? 8 : isMissing ? 5 : 6.5;
    const isHighlighted = highlighted.nodeIds.size === 0 || highlighted.nodeIds.has(nodeId);
    const isSelected = activeNodeId === nodeId;
    const isHovered = hoverNodeId === nodeId;
    const fill = isWorkspace
      ? GRAPH_COLORS.workspace
      : isTag
        ? GRAPH_COLORS.tag
        : isMissing
          ? GRAPH_COLORS.missing
          : GRAPH_COLORS.node;
    const alpha = isHighlighted ? 1 : 0.18;

    ctx.save();
    ctx.globalAlpha = alpha;

    if (isSelected || isHovered) {
      ctx.shadowColor = fill;
      ctx.shadowBlur = 14;
    }

    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, isSelected ? radius + 2.5 : radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();

    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    const shouldShowLabel = showLabels || isSelected || isHovered || isWorkspace || globalScale > 2.3;
    if (shouldShowLabel && isHighlighted) {
      const label = node.label || nodeId;
      const fontSize = Math.max(8, 11 / globalScale);
      ctx.font = `${fontSize}px "SF Mono", "Fira Code", Menlo, monospace`;
      const textWidth = ctx.measureText(label).width;
      const paddingX = 4;
      const paddingY = 2.5;
      const textX = (node.x ?? 0) + radius + 6;
      const textY = (node.y ?? 0) + 1;

      ctx.fillStyle = GRAPH_COLORS.labelBg;
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') {
        ctx.roundRect(
          textX - paddingX,
          textY - fontSize / 2 - paddingY,
          textWidth + paddingX * 2,
          fontSize + paddingY * 2,
          5,
        );
      } else {
        ctx.rect(
          textX - paddingX,
          textY - fontSize / 2 - paddingY,
          textWidth + paddingX * 2,
          fontSize + paddingY * 2,
        );
      }
      ctx.fill();

      ctx.fillStyle = isWorkspace
        ? GRAPH_COLORS.workspaceText
        : isTag
          ? GRAPH_COLORS.tagText
          : isMissing
            ? GRAPH_COLORS.missingText
            : GRAPH_COLORS.nodeText;
      ctx.fillText(label, textX, textY + fontSize / 2 - 2);
    }

    ctx.restore();
  }, [activeNodeId, highlighted.nodeIds, hoverNodeId, showLabels]);

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
          <button className="workspace-node-chip workspace-node-chip--toolbar-action" onClick={() => graphRef.current?.zoomToFit(450, 140)}>{t('workspaceGraph.fit')}</button>
          <div className="workspace-graph-toolbar__more" ref={overflowRef}>
            <button
              className="workspace-node-chip workspace-node-chip--toolbar-action"
              onClick={() => setOverflowOpen((value) => !value)}
              title={t('workspaceGraph.moreOptions')}
            >
              {t('workspaceGraph.more')}
            </button>
            {overflowOpen && (
              <div className="workspace-graph-toolbar__menu" role="menu">
                <button
                  className="workspace-graph-toolbar__menu-item"
                  onClick={() => {
                    const graph = graphRef.current;
                    if (!graph) return;
                    if (isPaused) graph.resumeAnimation();
                    else graph.pauseAnimation();
                    setIsPaused((value) => !value);
                  }}
                >
                  {isPaused ? t('workspaceGraph.resumeLayout') : t('workspaceGraph.pauseLayout')}
                </button>
                <button
                  className="workspace-graph-toolbar__menu-item"
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
                  className="workspace-graph-toolbar__menu-item"
                  onClick={() => { setOverflowOpen(false); void reload(); }}
                >
                  {t('workspaceNodes.refresh')}
                </button>
              </div>
            )}
          </div>
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
              onKeyDown={(event) => {
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
              className="workspace-node-chip"
              onClick={() => { setQuery(''); setSearchOpen(false); }}
              title={t('workspaceGraph.close')}
            >
              ✕
            </button>
          </div>
          {query.trim() && (
            <div className="workspace-graph-search__list" role="listbox">
              {searchSuggestions.length === 0 ? (
                <div className="workspace-graph-search__empty">{t('workspaceGraph.noMatches')}</div>
              ) : (
                searchSuggestions.map((item, index) => (
                  <button
                    key={`${getNodeWorkspaceId(item)}:${item.id}`}
                    type="button"
                    role="option"
                    aria-selected={index === suggestionIndex}
                    className={`workspace-graph-search__item${index === suggestionIndex ? ' is-active' : ''}`}
                    onMouseEnter={() => setSuggestionIndex(index)}
                    onClick={() => pickSuggestion(item)}
                  >
                    <span className="workspace-graph-search__title">{getNodeTitle(item, t('workspaceNodes.untitled'))}</span>
                    <span className="workspace-graph-search__meta">{item.workspaceName ?? ''}</span>
                  </button>
                ))
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
        <ForceGraph2D
          ref={graphRef as unknown as MutableRefObject<ForceGraphMethods<any, any> | undefined>}
          graphData={graphData}
          width={dimensions.width}
          height={dimensions.height}
          backgroundColor="rgba(0,0,0,0)"
          nodeLabel={(node) => node.label}
          onNodeHover={(node) => {
            setHoverNodeId(node ? getGraphId(node.id) : null);
          }}
          onNodeClick={handleNodeClick}
          onNodeRightClick={(node, event) => {
            event.preventDefault();
            handleNodeClick(node, event);
          }}
          onBackgroundClick={() => {
            setActiveNodeId(null);
            onSelectNode?.(null);
          }}
          linkWidth={(link) => highlighted.linkIds.size === 0 || highlighted.linkIds.has(linkKey(link)) ? 1.15 : 0.35}
          linkColor={(link) => {
            const highlightActive = highlighted.linkIds.size === 0 || highlighted.linkIds.has(linkKey(link));
            if (link.kind === 'workspace') return GRAPH_COLORS.workspaceLink;
            return highlightActive ? GRAPH_COLORS.linkHighlight : GRAPH_COLORS.link;
          }}
          linkDirectionalParticles={(link) => link.kind !== 'workspace' && highlighted.linkIds.has(linkKey(link)) ? 2 : 0}
          linkDirectionalParticleWidth={1.2}
          linkDirectionalParticleSpeed={0.005}
          cooldownTime={12000}
          nodeCanvasObject={renderNode}
          nodePointerAreaPaint={(node, paintColor, ctx) => {
            const radius = node.kind === 'workspace' ? 16 : node.kind === 'tag' ? 11 : node.kind === 'missing' ? 8 : 10;
            ctx.fillStyle = paintColor;
            ctx.beginPath();
            ctx.arc(node.x ?? 0, node.y ?? 0, radius, 0, Math.PI * 2);
            ctx.fill();
          }}
        />
      </div>

      <NodeDetailDrawer
        workspaceId={selectedNode?.workspaceId ?? ''}
        nodeId={selectedNode?.nodeId ?? null}
        tagDefinitions={tags}
        onClose={() => onSelectNode?.(null)}
        onOpenPage={onOpenNode}
        onDiscuss={handleDiscuss}
        onNodeChanged={() => { void reload(); }}
      />
    </main>
  );
};
