import type { CanvasNode, CanvasNodeType, FileNodeData, TerminalNodeData, FrameNodeData, AgentNodeData } from '../types';

let nodeIdCounter = 0;
export const genId = (): string => `node-${Date.now()}-${++nodeIdCounter}`;

const NODE_DEFAULTS: Record<CanvasNodeType, { title: string; width: number; height: number }> = {
  file:     { title: 'Untitled', width: 420, height: 360 },
  terminal: { title: 'Terminal', width: 480, height: 300 },
  frame:    { title: 'Frame',    width: 600, height: 400 },
  agent:    { title: 'Agent',    width: 500, height: 450 },
};

export const createNodeData = (type: CanvasNodeType): FileNodeData | TerminalNodeData | FrameNodeData | AgentNodeData => {
  switch (type) {
    case 'file':     return { filePath: '', content: '', saved: false, modified: false };
    case 'terminal': return { sessionId: '' };
    case 'frame':    return { color: '#9065b0' };
    case 'agent':    return {
      teammateId: '',
      teamId: '',
      name: '',
      role: '',
      runtime: 'pulse-agent',
      mode: 'pty',
      isLead: false,
      status: 'idle',
    };
  }
};

export const createDefaultNode = (type: CanvasNodeType, x: number, y: number): CanvasNode => {
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
