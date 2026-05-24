import { useState, type CSSProperties, type MouseEvent } from 'react';
import type { CanvasNode } from '../../types';
import { MindmapNodeBody } from '../MindmapNodeBody';
import { NodeContextMenu } from '../NodeContextMenu';
import { CloseButton, FullscreenButton } from './NodeButtons';

interface MindmapCanvasNodeProps {
  classes: string;
  handleClose: (e: MouseEvent) => void;
  handleNodeClick: (e: MouseEvent) => void;
  handleToggleFullscreen: (e: MouseEvent) => void;
  isDragging: boolean;
  isFullscreen: boolean;
  isSelected: boolean;
  node: CanvasNode;
  onAutoResize: (id: string, width: number, height: number) => void;
  onDragStart: (e: MouseEvent, node: CanvasNode) => void;
  onExportMindmapImage: (id: string) => void;
  onSelect: (id: string, mods?: { shift?: boolean; meta?: boolean }) => void;
  onUpdate: (id: string, patch: Partial<CanvasNode>) => void;
  readOnly: boolean;
  supportsFullscreen: boolean;
  wrapperStyle: CSSProperties;
}

export const MindmapCanvasNode = ({
  classes,
  handleClose,
  handleNodeClick,
  handleToggleFullscreen,
  isDragging,
  isFullscreen,
  isSelected,
  node,
  onAutoResize,
  onDragStart,
  onExportMindmapImage,
  onSelect,
  onUpdate,
  readOnly,
  supportsFullscreen,
  wrapperStyle,
}: MindmapCanvasNodeProps) => {
  const [mindmapMenu, setMindmapMenu] = useState<{ x: number; y: number } | null>(null);

  return (
    <div
      className={classes}
      style={wrapperStyle}
      onClick={handleNodeClick}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        if (readOnly) return;
        onSelect(node.id);
        setMindmapMenu({ x: e.clientX, y: e.clientY });
      }}
      onMouseDown={(e) => {
        if (readOnly || isFullscreen) return;
        const hasMods = e.shiftKey || e.metaKey || e.ctrlKey;
        if (!isSelected && !hasMods) onSelect(node.id);
        onDragStart(e, node);
      }}
    >
      <div className="node-body node-body--mindmap">
        <MindmapNodeBody
          node={node}
          isSelected={isSelected}
          isOuterDragging={isDragging}
          onUpdate={onUpdate}
          onSelectNode={onSelect}
          onAutoResize={onAutoResize}
          readOnly={readOnly}
        />
      </div>
      {supportsFullscreen ? (
        <FullscreenButton floating isFullscreen={isFullscreen} onClick={handleToggleFullscreen} />
      ) : null}
      {readOnly ? null : <CloseButton floating onClick={handleClose} />}
      {mindmapMenu && (
        <NodeContextMenu
          x={mindmapMenu.x}
          y={mindmapMenu.y}
          mode="mindmap"
          onClose={() => setMindmapMenu(null)}
          onExportImage={() => {
            setMindmapMenu(null);
            onExportMindmapImage(node.id);
          }}
        />
      )}
    </div>
  );
};
