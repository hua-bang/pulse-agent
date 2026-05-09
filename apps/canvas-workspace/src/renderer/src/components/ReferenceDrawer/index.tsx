import './index.css';
import type { CanvasNode } from '../../types';
import { CanvasNodeView } from '../CanvasNodeView';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';

interface ReferenceDrawerProps {
  open: boolean;
  referenceNode?: CanvasNode;
  selectedNode?: CanvasNode;
  onOpenChange: (open: boolean) => void;
  onPinSelected: () => void;
  onClear: () => void;
  onFocusNode: (nodeId: string) => void;
}

export const ReferenceDrawer = ({
  open,
  referenceNode,
  selectedNode,
  onOpenChange,
  onPinSelected,
  onClear,
  onFocusNode,
}: ReferenceDrawerProps) => {
  const canPinSelected = Boolean(selectedNode);
  const selectedIsReference = Boolean(
    selectedNode && referenceNode && selectedNode.id === referenceNode.id,
  );

  if (!open) return null;

  return (
    <aside className="reference-drawer reference-drawer--open">
        <header className="reference-drawer-header">
          <div>
            <div className="reference-drawer-kicker">Pinned context</div>
            <h2>Reference</h2>
          </div>
          <button
            className="reference-drawer-icon-button"
            type="button"
            onClick={() => onOpenChange(false)}
            title="Close reference drawer"
            aria-label="Close reference drawer"
          >
            ×
          </button>
        </header>

        <div className="reference-drawer-actions">
          <button
            className="reference-drawer-primary"
            type="button"
            onClick={onPinSelected}
            disabled={!canPinSelected || selectedIsReference}
          >
            {referenceNode ? 'Replace with selected' : 'Pin selected node'}
          </button>
          {referenceNode && (
            <button className="reference-drawer-secondary" type="button" onClick={onClear}>
              Clear
            </button>
          )}
        </div>

        {!referenceNode ? (
          <ReferenceEmptyState selectedNode={selectedNode} />
        ) : (
          <div className="reference-native-card">
            <CanvasNodeView
              node={{ ...referenceNode, x: 0, y: 0, width: 300, height: 520 }}
              allNodes={[referenceNode]}
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
              onFocus={() => onFocusNode(referenceNode.id)}
              readOnly
            />
            <div className="reference-card-footer">
              <button
                className="reference-drawer-secondary"
                type="button"
                onClick={() => onFocusNode(referenceNode.id)}
              >
                Focus on canvas
              </button>
            </div>
          </div>
        )}
    </aside>
  );
};

const ReferenceEmptyState = ({ selectedNode }: { selectedNode?: CanvasNode }) => (
  <div className="reference-empty">
    <div className="reference-empty-icon">⌑</div>
    <h3>No reference pinned</h3>
    <p>Select one node on the canvas, then pin it here as stable context while you work elsewhere.</p>
    {selectedNode ? (
      <div className="reference-selected-hint">
        <span>Selected</span>
        <strong>{getNodeDisplayLabel(selectedNode)}</strong>
      </div>
    ) : (
      <div className="reference-selected-hint reference-selected-hint--muted">
        Select a single node to enable pinning.
      </div>
    )}
  </div>
);
