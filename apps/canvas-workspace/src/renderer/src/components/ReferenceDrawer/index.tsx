import { useCallback, useEffect, useMemo, useState } from 'react';
import './index.css';
import type { CanvasNode } from '../../types';
import { CanvasNodeView } from '../CanvasNodeView';
import { getNodeDisplayLabel } from '../../utils/nodeLabel';

const DEFAULT_REFERENCE_DRAWER_WIDTH = 420;
const MIN_REFERENCE_DRAWER_WIDTH = 320;
const MAX_REFERENCE_DRAWER_WIDTH = 720;

interface ReferenceDrawerProps {
  open: boolean;
  referenceNode?: CanvasNode;
  selectedNode?: CanvasNode;
  onOpenChange: (open: boolean) => void;
  onClear: () => void;
  onFocusNode: (nodeId: string) => void;
}

export const ReferenceDrawer = ({
  open,
  referenceNode,
  selectedNode,
  onOpenChange,
  onClear,
  onFocusNode,
}: ReferenceDrawerProps) => {
  const [drawerWidth, setDrawerWidth] = useState(DEFAULT_REFERENCE_DRAWER_WIDTH);
  const [isResizing, setIsResizing] = useState(false);
  const [shouldRender, setShouldRender] = useState(open);
  const [isActive, setIsActive] = useState(open);

  useEffect(() => {
    if (open) {
      setShouldRender(true);
      const frame = window.requestAnimationFrame(() => setIsActive(true));
      return () => window.cancelAnimationFrame(frame);
    }

    setIsActive(false);
    const timer = window.setTimeout(() => setShouldRender(false), 240);
    return () => window.clearTimeout(timer);
  }, [open]);

  const drawerStyle = useMemo(
    () => ({
      '--reference-drawer-width': `${drawerWidth}px`,
    }) as React.CSSProperties,
    [drawerWidth],
  );

  const handleResizeStart = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.stopPropagation();

    const startX = e.clientX;
    const startWidth = drawerWidth;
    setIsResizing(true);

    const handleMouseMove = (event: MouseEvent) => {
      const nextWidth = startWidth + event.clientX - startX;
      setDrawerWidth(Math.min(MAX_REFERENCE_DRAWER_WIDTH, Math.max(MIN_REFERENCE_DRAWER_WIDTH, nextWidth)));
    };

    const handleMouseUp = () => {
      setIsResizing(false);
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [drawerWidth]);

  if (!shouldRender) return null;

  return (
    <aside
      className={`reference-drawer${isActive ? ' reference-drawer--open' : ''}${isResizing ? ' reference-drawer--resizing' : ''}`}
      style={drawerStyle}
      aria-hidden={!isActive}
    >
      <div
        className="reference-drawer-resize-handle"
        onMouseDown={handleResizeStart}
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize reference drawer"
        title="Drag to resize"
      />
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

        {!referenceNode ? (
          <ReferenceEmptyState selectedNode={selectedNode} />
        ) : (
          <div className="reference-native-card">
            <CanvasNodeView
              node={{
                ...referenceNode,
                x: 0,
                y: 0,
                width: Math.max(MIN_REFERENCE_DRAWER_WIDTH - 32, drawerWidth - 32),
                height: 520,
              }}
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
                title="Focus on canvas"
              >
                Focus
              </button>
              <button className="reference-drawer-secondary" type="button" onClick={onClear}>
                Clear
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
    <p>Select a node, then use its Reference action to pin it here.</p>
    {selectedNode ? (
      <div className="reference-selected-hint">
        <span>Selected</span>
        <strong>{getNodeDisplayLabel(selectedNode)}</strong>
      </div>
    ) : (
      <div className="reference-selected-hint reference-selected-hint--muted">
        Select a single node to enable reference.
      </div>
    )}
  </div>
);
