import type { CanvasNode } from './canvas';

export interface CanvasNodeDefaults {
  title: string;
  width: number;
  height: number;
}

/**
 * Default title and size for each node type. Main (Agent tools) and the
 * renderer (user-created nodes) both read this table, so a node gets the
 * same defaults whoever creates it.
 */
export const CANVAS_NODE_DEFAULTS: Record<CanvasNode['type'], CanvasNodeDefaults> = {
  file: { title: 'Untitled', width: 420, height: 360 },
  terminal: { title: 'Terminal', width: 480, height: 300 },
  frame: { title: 'Frame', width: 720, height: 600 },
  group: { title: 'Group', width: 360, height: 240 },
  agent: { title: 'Coding Agent', width: 520, height: 440 },
  text: { title: 'Text', width: 260, height: 120 },
  iframe: { title: 'Web', width: 520, height: 400 },
  'dynamic-app': { title: 'Dynamic App', width: 520, height: 400 },
  image: { title: 'Image', width: 320, height: 240 },
  shape: { title: 'Shape', width: 200, height: 140 },
  mindmap: { title: 'Mindmap', width: 640, height: 420 },
  reference: { title: 'Reference', width: 420, height: 300 },
  plugin: { title: 'Plugin Node', width: 360, height: 240 },
};

let edgeIdCounter = 0;
export function genEdgeId(): string {
  return `edge-${Date.now()}-${++edgeIdCounter}`;
}

let topicIdCounter = 0;
export function genTopicId(): string {
  return `topic-${Date.now()}-${++topicIdCounter}`;
}
