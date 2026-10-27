import type {
  AgentNodeData,
  CanvasNode,
  FileNodeData,
  GroupNodeData,
  MindmapNodeData,
  TerminalNodeData,
} from '../../../types';
import { cloneMindmapTopic, createNodeData } from '../../../utils/nodeFactory';

/**
 * Data for a copy of `source` (duplicate and paste). The copy keeps what the
 * user made: a web page keeps its URL, a plugin node its payload. Only state
 * tied to one live instance starts fresh: a terminal or agent gets its own
 * session, a note its own file (written by the caller), and a dynamic app
 * stays unbound, because its id names the runner's persisted state.
 */
export const cloneNodeData = (
  source: CanvasNode,
  idMap?: ReadonlyMap<string, string>,
): CanvasNode['data'] => {
  switch (source.type) {
    case 'group': {
      const childIds = idMap
        ? ((source.data as GroupNodeData).childIds ?? [])
          .map(id => idMap.get(id))
          .filter((id): id is string => !!id)
        : [];
      return { ...(source.data as GroupNodeData), childIds };
    }
    case 'file':
      return { ...(source.data as FileNodeData), filePath: '', saved: false, modified: false };
    case 'mindmap': {
      const data = source.data as MindmapNodeData;
      return { ...data, root: cloneMindmapTopic(data.root), rev: 0 } satisfies MindmapNodeData;
    }
    case 'terminal': {
      const data = source.data as TerminalNodeData;
      return { sessionId: '', ...(data.cwd ? { cwd: data.cwd } : {}) } satisfies TerminalNodeData;
    }
    case 'agent': {
      const data = source.data as AgentNodeData;
      return {
        sessionId: '',
        agentType: data.agentType,
        status: 'idle',
        ...(data.cwd ? { cwd: data.cwd } : {}),
        ...(data.agentArgs ? { agentArgs: data.agentArgs } : {}),
        ...(data.dangerousMode ? { dangerousMode: true } : {}),
      } satisfies AgentNodeData;
    }
    case 'dynamic-app':
      return createNodeData(source.type);
    default:
      return structuredClone(source.data);
  }
};
