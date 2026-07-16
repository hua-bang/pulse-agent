import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasEdge, CanvasNode, CanvasTransform } from '../../types';
import { useI18n } from '../../i18n';
import { useCanvas } from '../../hooks/useCanvas';
import { useCanvasFit } from '../../hooks/useCanvasFit';
import { useCanvasVisibility } from '../Canvas/hooks/useCanvasVisibility';
import { useCanvasRenderOrder } from '../Canvas/hooks/useCanvasRenderOrder';
import { CanvasSurface } from '../Canvas/CanvasSurface';
// The reused surface pieces (.canvas-transform / .canvas-grid / node chrome
// positioning) are styled by the Canvas stylesheet. Import it explicitly —
// relying on the main Canvas having loaded it would be an implicit coupling.
import '../Canvas/index.css';
import { Button } from '../ui';
import {
  PREVIEW_FOCUS_NODE_EVENT,
  consumePendingPreviewFocus,
  dispatchPreviewNodeAction,
  type OpenNodeDetail,
} from '../../utils/openNodeBridge';
import { WorkspaceActiveProvider } from '../../hooks/useWorkspaceActive';
import { FileNodeEditorRegistryProvider } from '../../hooks/useFileNodeEditorRegistry';
import './canvas-preview.css';

interface CanvasPreviewProps {
  workspaceId: string;
  canvasName?: string;
  rootFolder?: string;
}

const NOOP = () => undefined;
const NOOP_DISPATCH = () => undefined;
const EMPTY_STR_SET: Set<string> = new Set();

interface Snapshot {
  nodes: CanvasNode[];
  edges: CanvasEdge[];
  transform: CanvasTransform;
}

const EMPTY_SNAPSHOT: Snapshot = {
  nodes: [],
  edges: [],
  transform: { x: 0, y: 0, scale: 1 },
};

/**
 * Read-only preview of another workspace's canvas, mounted as a right-dock
 * tab so two canvases can be viewed side by side. It loads the workspace
 * snapshot straight from the store and re-loads on external updates (agent /
 * CLI writes, or edits made in the main canvas). Rendering reuses the real
 * `CanvasSurface` in `readOnly` mode — nodes are faithful but non-interactive;
 * only pan (drag) and zoom (wheel) are allowed. All editing entry points are
 * disabled, so this view never mutates the previewed workspace.
 */
