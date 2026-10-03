import type { AgentChatToolCall } from '../../../shared/agent-chat';
import type { TurnToolCall, TurnToolResult } from './conversation-runtime';

const findRunningTool = (
  tools: AgentChatToolCall[],
  toolCallId: string | undefined,
  name?: string,
): AgentChatToolCall | undefined => {
  const byId = toolCallId
    ? tools.find(tool => tool.toolCallId === toolCallId && tool.status === 'running')
    : undefined;
  if (byId) return byId;
  if (!name) return undefined;
  return tools.find(tool => tool.name === name && tool.status === 'running');
};

/**
 * Tool calls of the conversation's active turn, in first-observed order.
 * Ids stay unique for the runtime's lifetime because content blocks of
 * earlier turns may still reference them.
 */
export class TurnToolTracker {
  tools: AgentChatToolCall[] = [];
  private nextId = 0;

  reset(): void {
    this.tools = [];
  }

  inputStart(data: { id: string; toolName: string }): void {
    const existing = data.id ? this.tools.find(tool => tool.toolCallId === data.id) : undefined;
    if (existing) {
      existing.name = data.toolName;
      if (existing.status === 'running') existing.inputStreaming = true;
      return;
    }
    this.tools.push({
      id: ++this.nextId,
      name: data.toolName,
      toolCallId: data.id,
      status: 'running',
      partialInput: '',
      inputStreaming: true,
    });
  }

  inputDelta(data: { id: string; delta: string }): void {
    const tool = findRunningTool(this.tools, data.id);
    if (tool) tool.partialInput = (tool.partialInput ?? '') + data.delta;
  }

  inputEnd(data: { id: string }): void {
    const tool = findRunningTool(this.tools, data.id);
    if (tool) tool.inputStreaming = false;
  }

  call(data: TurnToolCall): void {
    const existing = data.toolCallId
      ? this.tools.find(tool => tool.toolCallId === data.toolCallId)
      : undefined;
    if (existing) {
      existing.args = data.args;
      existing.inputStreaming = false;
      return;
    }
    this.tools.push({
      id: ++this.nextId,
      name: data.name,
      args: data.args,
      toolCallId: data.toolCallId,
      status: 'running',
    });
  }

  result(data: TurnToolResult): void {
    const tool = findRunningTool(this.tools, data.toolCallId, data.name)
      ?? this.tools.find(t => t.toolCallId === data.toolCallId)
      ?? this.tools.find(t => t.name === data.name);
    if (!tool) return;
    tool.status = data.status ?? 'succeeded';
    tool.result = data.result;
    tool.error = data.error;
    tool.mcpApp = data.mcpApp;
    tool.inputStreaming = false;
    if (tool.streamedContent != null) tool.streamedDone = true;
  }

  /** Copies with unfinished calls closed as cancelled (stopped) or failed. */
  settled(stopped: boolean): AgentChatToolCall[] | undefined {
    if (this.tools.length === 0) return undefined;
    return this.tools.map(tool => ({
      ...tool,
      ...(tool.status === 'running' || tool.status === 'queued' ? {
        status: stopped ? 'cancelled' as const : 'failed' as const,
        inputStreaming: false,
      } : {}),
    }));
  }
}
