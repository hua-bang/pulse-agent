import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentContextDomReviewComment, AgentContextTabRef, CanvasNode } from '../../../types';
import { useI18n } from '../../../i18n';
import { useCanvas } from '../../../hooks/useCanvas';
import { useCanvasFit } from '../../../hooks/useCanvasFit';
import { useCanvasVisibility } from '../../canvas/Canvas/hooks/useCanvasVisibility';
import { useCanvasRenderOrder } from '../../canvas/Canvas/hooks/useCanvasRenderOrder';
import { CanvasSurface } from '../../canvas/Canvas/CanvasSurface';
import { Canvas } from '../../canvas/Canvas';
// The reused surface pieces (.canvas-transform / .canvas-grid / node chrome
// positioning) are styled by the Canvas stylesheet. Import it explicitly —
// relying on the main Canvas having loaded it would be an implicit coupling.
import '../../canvas/Canvas/index.css';
import {
  PREVIEW_FOCUS_NODE_EVENT,
  consumePendingPreviewFocus,
  dispatchPreviewNodeAction,
  type OpenNodeDetail,
} from '../../../utils/openNodeBridge';
import { WorkspaceActiveProvider } from '../../../hooks/useWorkspaceActive';
import { FileNodeEditorRegistryProvider } from '../../../hooks/useFileNodeEditorRegistry';
import { CanvasPreviewChrome, CanvasPreviewState } from './CanvasPreviewChrome';
import type { ChatDeliveryReceipt } from '../../../agent-chat/target';
import { TabChatAction } from './TabChatAction';
import {
  EMPTY_CANVAS_PREVIEW_SNAPSHOT,
  useCanvasPreviewEditorController,
} from './useCanvasPreviewEditorController';
import './canvas-preview.css';

interface CanvasPreviewProps {
  workspaceId: string;
  canvasName?: string;
  rootFolder?: string;
  tabRef?: AgentContextTabRef;
  targetWorkspaceId?: string;
  onAddTabToChat?: (workspaceId: string, tab: AgentContextTabRef) => Promise<ChatDeliveryReceipt>;
  /** Transient host capability. Only the dedicated AI Chat route grants it. */
  editingAllowed?: boolean;
  /** Whether this pane is visible. Keyboard ownership is narrowed further by
   * the latest interaction between the editable pane and adjacent Chat. */
  active?: boolean;
  onNodesChange?: (canvasId: string, nodes: CanvasNode[]) => void;
  onSelectionChange?: (canvasId: string, selectedNodeIds: string[]) => void;
  onAddDomSelectionToChat?: Parameters<typeof Canvas>[0]['onAddDomSelectionToChat'];
  onSubmitDomReviewComments?: (
    workspaceId: string,
    comments: AgentContextDomReviewComment[],
  ) => Promise<boolean>;
}

const NOOP = () => undefined;
const NOOP_DISPATCH = () => undefined;
const EMPTY_STR_SET: Set<string> = new Set();

const PREVIEW_ZOOM_STEP = 1.2;

/**
 * Canvas tab for another workspace. It starts as a read-only snapshot that
 * stays live with external writes. Only the dedicated AI Chat host may offer
 * an explicit Edit mode; that branch mounts the real Canvas so persistence,
 * edge/node history and undo retain their canonical behavior. Every other
 * host remains read-only, and host permission is transient rather than part
 * of the persisted tab.
 */
