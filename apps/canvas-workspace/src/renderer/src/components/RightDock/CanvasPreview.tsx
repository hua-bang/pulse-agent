import { useCallback, useEffect, useRef, useState } from 'react';
import type { CanvasEdge, CanvasNode, CanvasTransform } from '../../types';
import { useI18n } from '../../i18n';
import { useCanvas } from '../../hooks/useCanvas';
import { useCanvasFit } from '../../hooks/useCanvasFit';
import { useCanvasVisibility } from '../Canvas/hooks/useCanvasVisibility';
import { useCanvasRenderOrder } from '../Canvas/hooks/useCanvasRenderOrder';
import { CanvasSurface } from '../Canvas/CanvasSurface';
import { Button } from '../ui';
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
  const appliedInitialTransformRef = useRef(false);

  const {
    transform, setTransform, settledScale, moving,
    handleWheel, handleMouseDown, handleMouseMove, handleMouseUp,
  } = useCanvas(true, transformLayerRef);
  const { fitAllNodes } = useCanvasFit(containerRef, setTransform);

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
    appliedInitialTransformRef.current = false;
    setLoaded(false);
    void load();
  }, [load]);

  // Adopt the workspace's saved viewport once, on first successful load, so
  // the preview opens framed the way the workspace was last left.
  useEffect(() => {
    if (!loaded || appliedInitialTransformRef.current) return;
    appliedInitialTransformRef.current = true;
    setTransform(snapshot.transform);
  }, [loaded, snapshot.transform, setTransform]);

  // Keep the preview live: re-load when the previewed workspace is written to
  // (agent/CLI, or edits in the main canvas). The store diff only carries ids,
  // so we just re-read the authoritative snapshot from disk.
  useEffect(() => {
    const api = window.canvasWorkspace?.store;
    if (!api?.onExternalUpdate) return;
    void api.watchWorkspace?.(workspaceId);
    return api.onExternalUpdate((event) => {
      if (event.workspaceId === workspaceId) void load();
    });
  }, [workspaceId, load]);

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
          onWheel={handleWheel}
          onMouseDown={handleMouseDown}
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
                externallyEditedIds={EMPTY_STR_SET}
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
