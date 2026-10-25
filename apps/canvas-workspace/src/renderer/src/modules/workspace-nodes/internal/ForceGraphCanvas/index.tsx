import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  type MutableRefObject,
} from 'react';
import ForceGraph2D, {
  type ForceGraphMethods,
  type LinkObject,
  type NodeObject,
} from 'react-force-graph-2d';
import {
  getGraphId,
  type WorkspaceGraphData,
  type WorkspaceGraphLink,
  type WorkspaceGraphNode,
} from '../../model/graphModel';
import { useResolvedTheme } from '../../../../shared/theme';

export type GraphLayoutPreset = 'compact' | 'normal' | 'loose';

export interface ForceGraphCanvasHandle {
  focusNode: (node: WorkspaceGraphNode, zoom?: number) => void;
  /** Pan, without zooming, only when the node sits outside the visible area. */
  revealNode: (node: WorkspaceGraphNode) => void;
  setPaused: (paused: boolean) => void;
  zoomToFit: () => void;
}

interface ForceGraphCanvasView {
  graph: WorkspaceGraphData;
  width: number;
  height: number;
  activeNodeId: string | null;
  hoverNodeId: string | null;
  highlightedNodeIds: ReadonlySet<string>;
  highlightedLinkIds: ReadonlySet<string>;
  showLabels: boolean;
  layoutPreset: GraphLayoutPreset;
}

interface ForceGraphCanvasActions {
  hoverNode: (nodeId: string | null) => void;
  clickNode: (node: WorkspaceGraphNode, event: MouseEvent) => void;
  clearSelection: () => void;
}

interface Props {
  view: ForceGraphCanvasView;
  actions: ForceGraphCanvasActions;
}

