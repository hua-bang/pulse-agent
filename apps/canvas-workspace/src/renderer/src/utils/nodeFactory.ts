import type { CanvasNode, FileNodeData, TerminalNodeData, FrameNodeData, GroupNodeData, AgentNodeData, TextNodeData, IframeNodeData, ImageNodeData, ShapeNodeData, MindmapNodeData, MindmapTopic, ReferenceNodeData, DynamicAppNodeData, PluginNodeData } from '../types';
import {
  MOCK_CARD_DEFAULT_PAYLOAD,
  MOCK_CARD_NODE_TYPE,
  MOCK_NODE_PLUGIN_ID,
  MOCK_TODO_LIST_DEFAULT_PAYLOAD,
  MOCK_TODO_LIST_NODE_TYPE,
} from '../../../plugins/mock-node/constants';
import { CANVAS_NODE_DEFAULTS, genTopicId } from '../../../shared/canvas-node-defaults';

let nodeIdCounter = 0;
export const genId = (): string => `node-${Date.now()}-${++nodeIdCounter}`;

export type CreatableCanvasNodeType = Extract<
  CanvasNode['type'],
  'file' | 'terminal' | 'frame' | 'group' | 'agent' | 'text' | 'iframe' | 'mindmap' | 'plugin'
>;

/** Default width/height for a node type — single source of truth so
 *  callers that need to center a new node on the viewport derive the
 *  offset from the same numbers `createDefaultNode` will assign. */
export const getNodeDefaultSize = (
  type: CanvasNode['type'],
): { width: number; height: number } => {
  const def = CANVAS_NODE_DEFAULTS[type];
  return { width: def.width, height: def.height };
};

export const createNodeData = (type: CanvasNode['type']): FileNodeData | TerminalNodeData | FrameNodeData | GroupNodeData | AgentNodeData | TextNodeData | IframeNodeData | ImageNodeData | ShapeNodeData | MindmapNodeData | ReferenceNodeData | DynamicAppNodeData | PluginNodeData => {
  switch (type) {
    case 'file':     return { filePath: '', content: '', saved: false, modified: false };
    case 'terminal': return { sessionId: '' };
    // Neutral graphite default — color is a deliberate accent, picked in the
    // frame's swatch menu; a board where every frame ships colored reads as
    // a rainbow dashboard (the anti-goal of the Heptabase alignment).
    case 'frame':    return { color: 'oklch(0.68 0.006 265)' };
    case 'group':    return { color: '#A594E0', childIds: [] };
    case 'agent':    return { sessionId: '', agentType: 'claude-code', status: 'idle' };
    case 'text':     return { content: '', textColor: '#1f2328', backgroundColor: 'transparent', fontSize: 18, autoSize: true };
    case 'iframe':   return { url: '', html: '', mode: 'url', prompt: '' };
    // Dynamic-app nodes are exclusively materialised by `dynamic_app_create`,
    // which fills `url` / `dynamicAppId` from the runner. Creating an empty
    // shell from the user-facing factory would be invalid (would never bind
    // to a runner), so we hand back a sentinel that the body component
    // recognises and shows an "uninitialized" placeholder for.
    case 'dynamic-app': return { url: '', dynamicAppId: '' };
    case 'image':    return { filePath: '' };
    case 'shape':    return { kind: 'rect', fill: '#E8EEF7', stroke: '#5B7CBF', strokeWidth: 2 };
    case 'reference': return {};
    case 'plugin': return {
      pluginId: MOCK_NODE_PLUGIN_ID,
      nodeType: MOCK_CARD_NODE_TYPE,
      payload: { ...MOCK_CARD_DEFAULT_PAYLOAD },
    };
    case 'mindmap':  return {
      root: {
        id: genTopicId(),
        text: 'Central topic',
        children: [
          { id: genTopicId(), text: 'Idea 1', children: [] },
          { id: genTopicId(), text: 'Idea 2', children: [] },
          { id: genTopicId(), text: 'Idea 3', children: [] },
        ],
      },
      layout: 'right',
      rev: 0,
    };
  }
};

const cloneTodoListPayload = (): {
  title: string;
  items: Array<{ id: string; text: string; done: boolean }>;
} => ({
  title: MOCK_TODO_LIST_DEFAULT_PAYLOAD.title,
  items: MOCK_TODO_LIST_DEFAULT_PAYLOAD.items.map((item) => ({ ...item })),
});

export const createTodoListPluginNodePatch = (): Partial<CanvasNode> => ({
  title: MOCK_TODO_LIST_DEFAULT_PAYLOAD.title,
  width: 380,
  height: 320,
  data: {
    pluginId: MOCK_NODE_PLUGIN_ID,
    nodeType: MOCK_TODO_LIST_NODE_TYPE,
    payload: cloneTodoListPayload(),
  },
});

/**
 * Deep-clone a mindmap topic tree, minting fresh ids so the result can
 * coexist with the source (duplicate / paste flows). `text`, `color`,
 * and `collapsed` are copied verbatim.
 */
export const cloneMindmapTopic = (topic: MindmapTopic): MindmapTopic => ({
  id: genTopicId(),
  text: topic.text,
  color: topic.color,
  collapsed: topic.collapsed,
  children: topic.children.map(cloneMindmapTopic),
});

export const createDefaultNode = (type: CanvasNode['type'], x: number, y: number): CanvasNode => {
  const def = CANVAS_NODE_DEFAULTS[type];
  return {
    id: genId(),
    type,
    title: def.title,
    x,
    y,
    width: def.width,
    height: def.height,
    data: createNodeData(type),
  };
};
