import { useCallback, useState } from 'react';
import type {
  AgentContextCanvasRef,
  AgentContextNodeRef,
  AgentContextTagRef,
} from '../../types';
import type { KnowledgeChatExplicitContext } from '../Workbench/knowledgeChatContext';

export interface NodesAiContext {
  nodes: AgentContextNodeRef[];
  tags?: AgentContextTagRef[];
  canvases?: AgentContextCanvasRef[];
}

interface Options {
  openChat: () => void;
  summarizePrompt: string;
}

const hasContext = (context: NodesAiContext): boolean => (
  context.nodes.length > 0 || (context.tags?.length ?? 0) > 0 || (context.canvases?.length ?? 0) > 0
);

/** Owns transient list-invoked chat scope, keeping the app route shell small. */
export const useKnowledgeAiContext = ({ openChat, summarizePrompt }: Options) => {
  const [explicitContext, setExplicitContext] = useState<KnowledgeChatExplicitContext | null>(null);

  const askAi = useCallback((context: NodesAiContext, action: 'chat' | 'summarize') => {
    if (!hasContext(context)) return;
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    setExplicitContext({
      nodes: context.nodes,
      ...(context.tags?.length ? { tags: context.tags } : {}),
      ...(context.canvases?.length ? { canvases: context.canvases } : {}),
      composerRequest: action === 'summarize'
        ? { id, text: summarizePrompt, submit: true, quickAction: 'summarize_knowledge_node' }
        : { id },
    });
    openChat();
  }, [openChat, summarizePrompt]);

  const removeContext = useCallback((key: string) => {
    setExplicitContext((current) => {
      if (!current) return current;
      const nodes = current.nodes.filter((node) => `node:${node.workspaceId ?? ''}:${node.id}` !== key);
      const tags = current.tags?.filter((tag) => `tag:${tag.name}` !== key) ?? [];
      const canvases = current.canvases?.filter((canvas) => `canvas:${canvas.id}` !== key) ?? [];
      if (nodes.length === 0 && tags.length === 0 && canvases.length === 0) return null;
      return {
        ...current,
        nodes,
        ...(tags.length > 0 ? { tags } : {}),
        ...(canvases.length > 0 ? { canvases } : {}),
      };
    });
  }, []);

  const consumeComposerRequest = useCallback((requestId: string) => {
    setExplicitContext((current) => {
      if (current?.composerRequest?.id !== requestId) return current;
      const { composerRequest: _consumed, ...context } = current;
      return context;
    });
  }, []);

  return { explicitContext, askAi, removeContext, consumeComposerRequest };
};
