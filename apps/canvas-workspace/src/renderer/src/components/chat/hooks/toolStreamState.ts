import type { ToolCallStatus } from '../types';

interface ToolInputStart {
  id: string;
  toolName: string;
}

interface ToolResult {
  name: string;
  result: string;
  toolCallId?: string;
}

const findTool = (tools: ToolCallStatus[], toolCallId: string | undefined, name?: string) => {
  if (toolCallId) {
    const byId = tools.find(tool => tool.toolCallId === toolCallId);
    if (byId) return byId;
  }
  if (!name) return undefined;
  return tools.find(tool => tool.name === name && tool.status === 'running');
};

const findRunningTool = (tools: ToolCallStatus[], toolCallId: string | undefined, name?: string) => {
  const byId = toolCallId ? tools.find(tool => tool.toolCallId === toolCallId && tool.status === 'running') : undefined;
  if (byId) return byId;
  if (!name) return undefined;
  return tools.find(tool => tool.name === name && tool.status === 'running');
};

export function upsertToolInputStart(
  tools: ToolCallStatus[],
  data: ToolInputStart,
  nextId: () => number,
): void {
  const existing = data.id ? tools.find(tool => tool.toolCallId === data.id) : undefined;
  if (existing) {
    existing.name = data.toolName;
    if (existing.status === 'running') {
      existing.inputStreaming = true;
    }
    return;
  }

  tools.push({
    id: nextId(),
    name: data.toolName,
    toolCallId: data.id,
    status: 'running',
    partialInput: '',
    inputStreaming: true,
  });
}

export function markToolResult(tools: ToolCallStatus[], data: ToolResult): void {
  const tool = findRunningTool(tools, data.toolCallId, data.name) ?? findTool(tools, data.toolCallId, data.name);
  if (!tool) return;

  tool.status = 'done';
  tool.result = data.result;
  tool.inputStreaming = false;
  if (tool.streamedContent != null) {
    tool.streamedDone = true;
  }
}

export function settleRunningTools(tools: ToolCallStatus[]): void {
  for (const tool of tools) {
    if (tool.status !== 'running') continue;
    tool.status = 'done';
    tool.inputStreaming = false;
    if (tool.streamedContent != null) {
      tool.streamedDone = true;
    }
  }
}
