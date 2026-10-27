import type { CanvasNode } from '../../../types';
import { collectContainerDescendants, isContainerNode } from '../../../utils/frameHierarchy';

export type AlignMode =
  | 'left'
  | 'centerX'
  | 'right'
  | 'top'
  | 'middle'
  | 'bottom'
  | 'distributeX'
  | 'distributeY';

export const ALIGN_MODES: readonly AlignMode[] = [
  'left', 'centerX', 'right', 'top', 'middle', 'bottom', 'distributeX', 'distributeY',
];

type Move = { id: string; x: number; y: number };

/** Align needs two nodes; distribute needs three, because the outer two stay put. */
export const canAlign = (mode: AlignMode, count: number): boolean =>
  count >= (mode === 'distributeX' || mode === 'distributeY' ? 3 : 2);

const distribute = (selected: CanvasNode[], axis: 'x' | 'y'): Map<string, number> => {
  const size = axis === 'x' ? 'width' : 'height';
  const sorted = [...selected].sort((a, b) => a[axis] - b[axis]);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const used = sorted.reduce((sum, node) => sum + node[size], 0);
  const gap = (last[axis] + last[size] - first[axis] - used) / (sorted.length - 1);
  const positions = new Map<string, number>();
  let cursor = first[axis];
  for (const node of sorted) {
    positions.set(node.id, cursor);
    cursor += node[size] + gap;
  }
  return positions;
};

const target = (node: CanvasNode, mode: AlignMode, selected: CanvasNode[]): { x: number; y: number } => {
  const minX = Math.min(...selected.map((n) => n.x));
  const maxX = Math.max(...selected.map((n) => n.x + n.width));
  const minY = Math.min(...selected.map((n) => n.y));
  const maxY = Math.max(...selected.map((n) => n.y + n.height));
  switch (mode) {
    case 'left': return { x: minX, y: node.y };
    case 'centerX': return { x: (minX + maxX - node.width) / 2, y: node.y };
    case 'right': return { x: maxX - node.width, y: node.y };
    case 'top': return { x: node.x, y: minY };
    case 'middle': return { x: node.x, y: (minY + maxY - node.height) / 2 };
    case 'bottom': return { x: node.x, y: maxY - node.height };
    default: return { x: node.x, y: node.y };
  }
};

/**
 * Moves that align or distribute the selected nodes against their shared
 * bounds. A selected frame or group carries its contents along. Nodes
 * already in place produce no move.
 */
export const alignNodeMoves = (
  nodes: CanvasNode[],
  selectedIds: readonly string[],
  mode: AlignMode,
): Move[] => {
  const ids = new Set(selectedIds);
  const selected = nodes.filter((node) => ids.has(node.id));
  if (!canAlign(mode, selected.length)) return [];

  const spread = mode === 'distributeX' ? distribute(selected, 'x')
    : mode === 'distributeY' ? distribute(selected, 'y')
      : null;
  const moves = new Map<string, Move>();
  for (const node of selected) {
    const next = spread
      ? {
        x: mode === 'distributeX' ? spread.get(node.id)! : node.x,
        y: mode === 'distributeY' ? spread.get(node.id)! : node.y,
      }
      : target(node, mode, selected);
    const dx = next.x - node.x;
    const dy = next.y - node.y;
    if (dx === 0 && dy === 0) continue;
    moves.set(node.id, { id: node.id, ...next });
    if (!isContainerNode(node)) continue;
    for (const child of collectContainerDescendants(node.id, nodes)) {
      if (ids.has(child.id) || moves.has(child.id)) continue;
      moves.set(child.id, { id: child.id, x: child.x + dx, y: child.y + dy });
    }
  }
  return [...moves.values()];
};
