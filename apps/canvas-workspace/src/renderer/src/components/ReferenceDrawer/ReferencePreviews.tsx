import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import type { CanvasNode } from '../../types';
import { CanvasNodeView } from '../CanvasNodeView';
import { IframeNodeBody } from '../IframeNodeBody';
import { MIN_REFERENCE_DRAWER_WIDTH } from './constants';
import type { NodeReferenceEntry, ReferenceEntry, UrlReferenceEntry } from './types';
import { createUrlPreviewNode, getReferenceId, isUrlReference } from './utils';

interface ReferencePreviewPanelProps {
  references: ReferenceEntry[];
  activeReference?: ReferenceEntry;
  activeReferenceNode?: CanvasNode;
  copyUrl: (url: string) => void;
  drawerWidth: number;
  onAddReferenceToCanvas: (entry: NodeReferenceEntry) => void;
  onClearAll: () => void;
  onFocusNode: (workspaceId: string, nodeId: string) => void;
  onOpenUrl: (url: string) => void;
  onRemoveReference: (referenceId: string) => void;
  workspaceNameById: Map<string, string>;
}

const HIDDEN_STYLE: CSSProperties = { display: 'none' };

export const ReferencePreviewPanel = ({
  references,
  activeReference,
  activeReferenceNode,
  copyUrl,
  drawerWidth,
  onAddReferenceToCanvas,
  onClearAll,
  onFocusNode,
  onOpenUrl,
  onRemoveReference,
  workspaceNameById,
}: ReferencePreviewPanelProps) => {
  const urlReferences = useMemo(
    () => references.filter(isUrlReference),
    [references],
  );

  // Track which URL references have been opened at least once. Their iframes
  // stay mounted (just hidden) when the user switches away, so they don't
  // reload on the next visit. An entry is removed only when the reference
  // itself disappears from `references` (Unpin / Clear all / delete).
  const [mountedUrlIds, setMountedUrlIds] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (activeReference && isUrlReference(activeReference)) {
      const id = activeReference.id;
      setMountedUrlIds((prev) => {
        if (prev.has(id)) return prev;
        const next = new Set(prev);
        next.add(id);
        return next;
      });
    }
  }, [activeReference]);

  useEffect(() => {
    setMountedUrlIds((prev) => {
      if (prev.size === 0) return prev;
      const liveIds = new Set(urlReferences.map((ref) => ref.id));
      let changed = false;
      const next = new Set<string>();
      prev.forEach((id) => {
        if (liveIds.has(id)) next.add(id);
        else changed = true;
      });
      return changed ? next : prev;
    });
  }, [urlReferences]);

  const activeIsUrl = !!(activeReference && isUrlReference(activeReference));
  const activeUrlReference = activeIsUrl ? (activeReference as UrlReferenceEntry) : undefined;
  const activeReferenceId = activeReference ? getReferenceId(activeReference) : undefined;

  const persistentUrlPreviews = urlReferences.filter((ref) => mountedUrlIds.has(ref.id));

  return (
    <>
      {persistentUrlPreviews.length > 0 && (
        <div
          className="reference-url-card reference-url-card--preview"
          style={activeIsUrl ? undefined : HIDDEN_STYLE}
        >
          {persistentUrlPreviews.map((ref) => (
            <ReferenceUrlWebPreview
              key={ref.id}
              reference={ref}
              drawerWidth={drawerWidth}
              hidden={ref.id !== activeReferenceId}
            />
          ))}
          {activeUrlReference && (
            <div className="reference-card-footer">
              <button
                className="reference-drawer-secondary"
                type="button"
                onClick={() => onOpenUrl(activeUrlReference.url)}
              >
                Open
              </button>
              <button
                className="reference-drawer-secondary"
                type="button"
                onClick={() => copyUrl(activeUrlReference.url)}
              >
                Copy URL
              </button>
              <button
                className="reference-drawer-secondary"
                type="button"
                onClick={() => onRemoveReference(activeUrlReference.id)}
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
          )}
        </div>
      )}

      {activeReference && !isUrlReference(activeReference) && activeReferenceNode && (
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
      )}

      {activeReference && !isUrlReference(activeReference) && !activeReferenceNode && (
        <div className="reference-pick-hint">Source node is not loaded or no longer exists.</div>
      )}

      {!activeReference && (
        <div className="reference-pick-hint">Pick a reference above to preview it here.</div>
      )}
    </>
  );
};

interface ReferenceUrlWebPreviewProps {
  reference: UrlReferenceEntry;
  drawerWidth: number;
  hidden?: boolean;
}

const ReferenceUrlWebPreview = memo(({ reference, drawerWidth, hidden }: ReferenceUrlWebPreviewProps) => {
  const previewNode = useMemo(
    () => createUrlPreviewNode(reference, drawerWidth),
    [reference, drawerWidth],
  );

  return (
    <div
      className="reference-url-preview"
      style={hidden ? HIDDEN_STYLE : undefined}
    >
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

const ReferenceNativeNodePreview = memo(({
  node,
  drawerWidth,
  workspaceName,
  onFocusNode,
}: ReferenceNativeNodePreviewProps) => {
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
