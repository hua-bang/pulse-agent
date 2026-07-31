import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode, WorkspaceNodeListItem, WorkspaceNodeRecord } from '../../types';
import { CanvasNodeView } from '../CanvasNodeView';
import { isKnowledgeNodeType } from './utils';
import { useI18n } from '../../i18n';
import { Button } from '../ui';
import { getNodeDetailDescriptor } from './nodeDetailDescriptor';
import { useMindmapDetailPan } from './useMindmapDetailPan';
import { NodeCanvasSaveError } from './NodeCanvasSaveError';

type WritablePatch = Pick<WorkspaceNodeRecord, 'title' | 'data' | 'properties' | 'links'>;

/** Fold a newly failed write into the one still awaiting retry, so a retry
 *  replays every unsaved change rather than only the last keystroke. */
const mergePatches = (
  previous: Partial<WritablePatch> | null,
  next: Partial<WritablePatch>,
): Partial<WritablePatch> => {
  if (!previous) return next;
  return {
    ...previous,
    ...next,
    ...(previous.data || next.data ? { data: { ...previous.data, ...next.data } } : {}),
    ...(previous.properties || next.properties
      ? { properties: { ...previous.properties, ...next.properties } }
      : {}),
  };
};

interface NodeCanvasPreviewProps {
  workspaceId: string;
  record: WorkspaceNodeRecord;
  /** Fallback height when ResizeObserver hasn't measured yet. */
  minHeight?: number;
  mentionCandidates?: WorkspaceNodeListItem[];
  readOnly?: boolean;
  onPatched?: (next: WorkspaceNodeRecord) => void;
}

/**
 * Adapt a `WorkspaceNodeRecord` (the on-disk knowledge atom) to the
 * `CanvasNode` shape and render it through the canvas's own
 * `CanvasNodeView`. Tracks the parent container size with ResizeObserver
 * so the preview fills the drawer/page area instead of using a fixed box.
 *
 * Layout fields (x/y/width/height/ref) live only in this preview — patches
 * targeting those are dropped before they hit the workspace-node store.
 */
