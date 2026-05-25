import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CanvasNode, WorkspaceNodeRecord } from '../../types';
import { CanvasNodeView } from '../CanvasNodeView';
import { isKnowledgeNodeType } from './utils';
import { useI18n } from '../../i18n';

interface NodeCanvasPreviewProps {
  workspaceId: string;
  record: WorkspaceNodeRecord;
  /** Fallback height when ResizeObserver hasn't measured yet. */
  minHeight?: number;
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
  readOnly = false,
  onPatched,
}: NodeCanvasPreviewProps) => {
  const { t } = useI18n();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState({ width: 320, height: minHeight });

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
    if (!isKnowledgeNodeType(record.type)) return null;
    return {
      id: record.id,
      type: record.type as CanvasNode['type'],
      title: record.title ?? '',
      x: 0,
      y: 0,
      width: size.width,
      height: size.height,
      data: (record.data ?? {}) as CanvasNode['data'],
      properties: record.properties,
      links: record.links,
      updatedAt: record.updatedAt,
    } satisfies CanvasNode;
  }, [record, size.width, size.height]);

  const getAllNodes = useCallback(() => (previewNode ? [previewNode] : []), [previewNode]);

  const handleUpdate = useCallback(
    async (_id: string, patch: Partial<CanvasNode>) => {
      if (readOnly) return;
      const api = window.canvasWorkspace?.workspaceNodes;
      if (!api?.update) return;
      const writable: Partial<WorkspaceNodeRecord> = {};
      if (patch.title !== undefined) writable.title = patch.title;
      if (patch.data !== undefined) writable.data = patch.data as Record<string, unknown>;
      if (patch.properties !== undefined) writable.properties = patch.properties;
      if (patch.links !== undefined) writable.links = patch.links;
      if (Object.keys(writable).length === 0) return;
      const result = await api.update(workspaceId, record.id, writable);
      if (result.ok && result.node) onPatched?.(result.node);
    },
    [readOnly, workspaceId, record.id, onPatched],
  );

  return (
    <div ref={containerRef} className="node-canvas-preview" style={{ minHeight }}>
      {previewNode ? (
        <CanvasNodeView
          node={previewNode}
          getAllNodes={getAllNodes}
          workspaceId={workspaceId}
          isDragging={false}
          isResizing={false}
          isSelected={false}
          isHighlighted={false}
          onDragStart={() => undefined}
          onResizeStart={() => undefined}
          onUpdate={handleUpdate}
          onAutoResize={() => undefined}
          onRemove={() => undefined}
          onExportMindmapImage={() => undefined}
          onSelect={() => undefined}
          onFocus={() => undefined}
          readOnly={readOnly}
          embedded
        />
      ) : (
        <div className="node-detail-panel__empty">{t('workspaceNodes.noTypePreview')}</div>
      )}
    </div>
  );
};
