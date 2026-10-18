// Shared Knowledge page tokens and layout; this page can open before any detail panel loads them.
import '../index.css';
import './index.css';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { WorkspaceEntry } from '../../../../shared/workspaces';
import type { KnowledgeNodeSelection } from '../../../../types';
import { useAllWorkspaceNodeList } from '../useWorkspaceNodes';
import { getNodeTitle, getNodeWorkspaceId } from '../utils';
import { useI18n } from '../../../../i18n';
import { useRightDock } from '../../../../shared/dockPort';
import { dispatchOpenNode } from '../../../../utils/openNodeBridge';
import {
  buildWorkspaceGraph,
  getGraphId,
  getWorkspaceGraphHighlight,
  nodeGraphId,
  type WorkspaceGraphNode as GraphNode,
  type WorkspaceGraphSearchResult as GraphSearchResult,
} from '../../model/graphModel';
import {
  ForceGraphCanvas,
  type ForceGraphCanvasHandle,
  type GraphLayoutPreset,
} from '../ForceGraphCanvas';
import { GraphSearch } from './GraphSearch';
import { GraphLegend } from './GraphLegend';
import { GraphToolbar } from './GraphToolbar';
import { KnowledgeViewTabs } from '../KnowledgeViewTabs';

interface GraphPageProps {
  workspaces: WorkspaceEntry[];
  selectedNode?: KnowledgeNodeSelection | null;
  onSelectNode?: (selection: KnowledgeNodeSelection | null) => void;
  /** Switch to the list view; omitted when the list is unavailable. */
  onOpenList?: () => void;
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
  onOpenList,
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
  const [layoutPreset, setLayoutPreset] = useState<GraphLayoutPreset>('normal');
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(selectedGraphId(selectedNode));
  const [showWorkspaceHubs, setShowWorkspaceHubs] = useState(true);
  // Off-canvas nodes (knowledge records with no matching canvas node — e.g.
  // stale/orphan records) are hidden by default; toggle to reveal them.
  const [showOffCanvas, setShowOffCanvas] = useState(false);

  useEffect(() => {
    setActiveNodeId(selectedGraphId(selectedNode));
  }, [selectedNode]);

  const visibleNodes = useMemo(
    () => (showOffCanvas ? nodes : nodes.filter((node) => node.onCanvas !== false)),
    [nodes, showOffCanvas],
  );

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

  // Opening the dock narrows the graph. Pan only when that hides the active
  // node, so the node the user just clicked stays in view beside its detail.
  useEffect(() => {
    if (!activeNodeId) return undefined;
    const timeout = window.setTimeout(() => {
      const node = graphData.nodes.find((item) => getGraphId(item.id) === activeNodeId);
      if (node) graphRef.current?.revealNode(node);
    }, 80);
    return () => window.clearTimeout(timeout);
    // Only a size change should move the view; selection alone never does.
  }, [dimensions.width, dimensions.height]);

  // Note: we deliberately do NOT auto-focus when `selectedNode` changes.
  // Single-click on a graph node opens its dock tab, and a focus effect
  // here would yank the viewport on every click. Double-click remains the
  // explicit zoom gesture.

  const pickSuggestion = useCallback((result: GraphSearchResult) => {
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
    if (item.type === 'iframe') dispatchOpenNode({ workspaceId, nodeId: item.id });
    else dock.openNodeDetail(workspaceId, item.id, getNodeTitle(item, t('workspaceNodes.untitled')), true);
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

    // Single click: show the node in the one graph preview tab, so browsing
    // does not add a tab per click. Don't reframe the viewport — the user
    // may be deliberately panning around.
    if (isNodeGraphNode(node)) {
      onSelectNode?.({ workspaceId: node.workspaceId, nodeId: node.nodeId });
      const item = nodes.find((entry) => entry.id === node.nodeId && getNodeWorkspaceId(entry) === node.workspaceId);
      if (item?.type === 'iframe') dispatchOpenNode({ workspaceId: node.workspaceId, nodeId: node.nodeId });
      else dock.openNodeDetail(node.workspaceId, node.nodeId, node.label, true);
    }
  }, [dock, focusNode, nodes, onSelectNode]);

  return (
    <main className="workspace-graph-page" ref={containerRef}>
      <GraphToolbar
        leading={onOpenList && (
          <KnowledgeViewTabs value="graph" onChange={(view) => view === 'list' && onOpenList()} />
        )}
        search={(
          <GraphSearch
            nodes={visibleNodes}
            tags={tags}
            showTags={showTags}
            onPick={pickSuggestion}
          />
        )}
        graphRef={graphRef}
        layoutPreset={layoutPreset}
        showLabels={showLabels}
        showOffCanvas={showOffCanvas}
        showWorkspaceHubs={showWorkspaceHubs}
        workspaceCount={workspaces.length}
        onLayoutPresetChange={setLayoutPreset}
        onReload={() => { void reload(); }}
        onShowLabelsChange={setShowLabels}
        onShowOffCanvasChange={setShowOffCanvas}
        onShowWorkspaceHubsChange={setShowWorkspaceHubs}
      />

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

      {visibleNodes.length > 0 && (
        <GraphLegend
          showTags={graphData.nodes.some((node) => node.kind === 'tag')}
          showWorkspaces={graphData.nodes.some((node) => node.kind === 'workspace')}
        />
      )}
    </main>
  );
};