export const NodeCanvasPreview = ({
  workspaceId,
  record,
  minHeight = 240,
  mentionCandidates = [],
  readOnly = false,
  onPatched,
}: NodeCanvasPreviewProps) => {
  const { t } = useI18n();
  const detail = getNodeDetailDescriptor(record.type);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 320, height: minHeight });
  const [displayRecord, setDisplayRecord] = useState(record);
  const [failedPatch, setFailedPatch] = useState<Partial<WritablePatch> | null>(null);
  const [retrying, setRetrying] = useState(false);
  const latestRecordRef = useRef(record);
  const updateSeqRef = useRef(0);
  const updatePendingRef = useRef(false);
  // Read inside the record-sync effect, which must not re-run per render.
  const failedPatchRef = useRef<Partial<WritablePatch> | null>(null);
  failedPatchRef.current = failedPatch;
  const mindmapPan = useMindmapDetailPan(detail.backgroundPan, containerRef);

  useEffect(() => {
    if (record.id !== latestRecordRef.current.id) {
      updateSeqRef.current += 1;
      updatePendingRef.current = false;
      failedPatchRef.current = null;
      setFailedPatch(null);
      latestRecordRef.current = record;
      setDisplayRecord(record);
      return;
    }
    // Workspace change broadcasts can arrive while a newer local keystroke is
    // still saving. Keep the optimistic document until the latest request is
    // acknowledged, then resume following external record changes. Unsaved
    // work from a FAILED write is held for the same reason and for longer —
    // until the user retries or explicitly discards it.
    if (updatePendingRef.current || failedPatchRef.current) return;
    latestRecordRef.current = record;
    setDisplayRecord(record);
  }, [record]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const w = Math.max(160, Math.floor(entry.contentRect.width));
      const h = Math.max(minHeight, Math.floor(entry.contentRect.height));
      setSize((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [minHeight]);

  const previewNode = useMemo<CanvasNode | null>(() => {
    if (!isKnowledgeNodeType(displayRecord.type)) return null;
    return {
      id: displayRecord.id,
      type: displayRecord.type,
      title: displayRecord.title ?? '',
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      data: (displayRecord.data ?? {}) as CanvasNode['data'],
      properties: displayRecord.properties,
      links: displayRecord.links,
      updatedAt: displayRecord.updatedAt,
    } satisfies CanvasNode;
  }, [displayRecord, size.width, size.height]);

  const getAllNodes = useCallback(() => {
    const nodes: CanvasNode[] = [];
    const seen = new Set<string>();
    if (previewNode) {
      nodes.push(previewNode);
      seen.add(previewNode.id);
    }
    for (const candidate of mentionCandidates) {
      if (seen.has(candidate.id) || !isKnowledgeNodeType(candidate.type)) continue;
      seen.add(candidate.id);
      nodes.push({
        id: candidate.id,
        type: candidate.type,
        title: candidate.title ?? candidate.displayTitle ?? '',
        x: 0,
        y: 0,
        width: 320,
        height: 240,
        data: {} as CanvasNode['data'],
        updatedAt: candidate.updatedAt,
      } satisfies CanvasNode);
    }
    return nodes;
  }, [mentionCandidates, previewNode]);

  const commitPatch = useCallback(
    async (writable: Partial<WritablePatch>) => {
      const api = window.canvasWorkspace?.workspaceNodes;
      if (!api?.update) return;
      const base = latestRecordRef.current;
      const optimistic: WorkspaceNodeRecord = {
        ...base,
        ...(writable.title !== undefined ? { title: writable.title } : {}),
        data: writable.data !== undefined
          ? { ...base.data, ...writable.data }
          : base.data,
        properties: writable.properties !== undefined
          ? { ...base.properties, ...writable.properties }
          : base.properties,
        links: writable.links !== undefined ? writable.links : base.links,
      };
      const requestId = ++updateSeqRef.current;
      updatePendingRef.current = true;
      latestRecordRef.current = optimistic;
      setDisplayRecord(optimistic);

      try {
        const result = await api.update(workspaceId, base.id, writable);
        if (requestId !== updateSeqRef.current) return;
        updatePendingRef.current = false;
        if (result.ok && result.node) {
          failedPatchRef.current = null;
          setFailedPatch(null);
          latestRecordRef.current = result.node;
          setDisplayRecord(result.node);
          onPatched?.(result.node);
          return;
        }
        throw new Error(result.error ?? t('workspaceNodes.updateNodeFailed'));
      } catch (error) {
        if (requestId !== updateSeqRef.current) return;
        updatePendingRef.current = false;
        // Keep the optimistic document on screen. Re-reading the stored record
        // here — the previous behaviour — discarded exactly the edit that
        // failed to save, which is the one thing the user cannot retype from
        // the UI. Hold the patch instead and offer an explicit retry.
        //
        // Deliberately NOT rethrown. The canvas's own `onUpdate` never
        // rejects, so every node body is written against a non-rejecting
        // contract and calls it fire-and-forget (TextNodeBody,
        // MindmapNodeBody, IframeNodeBody). Rejecting here reached nobody and
        // surfaced as an unhandled rejection; the banner below IS the report.
        // FileNodeBody keeps reporting its own *file* write failures — a
        // disjoint failure from this *record* write, so neither hides the
        // other.
        void error;
        const pending = mergePatches(failedPatchRef.current, writable);
        failedPatchRef.current = pending;
        setFailedPatch(pending);
      }
    },
    [onPatched, t, workspaceId],
  );

  const handleUpdate = useCallback(
    async (_id: string, patch: Partial<CanvasNode>) => {
      if (readOnly) return;
      const writable: Partial<WritablePatch> = {};
      if (patch.title !== undefined) writable.title = patch.title;
      if (patch.data !== undefined) writable.data = patch.data as Record<string, unknown>;
      if (patch.properties !== undefined) writable.properties = patch.properties;
      if (patch.links !== undefined) writable.links = patch.links;
      if (Object.keys(writable).length === 0) return;
      await commitPatch(writable);
    },
    [commitPatch, readOnly],
  );

  const retryFailedSave = useCallback(async () => {
    const pending = failedPatchRef.current;
    if (!pending) return;
    setRetrying(true);
    await commitPatch(pending);
    setRetrying(false);
  }, [commitPatch]);

  const discardFailedSave = useCallback(async () => {
    const api = window.canvasWorkspace?.workspaceNodes;
    failedPatchRef.current = null;
    setFailedPatch(null);
    const requestId = ++updateSeqRef.current;
    updatePendingRef.current = false;
    const latest = await api?.read(workspaceId, latestRecordRef.current.id).catch(() => null);
    if (!latest?.ok || !latest.node || requestId !== updateSeqRef.current) return;
    latestRecordRef.current = latest.node;
    setDisplayRecord(latest.node);
    onPatched?.(latest.node);
  }, [onPatched, workspaceId]);

  return (
    <div
      ref={containerRef}
      className={`node-canvas-preview node-canvas-preview--${detail.surface}${mindmapPan.isPanning ? ' is-panning' : ''}`}
      style={{ minHeight }}
      tabIndex={detail.backgroundPan ? 0 : undefined}
      role={detail.backgroundPan ? 'region' : undefined}
      aria-label={detail.backgroundPan ? t('workspaceNodes.mindmapPanHint') : undefined}
      onPointerDown={mindmapPan.onPointerDown}
      onPointerMove={mindmapPan.onPointerMove}
      onPointerUp={mindmapPan.onPointerUp}
      onPointerCancel={mindmapPan.onPointerCancel}
      onLostPointerCapture={mindmapPan.onLostPointerCapture}
      onKeyDown={mindmapPan.onKeyDown}
    >
      {detail.surface === 'mindmap' && (
        <div className="node-canvas-preview__mindmap-controls" data-detail-pan-block>
          <Button size="xs" onClick={mindmapPan.center} aria-label={t('workspaceNodes.mindmapCenter')}>
            {t('workspaceNodes.mindmapCenter')}
          </Button>
        </div>
      )}
      {failedPatch && (
        <NodeCanvasSaveError
          retrying={retrying}
          onRetry={() => { void retryFailedSave(); }}
          onDiscard={() => { void discardFailedSave(); }}
        />
      )}
      {previewNode ? (
        <CanvasNodeView
          node={previewNode}
          getAllNodes={getAllNodes}
          workspaceId={workspaceId}
          isDragging={false}
          isResizing={false}
          isSelected={detail.selectEmbeddedNode}
          isHighlighted={false}
          onDragStart={() => undefined}
          onResizeStart={() => undefined}
          onUpdate={handleUpdate}
          onAutoResize={() => undefined}
          onRemove={() => undefined}
          onSelect={() => undefined}
          onFocus={() => undefined}
          readOnly={readOnly}
          embedded
          hideHeader
        />
      ) : (
        <div className="node-detail-panel__empty">{t('workspaceNodes.noTypePreview')}</div>
      )}
    </div>
  );
};
