import type { CanvasNode, NodeType } from '../types';

export const DEFAULT_DIMENSIONS: Record<NodeType, { title: string; width: number; height: number }> = {
  file: { title: 'Untitled', width: 420, height: 360 },
  terminal: { title: 'Terminal', width: 480, height: 300 },
  frame: { title: 'Frame', width: 600, height: 400 },
  group: { title: 'Group', width: 360, height: 240 },
  agent: { title: 'Agent', width: 520, height: 440 },
  text: { title: 'Text', width: 260, height: 120 },
  iframe: { title: 'Web', width: 520, height: 400 },
  image: { title: 'Image', width: 480, height: 360 },
  shape: { title: 'Shape', width: 200, height: 140 },
  mindmap: { title: 'Mindmap', width: 640, height: 420 },
  plugin: { title: 'Plugin Node', width: 360, height: 240 },
};

export function autoPlace(nodes: CanvasNode[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 100, y: 100 };
  let maxRight = 0;
  let bestY = 100;
  for (const n of nodes) {
    const right = n.x + n.width;
    if (right > maxRight) {
      maxRight = right;
      bestY = n.y;
    }
  }
  return { x: maxRight + 40, y: bestY };
}

/** Prompts shorter than this are passed directly as CLI args; longer ones go to a file. */
export const INLINE_PROMPT_THRESHOLD = 256;
