import { friendlyChatFailure } from '../../shared/chat-failure';
import type { EngineStreamCallbacks } from './engine-stream-callbacks';
import type { CanvasAgentMessage, CanvasAgentToolCall } from './types';

export function createFailedTurnToolTracker(forward: EngineStreamCallbacks = {}) {
  let tools: CanvasAgentToolCall[] = [];
  const find = (toolCallId?: string, name?: string) => (
    (toolCallId ? tools.find(tool => tool.toolCallId === toolCallId) : undefined)
    ?? (name ? tools.find(tool => tool.name === name && tool.status === 'running') : undefined)
  );
  const upsert = (toolCallId: string | undefined, name: string) => {
    const existing = find(toolCallId, name);
    if (existing) return existing;
    const tool: CanvasAgentToolCall = {
      id: tools.length + 1,
      name,
      toolCallId,
      status: 'running',
    };
    tools.push(tool);
    return tool;
  };

  const callbacks: EngineStreamCallbacks = {
    onToolCall: data => {
      const tool = upsert(data.toolCallId, data.name);
      tool.args = data.args;
      forward.onToolCall?.(data);
    },
    onToolResult: data => {
      const tool = upsert(data.toolCallId, data.name);
      Object.assign(tool, {
        status: data.status,
        result: data.result,
        error: data.error,
        inputStreaming: false,
      });
      forward.onToolResult?.(data);
    },
    onToolInputStart: data => {
      Object.assign(upsert(data.id, data.toolName), {
        partialInput: '',
        inputStreaming: true,
      });
      forward.onToolInputStart?.(data);
    },
    onToolInputDelta: data => {
      const tool = find(data.id);
      if (tool) tool.partialInput = `${tool.partialInput ?? ''}${data.delta}`;
      forward.onToolInputDelta?.(data);
    },
    onToolInputEnd: data => {
      const tool = find(data.id);
      if (tool) tool.inputStreaming = false;
      forward.onToolInputEnd?.(data);
    },
  };

  return {
    callbacks,
    reset: () => { tools = []; },
    snapshot: () => tools.map(tool => ({ ...tool })),
  };
}

export function failedAssistantMessage(
  error: unknown,
  toolCalls: CanvasAgentToolCall[] = [],
): CanvasAgentMessage {
  const failure = friendlyChatFailure(error);
  const settledTools = toolCalls.map(tool => (
    tool.status === 'queued' || tool.status === 'running'
      ? {
          ...tool,
          status: 'failed' as const,
          error: tool.error ?? failure.details,
          inputStreaming: false,
        }
      : { ...tool }
  ));
  return {
    role: 'assistant',
    content: '',
    timestamp: Date.now(),
    toolCalls: settledTools.length > 0 ? settledTools : undefined,
    turnStatus: 'failed',
    errorDetails: failure.details,
    failureKind: failure.kind,
    retryable: failure.retryable,
  };
}