export const CanvasPreview = ({
  workspaceId,
  canvasName,
  rootFolder,
  tabRef,
  targetWorkspaceId,
  onAddTabToChat,
  editingAllowed = false,
  active = false,
  onNodesChange,
  onSelectionChange,
  onAddDomSelectionToChat,
  onSubmitDomReviewComments,
}: CanvasPreviewProps) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement>(null);
  const transformLayerRef = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);
  const editor = useCanvasPreviewEditorController({
    active,
    editingAllowed,
    workspaceId,
    onNodesChange,
    onSubmitDomReviewComments,
  });
  const {
    clipboard,
    editing,
    editorRegionRef,
    handleClipboardChange,
    handleEdgesChange,
    handleEditToggle,
    handleNodesChange,
    handleSubmitDomReviewComments,
    keyboardActive,
    replaceSnapshot,
    snapshot,
  } = editor;
  // Preview reads are advisory while the canonical Canvas editor is mounted.
  // Track the current workspace/edit boundary synchronously so a request that
  // started before Edit (or for a previous workspace) cannot commit after an
  // await. A monotonically increasing generation also makes concurrent preview
  // reloads latest-wins.
  const loadCommitStateRef = useRef({ workspaceId, editing, generation: 0 });
  const loadCommitState = loadCommitStateRef.current;
  if (loadCommitState.workspaceId !== workspaceId || loadCommitState.editing !== editing) {
    loadCommitStateRef.current = {
      workspaceId,
      editing,
      generation: loadCommitState.generation + 1,
    };
  }
  // Once the user pans/zooms the preview, stop auto-framing it.
  const userMovedRef = useRef(false);
  // Node the preview was asked to frame (reference "peek at source").
  const [focusRequest, setFocusRequest] = useState<string | null>(null);
  // Nodes recently written by an external writer (agent / CLI / main canvas);
  // rendered with the same purple ring the main canvas uses.
  const [externallyEditedIds, setExternallyEditedIds] = useState<Set<string>>(EMPTY_STR_SET);
  const editClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const {
    transform, setTransform, settledScale, moving, zoomByStep,
    handleWheel, handleMouseDown, handleMouseMove, handleMouseUp,
  } = useCanvas(true, transformLayerRef);
  const { fitAllNodes, handleFocusNode } = useCanvasFit(containerRef, setTransform);

  const load = useCallback(async () => {
    // The canonical Canvas owns external synchronization in Edit mode and
    // mirrors its merged node/edge snapshots back through the controller.
    if (loadCommitStateRef.current.editing) return;
    const requestedWorkspaceId = workspaceId;
    const requestGeneration = loadCommitStateRef.current.generation + 1;
    loadCommitStateRef.current = {
      ...loadCommitStateRef.current,
      generation: requestGeneration,
    };
    const canCommit = () => {
      const current = loadCommitStateRef.current;
      return current.generation === requestGeneration
        && current.workspaceId === requestedWorkspaceId
        && !current.editing;
    };
    const api = window.canvasWorkspace?.store;
    if (!api) {
      if (!canCommit()) return;
      setError(true);
      setLoaded(true);
      return;
    }
    let result: Awaited<ReturnType<typeof api.load>>;
    try {
      result = await api.load(workspaceId);
    } catch {
      if (!canCommit()) return;
      setError(true);
      setLoaded(true);
      return;
    }
    if (!canCommit()) return;
    if (!result.ok || !result.data) {
      // A workspace that was never saved simply has no snapshot yet; that's an
      // empty canvas, not an error.
      replaceSnapshot(EMPTY_CANVAS_PREVIEW_SNAPSHOT);
      setError(!result.ok);
      setLoaded(true);
      return;
    }
    const data = result.data;
    replaceSnapshot({
      nodes: Array.isArray(data.nodes) ? data.nodes : [],
      edges: Array.isArray(data.edges) ? data.edges : [],
      transform: data.transform ?? EMPTY_CANVAS_PREVIEW_SNAPSHOT.transform,
    });
    setError(false);
    setLoaded(true);
  }, [replaceSnapshot, workspaceId]);

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
  // Full snapshot, not visibleNodes: descendant counts (collapsed-frame badge)
  // must see children that the collapse itself hid from rendering.
  const getAllNodes = useCallback(() => snapshot.nodes, [snapshot.nodes]);

  const handleFitAll = useCallback(() => {
    fitAllNodes(visibleNodes);
  }, [fitAllNodes, visibleNodes]);

  const handleZoom = useCallback((factor: number) => {
    userMovedRef.current = true;
    zoomByStep(factor, containerRef.current);
  }, [zoomByStep]);
  const handleZoomOut = useCallback(() => handleZoom(1 / PREVIEW_ZOOM_STEP), [handleZoom]);
  const handleZoomIn = useCallback(() => handleZoom(PREVIEW_ZOOM_STEP), [handleZoom]);
  const handleRetry = useCallback(() => {
    setError(false);
    setLoaded(false);
    void load();
  }, [load]);
  const previewLabel = t('rightDock.canvasPreviewRegion', {
    name: canvasName ?? t('rightDock.canvasPreviewName'),
  });
  const tabChatAction = tabRef && targetWorkspaceId && onAddTabToChat ? (
    <TabChatAction
      className="canvas-preview__ask-ai"
      tab={tabRef}
      targetWorkspaceId={targetWorkspaceId}
      onAddToChat={onAddTabToChat}
    />
  ) : null;

  // Reading actions stay available in preview and edit modes: route them to
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
    return <CanvasPreviewState label={previewLabel} kind="loading" action={tabChatAction} />;
  }

  if (error) {
    return <CanvasPreviewState label={previewLabel} kind="error" onRetry={handleRetry} action={tabChatAction} />;
  }

  if (editing) {
    const editableLabel = t('rightDock.editableCanvasRegion', {
      name: canvasName ?? t('rightDock.canvasPreviewName'),
    });
    return (
      <div
        ref={editorRegionRef}
        className="canvas-preview"
        data-mode="edit"
        role="region"
        aria-label={editableLabel}
      >
        <FileNodeEditorRegistryProvider>
          <Canvas
            canvasId={workspaceId}
            canvasName={canvasName}
            rootFolder={rootFolder}
            isActive={active}
            keyboardActive={keyboardActive}
            persistViewport={false}
            clipboard={clipboard}
            onClipboardChange={handleClipboardChange}
            onNodesChange={handleNodesChange}
            onEdgesChange={handleEdgesChange}
            onSelectionChange={onSelectionChange}
            onPinReferenceNode={handlePinReference}
            onAddToChat={handleAddToChat}
            onAddDomSelectionToChat={onAddDomSelectionToChat}
            onSubmitDomReviewComments={handleSubmitDomReviewComments}
          />
        </FileNodeEditorRegistryProvider>
        <CanvasPreviewChrome
          scale={transform.scale}
          canFit={false}
          editingAllowed
          editing
          onEditToggle={handleEditToggle}
          onZoomOut={handleZoomOut}
          onZoomIn={handleZoomIn}
          onFit={handleFitAll}
        />
        {tabChatAction}
      </div>
    );
  }

  return (
    <WorkspaceActiveProvider value={false}>
      <FileNodeEditorRegistryProvider>
        <div
          ref={containerRef}
          className="canvas-preview"
          data-mode="preview"
          role="region"
          aria-label={previewLabel}
          onWheel={(e) => { userMovedRef.current = true; handleWheel(e); }}
          onMouseDown={(e) => {
            // Header action buttons (reference / add-to-chat / fit) must
            // receive a clean click — don't let the hand-tool pan grab it.
            if ((e.target as HTMLElement).closest?.('.node-header__actions, .canvas-preview__chrome')) return;
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
            <div className="canvas-preview__hint" role="status">{t('rightDock.emptyCanvas')}</div>
          ) : (
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
          )}
          <CanvasPreviewChrome
            scale={transform.scale}
            canFit={visibleNodes.length > 0}
            editingAllowed={editingAllowed}
            editing={false}
            onEditToggle={handleEditToggle}
            onZoomOut={handleZoomOut}
            onZoomIn={handleZoomIn}
            onFit={handleFitAll}
          />
          {tabChatAction}
        </div>
      </FileNodeEditorRegistryProvider>
    </WorkspaceActiveProvider>
  );
};
