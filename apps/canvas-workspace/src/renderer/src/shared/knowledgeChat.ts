import type {
  AgentContextCanvasRef,
  AgentContextNodeRef,
  AgentContextTagRef,
} from '../types';

export interface KnowledgeChatExplicitContext {
  nodes: AgentContextNodeRef[];
  tags?: AgentContextTagRef[];
  canvases?: AgentContextCanvasRef[];
  composerRequest?: {
    id: string;
    text?: string;
    submit?: boolean;
    quickAction?: string;
  };
}
