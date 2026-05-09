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

        <div className="reference-drawer-content">
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
              getAllNodes={() => [referenceNode]}
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
        </div>
    </aside>
  );
};

const ReferenceEmptyState = ({ selectedNode }: { selectedNode?: CanvasNode }) => (
  <div className="reference-empty">
    <div className="reference-empty-icon" aria-hidden="true">
      <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
        <path
          d="M5.2 2.8h7.6a1.4 1.4 0 011.4 1.4v10.6L9 11.8l-5.2 3V4.2a1.4 1.4 0 011.4-1.4z"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinejoin="round"
        />
        <path d="M6.6 6.2h4.8M6.6 8.7h3" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" />
      </svg>
    </div>
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