export const CanvasPreview = ({ workspaceId, canvasName, rootFolder }: CanvasPreviewProps) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const transformLayerRef = useRef<HTMLDivElement>(null);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY_SNAPSHOT);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  // Once the user pans/zooms the preview, stop auto-framing it.
  const userMovedRef = useRef(false);
  // Node the preview was asked to frame (reference "peek at source").
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  // Nodes recently written by an external writer (agent / CLI / main canvas);
  // rendered with the same purple ring the main canvas uses.
  const [externallyEditedIds, setExternallyEditedIds] = useState<Set<string>>(EMPTY_STR_SET);
  const editClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    transform, setTransform, settledScale, moving,
    handleWheel, handleMouseDown, handleMouseMove, handleMouseUp,
  } = useCanvas(true, transformLayerRef);
  const { fitAllNodes, handleFocusNode } = useCanvasFit(containerRef, setTransform);

  const load = useCallback(async () => {
    const api = window.canvasWorkspace?.store;
    if (!api) {
      setError(true);
      setLoaded(true);
      return;
    }
    const result = await api.load(workspaceId);
    if (!result.ok || !result.data) {
      // A workspace that was never saved simply has no snapshot yet; that's an
      // empty canvas, not an error.
      setSnapshot(EMPTY_SNAPSHOT);
      setError(!result.ok);
      setLoaded(true);
      return;
    }
    const data = result.data;
    setSnapshot({
      nodes: Array.isArray(data.nodes) ? data.nodes : [],
      edges: Array.isArray(data.edges) ? data.edges : [],
      transform: data.transform ?? EMPTY_SNAPSHOT.transform,
    });
    setError(false);
    setLoaded(true);
  }, [workspaceId]);

  // Initial load (and reset when the previewed workspace changes).
  useEffect(() => {
    userMovedRef.current = false;
    setLoaded(false);
    void load();
  }, [load]);

  // Keep the preview live: re-load when the previewed workspace is written to
  // (agent/CLI, or edits in the main canvas). The store diff only carries ids,
  // so we just re-read the authoritative snapshot from disk.
  useEffect(() => {
    const api = window.canvasWorkspace?.store;
    if (!api?.onExternalUpdate) return;
    void api.watchWorkspace?.(workspaceId);
    return api.onExternalUpdate((event) => {
      if (event.workspaceId !== workspaceId) return;
      void load();
      // Flash the same "agent edited" ring the main canvas shows, so writes
      // to the previewed canvas are visible, not just silently reloaded.
      if (Array.isArray(event.nodeIds) && event.nodeIds.length > 0) {
        setExternallyEditedIds((prev) => new Set([...prev, ...event.nodeIds]));
        if (editClearTimerRef.current) clearTimeout(editClearTimerRef.current);
        editClearTimerRef.current = setTimeout(() => setExternallyEditedIds(EMPTY_STR_SET), 2500);
      }
    });
  }, [workspaceId, load]);

  useEffect(() => () => {
    if (editClearTimerRef.current) clearTimeout(editClearTimerRef.current);
  }, []);

  // Focus requests (reference "peek at source"): consume the pending entry on
  // first load — the request may predate this mount — and react to live events
  // while open.
  useEffect(() => {
    if (!loaded) return;
    const pending = consumePendingPreviewFocus(workspaceId);
    if (pending) setFocusRequest(pending);
  }, [loaded, workspaceId]);

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent<OpenNodeDetail>).detail;
      if (detail?.workspaceId === workspaceId && detail.nodeId) setFocusRequest(detail.nodeId);
    };
    window.addEventListener(PREVIEW_FOCUS_NODE_EVENT, handler);
    return () => window.removeEventListener(PREVIEW_FOCUS_NODE_EVENT, handler);
  }, [workspaceId]);

  // React's root wheel listener is passive, so mirror the main canvas and
  // block Chromium's default ctrl/meta+wheel page zoom with a native listener.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const blockNativeZoom = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey) e.preventDefault();
    };
    el.addEventListener('wheel', blockNativeZoom, { passive: false });
    return () => el.removeEventListener('wheel', blockNativeZoom);
  }, [loaded]);

  const { visibleNodes, visibleNodesById, visibleEdges } = useCanvasVisibility({
    nodes: snapshot.nodes,
    edges: snapshot.edges,
    selectedEdgeId: null,
    setSelectedEdgeId: NOOP_DISPATCH,
    setSelectedNodeIds: NOOP_DISPATCH,
  });
  const { renderGroups } = useCanvasRenderOrder(visibleNodes);
  const getAllNodes = useCallback(() => visibleNodes, [visibleNodes]);

  const handleFitAll = useCallback(() => {
    fitAllNodes(visibleNodes);
  }, [fitAllNodes, visibleNodes]);

  // Reading actions stay available in the read-only preview: route them to
  // the Workbench via the window bridge (chat composer / reference panel of
  // the ACTIVE workspace), carrying the full node so no store read is needed.
  const dispatchNodeAction = useCallback((action: 'add-to-chat' | 'pin-reference' | 'add-to-canvas', nodeId: string) => {
    const node = visibleNodesById.get(nodeId);
    if (node) dispatchPreviewNodeAction({ action, workspaceId, node });
  }, [visibleNodesById, workspaceId]);
  const handleAddToChat = useCallback((nodeId: string) => dispatchNodeAction('add-to-chat', nodeId), [dispatchNodeAction]);
  const handlePinReference = useCallback((nodeId: string) => dispatchNodeAction('pin-reference', nodeId), [dispatchNodeAction]);
  const handleAddToCanvas = useCallback((nodeId: string) => dispatchNodeAction('add-to-canvas', nodeId), [dispatchNodeAction]);

  // Frame the whole canvas into the dock pane (fit-to-content). The pane is a
  // different shape from the main window and — crucially — animates its width
  // when the dock expands on open, so a single fit would land at a transient
  // size. Re-fit on every ResizeObserver tick until the user takes control
  // (pans/zooms), which also reframes on dock/window resizes and live reloads.
  // A pending focus request wins over both fit and the user's pan — the user
  // just asked to see that node — and freezes auto-fit at the focused framing.
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !loaded || visibleNodes.length === 0) return;
    const refit = () => {
      const rect = el.getBoundingClientRect();
      if (rect.width < 1 || rect.height < 1) return;
      if (focusRequest) {
        const target = visibleNodesById.get(focusRequest);
        setFocusRequest(null);
        if (target) {
          handleFocusNode(target);
          userMovedRef.current = true;
          return;
        }
      }
      if (!userMovedRef.current) fitAllNodes(visibleNodes);
    };
    const observer = new ResizeObserver(refit);
    observer.observe(el);
    refit();
    return () => observer.disconnect();
  }, [loaded, visibleNodes, visibleNodesById, focusRequest, fitAllNodes, handleFocusNode]);

  if (!loaded) {
    return (
      <div className="canvas-preview">
        <div className="canvas-preview__hint">{t('rightDock.loadingCanvas')}</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="canvas-preview">
        <div className="canvas-preview__hint">{t('rightDock.loadCanvasFailed')}</div>
      </div>
    );
  }

  return (
    <WorkspaceActiveProvider value={false}>
      <FileNodeEditorRegistryProvider>
        <div
          ref={containerRef}
          className="canvas-preview"
          onWheel={(e) => { userMovedRef.current = true; handleWheel(e); }}
          onMouseDown={(e) => {
            // Header action buttons (reference / add-to-chat / fit) must
            // receive a clean click — don't let the hand-tool pan grab it.
            if ((e.target as HTMLElement).closest?.('.node-header__actions, .canvas-preview__fit')) return;
            userMovedRef.current = true;
            handleMouseDown(e);
          }}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDragStart={(e) => e.preventDefault()}
          data-moving={moving ? 'on' : undefined}
        >
          <div className="canvas-grid" />
          {visibleNodes.length === 0 ? (
            <div className="canvas-preview__hint">{t('rightDock.emptyCanvas')}</div>
          ) : (
            <>
              <CanvasSurface
                readOnly
                transform={transform}
                transformLayerRef={transformLayerRef}
                settledScale={settledScale}
                animating={false}
                moving={moving}
                renderGroups={renderGroups}
                nodes={visibleNodes}
                edges={visibleEdges}
                rootFolder={rootFolder}
                canvasId={workspaceId}
                canvasName={canvasName}
                draggingId={null}
                draggingIds={EMPTY_STR_SET}
                resizingId={null}
                selectedNodeIdSet={EMPTY_STR_SET}
                selectedEdgeId={null}
                highlightedId={null}
                externallyEditedIds={externallyEditedIds}
                edgeInteractionState={null}
                edgePreviewEndpoints={null}
                onDragStart={NOOP}
                onResizeStart={NOOP}
                onUpdate={NOOP}
                onAutoResize={NOOP}
                onRemove={NOOP}
                onExportMindmapImage={NOOP}
                onSelect={NOOP}
                onFocus={NOOP}
                onReference={handlePinReference}
                onAddToChat={handleAddToChat}
                onAddToCanvas={handleAddToCanvas}
                onSelectEdge={NOOP}
                onEdgeHandleMouseDown={NOOP}
                onEdgeBodyMouseDown={NOOP}
                onEdgeBodyDoubleClick={NOOP}
                getAllNodes={getAllNodes}
              />
              <Button
                variant="secondary"
                size="sm"
                className="canvas-preview__fit"
                onClick={handleFitAll}
                title={t('rightDock.fitCanvas')}
              >
                {t('rightDock.fitCanvas')}
              </Button>
            </>
          )}
        </div>
      </FileNodeEditorRegistryProvider>
    </WorkspaceActiveProvider>
  );
};