// Also read by GraphLegend, so the legend dots match what the canvas draws.
export const GRAPH_COLORS = {
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

// Canvas paint cannot read CSS tokens; the dark theme swaps the ink colors.
const DARK_GRAPH_COLORS: typeof GRAPH_COLORS = {
  ...GRAPH_COLORS,
  nodeText: '#8dbcf0',
  tagText: '#f0b56b',
  missingText: 'rgba(255, 255, 255, 0.55)',
  workspaceText: '#c4b5fd',
  link: 'rgba(255, 255, 255, 0.2)',
  linkHighlight: 'rgba(255, 255, 255, 0.62)',
  labelBg: 'rgba(36, 36, 35, 0.92)',
};

const GRAPH_MAX_ZOOM = 2.5;
// Labels outside the hovered/selected neighbourhood stay readable but recede.
const DIMMED_NODE_ALPHA = 0.18;
const DIMMED_LABEL_ALPHA = 0.4;
const GRAPH_LABEL_MAX_CHARS = 24;
// A node this close to the viewport edge counts as hidden.
const REVEAL_MARGIN_PX = 48;
// Labels keep one on-screen size at every zoom level.
const LABEL_SCREEN_PX = 12;

const linkKey = (link: LinkObject<WorkspaceGraphNode, WorkspaceGraphLink>): string =>
  `${getGraphId(link.source)}->${getGraphId(link.target)}`;

export const ForceGraphCanvas = forwardRef<ForceGraphCanvasHandle, Props>(({ view, actions }, ref) => {
  const graphRef = useRef<ForceGraphMethods<WorkspaceGraphNode, WorkspaceGraphLink>>();
  const colors = useResolvedTheme() === 'dark' ? DARK_GRAPH_COLORS : GRAPH_COLORS;
  const sizeRef = useRef({ width: view.width, height: view.height });
  sizeRef.current = { width: view.width, height: view.height };
  // The layout keeps moving after the first fit. Fit again when it settles,
  // unless the user or a focus command has moved the view since.
  const viewMovedRef = useRef(false);

  useImperativeHandle(ref, () => ({
    focusNode: (node, zoom = GRAPH_MAX_ZOOM) => {
      if (node.x === undefined || node.y === undefined) return;
      viewMovedRef.current = true;
      graphRef.current?.centerAt(node.x, node.y, 520);
      graphRef.current?.zoom(zoom, 520);
    },
    revealNode: (node) => {
      const graph = graphRef.current;
      if (!graph || node.x === undefined || node.y === undefined) return;
      const point = graph.graph2ScreenCoords(node.x, node.y);
      const { width, height } = sizeRef.current;
      const visible = point.x >= REVEAL_MARGIN_PX && point.x <= width - REVEAL_MARGIN_PX
        && point.y >= REVEAL_MARGIN_PX && point.y <= height - REVEAL_MARGIN_PX;
      if (visible) return;
      viewMovedRef.current = true;
      graph.centerAt(node.x, node.y, 420);
    },
    setPaused: (paused) => {
      if (paused) graphRef.current?.pauseAnimation();
      else graphRef.current?.resumeAnimation();
    },
    zoomToFit: () => graphRef.current?.zoomToFit(450, 140),
  }), []);

  useEffect(() => {
    const graph = graphRef.current;
    if (!graph) return undefined;
    const preset = view.layoutPreset === 'compact'
      ? { linkDistance: 58, charge: -110 }
      : view.layoutPreset === 'loose'
        ? { linkDistance: 120, charge: -280 }
        : { linkDistance: 82, charge: -165 };
    const charge = graph.d3Force('charge');
    charge?.strength?.(preset.charge);
    charge?.distanceMax?.(view.layoutPreset === 'loose' ? 1200 : 900);
    graph.d3Force('link')?.distance?.(preset.linkDistance);
    graph.d3ReheatSimulation();
    viewMovedRef.current = false;
    const timeout = window.setTimeout(() => graph.zoomToFit(450, 140), 60);
    return () => window.clearTimeout(timeout);
  }, [view.graph.links.length, view.graph.nodes.length, view.layoutPreset]);

  const renderNode = useCallback((
    node: NodeObject<WorkspaceGraphNode>,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    const nodeId = getGraphId(node.id);
    const isTag = node.kind === 'tag';
    const isMissing = node.kind === 'missing';
    const isWorkspace = node.kind === 'workspace';
    const radius = isWorkspace ? 12 : isTag ? 8 : isMissing ? 5 : 6.5;
    const highlighted = view.highlightedNodeIds.size === 0 || view.highlightedNodeIds.has(nodeId);
    const selected = view.activeNodeId === nodeId;
    const hovered = view.hoverNodeId === nodeId;
    const fill = isWorkspace ? colors.workspace : isTag ? colors.tag : isMissing ? colors.missing : colors.node;

    ctx.save();
    ctx.globalAlpha = highlighted ? 1 : DIMMED_NODE_ALPHA;
    if (selected || hovered) {
      ctx.shadowColor = fill;
      ctx.shadowBlur = 14;
    }
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, selected ? radius + 2.5 : radius, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.shadowBlur = 0;
    ctx.globalAlpha = 1;

    const showLabel = view.showLabels || selected || hovered || isWorkspace || globalScale > 2.3;
    if (showLabel) {
      ctx.globalAlpha = highlighted ? 1 : DIMMED_LABEL_ALPHA;
      // Long titles overlapped their neighbours; the full text shows on
      // hover and selection.
      const fullLabel = node.label || nodeId;
      const label = selected || hovered || fullLabel.length <= GRAPH_LABEL_MAX_CHARS
        ? fullLabel
        : `${fullLabel.slice(0, GRAPH_LABEL_MAX_CHARS - 1)}…`;
      const fontSize = LABEL_SCREEN_PX / globalScale;
      ctx.font = `${fontSize}px "Lexend Variable", "PingFang SC", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;
      const textWidth = ctx.measureText(label).width;
      const textX = (node.x ?? 0) + radius + 6;
      const textY = (node.y ?? 0) + 1;
      ctx.fillStyle = colors.labelBg;
      ctx.beginPath();
      const rect = [textX - 4, textY - fontSize / 2 - 2.5, textWidth + 8, fontSize + 5] as const;
      if (typeof ctx.roundRect === 'function') ctx.roundRect(...rect, 5);
      else ctx.rect(...rect);
      ctx.fill();
      ctx.fillStyle = isWorkspace
        ? colors.workspaceText
        : isTag
          ? colors.tagText
          : isMissing
            ? colors.missingText
            : colors.nodeText;
      ctx.fillText(label, textX, textY + fontSize / 2 - 2);
    }
    ctx.restore();
  }, [colors, view.activeNodeId, view.highlightedNodeIds, view.hoverNodeId, view.showLabels]);

  const markViewMoved = () => {
    viewMovedRef.current = true;
  };

  return (
    // `display: contents` keeps the graph canvas in the parent's layout.
    <div
      className="force-graph-canvas"
      style={{ display: 'contents' }}
      onPointerDownCapture={markViewMoved}
      onWheelCapture={markViewMoved}
    >
      <ForceGraph2D
        ref={graphRef as MutableRefObject<ForceGraphMethods<any, any> | undefined>}
        graphData={view.graph}
        width={view.width}
        height={view.height}
        backgroundColor="rgba(0,0,0,0)"
        // Labels are drawn on the canvas; a hover tooltip would repeat them.
        nodeLabel={() => ''}
        onNodeHover={(node) => actions.hoverNode(node ? getGraphId(node.id) : null)}
        onNodeClick={(node, event) => actions.clickNode(node, event)}
        onNodeRightClick={(node, event) => { event.preventDefault(); actions.clickNode(node, event); }}
        onBackgroundClick={actions.clearSelection}
        linkWidth={(link) => view.highlightedLinkIds.size === 0 || view.highlightedLinkIds.has(linkKey(link)) ? 1.15 : 0.35}
        linkColor={(link) => {
          if (link.kind === 'workspace') return colors.workspaceLink;
          return view.highlightedLinkIds.size === 0 || view.highlightedLinkIds.has(linkKey(link))
            ? colors.linkHighlight
            : colors.link;
        }}
        linkDirectionalParticles={(link) => link.kind !== 'workspace' && view.highlightedLinkIds.has(linkKey(link)) ? 2 : 0}
        linkDirectionalParticleWidth={1.2}
        linkDirectionalParticleSpeed={0.005}
        cooldownTime={12000}
        // Settle the layout before the first paint, so the first fit frames the
        // spread-out graph instead of a tight cluster. The cap stops a handful
        // of nodes from filling the screen.
        warmupTicks={80}
        onEngineStop={() => {
          if (!viewMovedRef.current) graphRef.current?.zoomToFit(450, 140);
        }}
        maxZoom={GRAPH_MAX_ZOOM}
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
  );
});

ForceGraphCanvas.displayName = 'ForceGraphCanvas';
