import { appendContentText, appendContentTool, contentText, finishContentBlocks, retainContentText } from '../../shared/chat-content-blocks';
import type { AgentChatContentBlock } from '../../shared/agent-chat';
import { friendlyChatFailure } from '../../shared/chat-failure';
import type { EngineStreamCallbacks } from './engine-stream-callbacks';
import type { CanvasAgentMessage, CanvasAgentToolCall } from './types';

export function createFailedTurnToolTracker(forward: EngineStreamCallbacks = {}) {
  let tools: CanvasAgentToolCall[] = [];
  let blocks: AgentChatContentBlock[] = [];
  const find = (toolCallId?: string, name?: string) => (
    (toolCallId ? tools.find(tool => tool.toolCallId === toolCallId) : undefined)
    ?? (!toolCallId && name ? tools.find(tool => tool.name === name && tool.status === 'running') : undefined)
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
    blocks = appendContentTool(blocks, tool);
    return tool;
  };

  const callbacks: EngineStreamCallbacks = {
    onText: delta => {
      blocks = appendContentText(blocks, delta);
      forward.onText?.(delta);
    },
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
    reset: () => { tools = []; blocks = []; },
    contentBlocks: () => blocks,
    finalize: (response: string, finalTools: CanvasAgentToolCall[], sanitized = false) => {
      // Persist the event IDs, not a second reconstruction's numeric IDs.
      const mergedTools = tools.map(tool => ({
        ...tool,
        ...(tool.toolCallId ? finalTools.find(final => final.toolCallId === tool.toolCallId) : undefined),
        id: tool.id,
      }));
      for (const tool of finalTools) {
        if (!mergedTools.some(existing => tool.toolCallId
          ? existing.toolCallId === tool.toolCallId
          : existing.id === tool.id)) {
          const added = { ...tool, id: mergedTools.length + 1 };
          mergedTools.push(added);
          blocks = appendContentTool(blocks, added);
        }
      }
      const contentBlocks = sanitized ? retainContentText(blocks, response) : finishContentBlocks(blocks, response);
      return { content: contentText(contentBlocks), contentBlocks, toolCalls: mergedTools.length ? mergedTools : undefined };
    },
    snapshot: () => tools.map(tool => ({ ...tool })),
  };
}

export function failedAssistantMessage(
  error: unknown,
  toolCalls: CanvasAgentToolCall[] = [],
  contentBlocks?: AgentChatContentBlock[],
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
    content: contentBlocks ? contentText(contentBlocks) : '',
    contentBlocks,
    timestamp: Date.now(),
    toolCalls: settledTools.length > 0 ? settledTools : undefined,
    turnStatus: 'failed',
    errorDetails: failure.details,
    failureKind: failure.kind,
    retryable: failure.retryable,
  };
}
