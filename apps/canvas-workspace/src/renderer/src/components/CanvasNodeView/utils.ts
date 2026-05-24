import type { CSSProperties, MouseEvent } from 'react';
import type { CanvasNode, FrameNodeData, GroupNodeData, TextNodeData } from '../../types';

export function formatRelativeTime(epochMs: number): string {
  const diffSec = Math.floor((Date.now() - epochMs) / 1000);
  if (diffSec < 60) return 'just now';
  const diffMin = Math.floor(diffSec / 60);
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  return `${Math.floor(diffHr / 24)}d ago`;
}

export function isCanvasPanGesture(e: MouseEvent): boolean {
  const handToolActive = e.currentTarget.closest('.canvas-container--hand') != null;
  return e.button === 1 || (e.button === 0 && (e.altKey || handToolActive));
}

export const getTextAutoSize = (node: CanvasNode) => (
  node.type === 'text' && (node.data as TextNodeData).autoSize !== false
);

export const getNodeClasses = ({
  embedded,
  focusState,
  isAgentEdited,
  isDragging,
  isFullscreen,
  isHighlighted,
  isResizing,
  isSelected,
  node,
  readOnly,
  textAutoSize,
}: {
  embedded: boolean;
  focusState: 'focused' | 'context' | 'dimmed' | 'neutral';
  isAgentEdited?: boolean;
  isDragging: boolean;
  isFullscreen: boolean;
  isHighlighted: boolean;
  isResizing: boolean;
  isSelected: boolean;
  node: CanvasNode;
  readOnly: boolean;
  textAutoSize: boolean;
}) => [
  'canvas-node',
  `canvas-node--${node.type}`,
  isDragging && 'canvas-node--dragging',
  isResizing && 'canvas-node--resizing',
  isSelected && 'canvas-node--selected',
  isHighlighted && 'canvas-node--highlighted',
  isAgentEdited && 'canvas-node--agent-edited',
  focusState === 'focused' && 'canvas-node--focus-mode-focused',
  focusState === 'context' && 'canvas-node--focus-mode-context',
  focusState === 'dimmed' && 'canvas-node--focus-mode-dimmed',
  readOnly && 'canvas-node--readonly',
  embedded && 'canvas-node--embedded',
  textAutoSize && 'canvas-node--text-auto',
  isFullscreen && 'canvas-node--fullscreen',
]
  .filter(Boolean)
  .join(' ');

export const getNodeWrapperStyle = (node: CanvasNode): CSSProperties => ({
  transform: `translate(${node.x}px, ${node.y}px)`,
  width: node.width,
  height: node.height,
  ...(node.type === 'frame'
    ? { '--frame-color': (node.data as FrameNodeData).color } as CSSProperties
    : node.type === 'group'
      ? { '--group-color': (node.data as GroupNodeData).color ?? '#A594E0' } as CSSProperties
      : {}),
});

export const sanitizeReferenceSourcePatch = (patch: Partial<CanvasNode>): Partial<CanvasNode> => {
  const { x: _x, y: _y, width: _width, height: _height, ref: _ref, ...rest } = patch;
  return rest;
};
