import type { CanvasNode } from '../../types';
import type { CanvasNodeViewProps } from './types';

interface ReferenceSourcePreviewProps {
  CanvasNodeViewComponent: React.ComponentType<CanvasNodeViewProps>;
  embedded: boolean;
  handleReferenceSourceUpdate: (sourceId: string, patch: Partial<CanvasNode>) => void;
  isSelected: boolean;
  node: CanvasNode;
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onUpdateReferenceSource?: (referenceNode: CanvasNode, patch: Partial<CanvasNode>) => void;
  readOnly: boolean;
  rootFolder?: string;
  sourceNode: CanvasNode;
  workspaceId?: string;
  workspaceLabel: string;
}

/**
 * Renders the referenced node as a preview inside the reference card.
 *
 * The inner node is intentionally NOT forced `embedded`: it keeps its own
 * transform-based stacking context, which the `.reference-drag-overlay`
 * depends on to stay above the preview and intercept the drag mousedown.
 * Forcing `embedded` sets `transform: none`, dropping that context — webview /
 * iframe content then composites above the overlay and the card can no longer
 * be dragged.
 *
 * The reference card owns the header chrome (badge, source label, open-source,
 * close), so the preview's own close / fullscreen / resize controls are
 * suppressed via CSS (`.node-body--reference …` in index.css) instead —
 * otherwise an editable source floats those controls over the content and
 * duplicates the card's close button.
 */
export const ReferenceSourcePreview = ({
  CanvasNodeViewComponent,
  embedded,
  handleReferenceSourceUpdate,
  isSelected,
  node,
  onSelect,
  onUpdateReferenceSource,
  readOnly,
  rootFolder,
  sourceNode,
  workspaceId,
  workspaceLabel,
}: ReferenceSourcePreviewProps) => (
  <CanvasNodeViewComponent
    node={{
      ...sourceNode,
      x: 0,
      y: 0,
      width: Math.max(120, node.width - 18),
      height: Math.max(80, node.height - 70),
    }}
    getAllNodes={() => [sourceNode]}
    rootFolder={rootFolder}
    workspaceId={node.ref?.kind === 'workspace-node' ? node.ref.workspaceId : workspaceId}
    workspaceName={workspaceLabel}
    isDragging={false}
    isResizing={false}
    // The outer reference card owns selection and drag affordances. Treat the
    // inner preview as unselected content so iframe/webview selection chrome
    // does not enable hover-time pointer behavior inside the embedded page.
    isSelected={false}
    isHighlighted={false}
    onDragStart={() => undefined}
    onResizeStart={() => undefined}
    onUpdate={handleReferenceSourceUpdate}
    onAutoResize={() => undefined}
    onRemove={() => undefined}
    onExportMindmapImage={() => undefined}
    onSelect={() => onSelect(node.id)}
    onFocus={() => undefined}
    readOnly={readOnly || !onUpdateReferenceSource}
    embedded={embedded}
  />
);
