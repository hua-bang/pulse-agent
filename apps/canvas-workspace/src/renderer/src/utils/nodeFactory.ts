import type { CanvasNode, FileNodeData, TerminalNodeData, FrameNodeData, GroupNodeData, AgentNodeData, TextNodeData, IframeNodeData, ImageNodeData, ShapeNodeData, MindmapNodeData, MindmapTopic, ReferenceNodeData, DynamicAppNodeData, PluginNodeData } from '../types';
import {
  MOCK_CARD_DEFAULT_PAYLOAD,
  MOCK_CARD_NODE_TYPE,
  MOCK_NODE_PLUGIN_ID,
  MOCK_TODO_LIST_DEFAULT_PAYLOAD,
  MOCK_TODO_LIST_NODE_TYPE,
} from '../../../plugins/mock-node/constants';

let nodeIdCounter = 0;
export const genId = (): string => `node-${Date.now()}-${++nodeIdCounter}`;

let topicIdCounter = 0;
export const genTopicId = (): string => `topic-${Date.now()}-${++topicIdCounter}`;

export type CreatableCanvasNodeType = Extract<
  CanvasNode['type'],
  'file' | 'terminal' | 'frame' | 'group' | 'agent' | 'text' | 'iframe' | 'mindmap' | 'plugin'
>;

const NODE_DEFAULTS: Record<CanvasNode['type'], { title: string; width: number; height: number }> = {
  file:     { title: 'Untitled', width: 420, height: 360 },
  terminal: { title: 'Terminal', width: 480, height: 300 },
  frame:    { title: 'Frame',    width: 600, height: 400 },
  group:    { title: 'Group',    width: 360, height: 240 },
  agent:    { title: 'Coding Agent', width: 520, height: 440 },
  text:     { title: 'Text',     width: 260, height: 120 },
  iframe:   { title: 'Web',      width: 520, height: 400 },
  'dynamic-app': { title: 'Dynamic App', width: 520, height: 400 },
  image:    { title: 'Image',    width: 320, height: 240 },
  shape:    { title: 'Shape',    width: 200, height: 140 },
  mindmap:  { title: 'Mindmap',  width: 640, height: 420 },
  reference: { title: 'Reference', width: 420, height: 300 },
  plugin:   { title: 'Plugin Node', width: 360, height: 240 },
};

/** Default width/height for a node type — single source of truth so
 *  callers that need to center a new node on the viewport derive the
 *  offset from the same numbers `createDefaultNode` will assign. */
export const getNodeDefaultSize = (
  type: CanvasNode['type'],
): { width: number; height: number } => {
  const def = NODE_DEFAULTS[type];
  return { width: def.width, height: def.height };
};

/** Human-readable type names used for toast feedback after adding a
 *  node. Kept aligned with the FloatingToolbar button labels so the
 *  user sees the same word in the toolbar tooltip and in the toast. */
export const NODE_TYPE_LABELS: Record<CanvasNode['type'], string> = {
  file:     'Note',
  terminal: 'Terminal',
  frame:    'Frame',
  group:    'Group',
  agent:    'Coding agent',
  text:     'Text',
  iframe:   'Web page',
  'dynamic-app': 'Dynamic app',
  image:    'Image',
  shape:    'Shape',
  mindmap:  'Mindmap',
  reference: 'Reference',
  plugin:   'Plugin node',
};

export const createNodeData = (type: CanvasNode['type']): FileNodeData | TerminalNodeData | FrameNodeData | GroupNodeData | AgentNodeData | TextNodeData | IframeNodeData | ImageNodeData | ShapeNodeData | MindmapNodeData | ReferenceNodeData | DynamicAppNodeData | PluginNodeData => {
  switch (type) {
    case 'file':     return { filePath: '', content: '', saved: false, modified: false };
    case 'terminal': return { sessionId: '' };
    case 'frame':    return { color: '#9575d4' };
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
  const def = NODE_DEFAULTS[type];
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
