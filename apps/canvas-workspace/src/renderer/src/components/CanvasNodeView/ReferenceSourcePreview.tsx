import type { CanvasNode } from '../../types';
import type { CanvasNodeViewProps } from './types';

interface ReferenceSourcePreviewProps {
  CanvasNodeViewComponent: React.ComponentType<CanvasNodeViewProps>;
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
 * The inner node is ALWAYS `embedded`: the reference card owns the header
 * chrome (badge, source label, open-source, close), so the preview must not
 * draw its own close/fullscreen/resize controls. When the source is editable
 * (`onUpdateReferenceSource` provided) the inner node would otherwise render
 * as a normal node and float those controls over the content — duplicating
 * the card's close button and covering the preview. `embedded` hides that
 * chrome via CSS, fills the card, and picks up the reference's selected ring
 * while keeping the body editable.
 */
export const ReferenceSourcePreview = ({
  CanvasNodeViewComponent,
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
    isSelected={isSelected}
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
    embedded
  />
);
