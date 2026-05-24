import { memo, useCallback, useMemo } from 'react';
import type { CanvasNode } from '../../types';
import { CanvasNodeView } from '../CanvasNodeView';
import { IframeNodeBody } from '../IframeNodeBody';
import { MIN_REFERENCE_DRAWER_WIDTH } from './constants';
import type { NodeReferenceEntry, ReferenceEntry, UrlReferenceEntry } from './types';
import { createUrlPreviewNode, getReferenceId, isUrlReference } from './utils';

interface ReferencePreviewPanelProps {
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

export const ReferencePreviewPanel = ({
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
  if (activeReference && isUrlReference(activeReference)) {
    return (
      <div className="reference-url-card reference-url-card--preview">
        <ReferenceUrlWebPreview reference={activeReference} drawerWidth={drawerWidth} />
        <div className="reference-card-footer">
          <button
            className="reference-drawer-secondary"
            type="button"
            onClick={() => onOpenUrl(activeReference.url)}
          >
            Open
          </button>
          <button
            className="reference-drawer-secondary"
            type="button"
            onClick={() => copyUrl(activeReference.url)}
          >
            Copy URL
          </button>
          <button
            className="reference-drawer-secondary"
            type="button"
            onClick={() => onRemoveReference(activeReference.id)}
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
    );
  }

  if (activeReference && !isUrlReference(activeReference) && activeReferenceNode) {
    return (
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
    );
  }

  if (activeReference && !isUrlReference(activeReference)) {
    return <div className="reference-pick-hint">Source node is not loaded or no longer exists.</div>;
  }

  return <div className="reference-pick-hint">Pick a reference above to preview it here.</div>;
};

interface ReferenceUrlWebPreviewProps {
  reference: UrlReferenceEntry;
  drawerWidth: number;
}

const ReferenceUrlWebPreview = memo(({ reference, drawerWidth }: ReferenceUrlWebPreviewProps) => {
  const previewNode = useMemo(
    () => createUrlPreviewNode(reference, drawerWidth),
    [reference, drawerWidth],
  );

  return (
    <div className="reference-url-preview">
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
