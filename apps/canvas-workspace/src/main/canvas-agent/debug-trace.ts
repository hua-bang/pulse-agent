import { randomUUID } from 'crypto';
import type {
  CanvasAgentDebugTrace,
  CanvasAgentDebugTraceContextRead,
  CanvasAgentDebugTraceNodeRef,
  CanvasAgentDebugTraceToolCall,
  WorkspaceSummary,
} from './types';

const PREVIEW_CHARS = 1800;
const RESULT_SUMMARY_CHARS = 900;
const MESSAGE_SNAPSHOT_LIMIT_CHARS = 96_000;
const SYSTEM_PROMPT_SNAPSHOT_LIMIT_CHARS = 40_000;
const TRACE_JSON_LIMIT_CHARS = 180_000;

interface CanvasAgentRequestContext {
  executionMode?: 'auto' | 'ask';
  scope?: 'current_canvas' | 'selected_nodes';
  selectedNodes?: Array<{ id: string; title: string; type: string }>;
  quickAction?: string;
}

interface StartTraceInput {
  sessionId: string;
  userPrompt: string;
  attachmentCount: number;
  requestContext?: CanvasAgentRequestContext;
  mentionedCanvases: Array<{ id: string; name: string }>;
  summary: WorkspaceSummary | null;
  systemPrompt: string;
  currentCanvasSummary?: string;
}

interface ToolResultInput {
  name?: string;
  toolCallId?: string;
  rawResult: unknown;
}

export function isCanvasAgentDebugTraceEnabled(): boolean {
  const override = process.env.CANVAS_AGENT_DEBUG_TRACE?.trim().toLowerCase();
  if (override) {
    if (['0', 'false', 'off', 'no'].includes(override)) return false;
    if (['1', 'true', 'on', 'yes'].includes(override)) return true;
  }

  const lifecycleEvent = process.env.npm_lifecycle_event?.trim().toLowerCase();
  if (lifecycleEvent === 'dev') return true;

  const lifecycleScript = process.env.npm_lifecycle_script?.trim().toLowerCase() ?? '';
  if (lifecycleScript.includes('electron-vite dev')) return true;

  return process.env.NODE_ENV === 'development' && !!process.env.VITE_DEV_SERVER_URL;
}

export function createCanvasAgentDebugTrace(input: StartTraceInput): CanvasAgentDebugTrace {
  const startedAt = Date.now();
  const runId = randomUUID();
  const selectedNodes = (input.requestContext?.selectedNodes ?? []).map(node => ({
    id: node.id,
    title: node.title,
    type: node.type,
    workspaceId: input.summary?.workspaceId,
    workspaceName: input.summary?.workspaceName,
    source: 'selected' as const,
  }));

  return {
    sessionId: input.sessionId,
    runId,
    turnId: runId,
    createdAt: startedAt,
    startedAt,
    request: {
      userPromptPreview: preview(input.userPrompt),
      attachmentCount: input.attachmentCount,
      executionMode: input.requestContext?.executionMode,
      scope: input.requestContext?.scope,
      quickAction: input.requestContext?.quickAction,
      selectedNodes,
      mentionedCanvases: input.mentionedCanvases,
      workspace: input.summary
        ? {
            id: input.summary.workspaceId,
            name: input.summary.workspaceName,
            nodeCount: input.summary.nodeCount,
          }
        : undefined,
    },
    prompt: {
      systemPromptPreview: preview(input.systemPrompt),
      systemPromptChars: input.systemPrompt.length,
      currentCanvasSummaryPreview: input.currentCanvasSummary ? preview(input.currentCanvasSummary) : undefined,
      currentCanvasSummaryChars: input.currentCanvasSummary?.length,
    },
    toolCalls: [],
    readNodes: [],
    contextReads: [],
  };
}

export function attachTraceModel(
  trace: CanvasAgentDebugTrace | undefined,
  model: { provider?: string; model?: string; modelType?: string },
): void {
  if (!trace) return;
  trace.model = model;
}

export function recordTraceToolCall(
  trace: CanvasAgentDebugTrace | undefined,
  input: { name?: string; args?: unknown; toolCallId?: string },
): void {
  if (!trace || !input.name) return;
  const tool = findOrCreateTool(trace, input.name, input.toolCallId);
  tool.status = 'running';
  tool.startedAt ??= Date.now();
  tool.argsPreview = previewJson(input.args, PREVIEW_CHARS);
}

export function recordTraceToolResult(trace: CanvasAgentDebugTrace | undefined, input: ToolResultInput): void {
  if (!trace || !input.name) return;
  const finishedAt = Date.now();
  const tool = findOrCreateTool(trace, input.name, input.toolCallId);
  tool.status = isErrorResult(input.rawResult) ? 'error' : 'done';
  tool.finishedAt = finishedAt;
  tool.startedAt ??= finishedAt;
  tool.durationMs = finishedAt - tool.startedAt;
  tool.resultSummary = summarizeToolResult(input.name, input.rawResult);

  if (input.name === 'canvas_read_node') {
    const readNodes = extractReadNodes(input.rawResult, 'read_node');
    if (readNodes.length > 0) {
      tool.readNodes = readNodes;
      addUniqueReadNodes(trace, readNodes);
    }
  }

  if (input.name === 'canvas_read_context') {
    const contextRead = extractContextRead(input.rawResult);
    if (contextRead) {
      tool.contextRead = contextRead;
      trace.contextReads.push(contextRead);
    }

    const readNodes = extractReadNodes(input.rawResult, 'read_context');
    if (readNodes.length > 0) {
      tool.readNodes = readNodes;
      addUniqueReadNodes(trace, readNodes);
    }
  }
}

export function recordTraceMessageSnapshot(
  trace: CanvasAgentDebugTrace | undefined,
  input: { systemPrompt: string; messages: unknown[] },
): void {
  if (!trace) return;
  const messagesJson = JSON.stringify(input.messages, null, 2) ?? '[]';
  const systemPromptTruncated = input.systemPrompt.length > SYSTEM_PROMPT_SNAPSHOT_LIMIT_CHARS;
  const messagesTruncated = messagesJson.length > MESSAGE_SNAPSHOT_LIMIT_CHARS;
  trace.messageSnapshot = {
    systemPrompt: systemPromptTruncated
      ? `${input.systemPrompt.slice(0, SYSTEM_PROMPT_SNAPSHOT_LIMIT_CHARS)}\n…[system prompt truncated]`
      : input.systemPrompt,
    systemPromptChars: input.systemPrompt.length,
    messagesJson: messagesTruncated
      ? `${messagesJson.slice(0, MESSAGE_SNAPSHOT_LIMIT_CHARS)}\n…[messages snapshot truncated]`
      : messagesJson,
    messagesChars: messagesJson.length,
    messageCount: input.messages.length,
    limitChars: MESSAGE_SNAPSHOT_LIMIT_CHARS,
    truncated: systemPromptTruncated || messagesTruncated,
  };
}

export function finalizeCanvasAgentDebugTrace(trace: CanvasAgentDebugTrace | undefined): CanvasAgentDebugTrace | undefined {
  if (!trace) return undefined;
  const finishedAt = Date.now();
  trace.finishedAt = finishedAt;
  trace.durationMs = finishedAt - trace.startedAt;

  if (JSON.stringify(trace).length <= TRACE_JSON_LIMIT_CHARS) {
    return trace;
  }

  trace.truncated = true;
  trace.prompt.systemPromptPreview = preview(trace.prompt.systemPromptPreview, 600);
  trace.prompt.currentCanvasSummaryPreview = trace.prompt.currentCanvasSummaryPreview
    ? preview(trace.prompt.currentCanvasSummaryPreview, 600)
    : undefined;
  trace.toolCalls = trace.toolCalls.map(tool => ({
    ...tool,
    argsPreview: tool.argsPreview ? preview(tool.argsPreview, 600) : undefined,
    resultSummary: tool.resultSummary ? preview(tool.resultSummary, 600) : undefined,
  }));
  if (trace.messageSnapshot) {
    trace.messageSnapshot = {
      ...trace.messageSnapshot,
      systemPrompt: preview(trace.messageSnapshot.systemPrompt, 12_000),
      messagesJson: preview(trace.messageSnapshot.messagesJson, 24_000),
      truncated: true,
    };
  }

  return trace;
}

function findOrCreateTool(
  trace: CanvasAgentDebugTrace,
  name: string,
  toolCallId?: string,
): CanvasAgentDebugTraceToolCall {
  const existing = toolCallId
    ? trace.toolCalls.find(tool => tool.toolCallId === toolCallId)
    : trace.toolCalls.find(tool => tool.name === name && tool.status === 'running');

  if (existing) {
    existing.name = name;
    if (toolCallId) existing.toolCallId = toolCallId;
    return existing;
  }

  const tool: CanvasAgentDebugTraceToolCall = {
    name,
    toolCallId,
    status: 'running',
    startedAt: Date.now(),
  };
  trace.toolCalls.push(tool);
  return tool;
}

function preview(value: string, maxChars = PREVIEW_CHARS): string {
  const compact = value.replace(/\s+/g, ' ').trim();
  if (compact.length <= maxChars) return compact;
  return `${compact.slice(0, maxChars)}…`;
}

function previewJson(value: unknown, maxChars = PREVIEW_CHARS): string | undefined {
  if (value === undefined) return undefined;
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  if (!text) return undefined;
  return preview(text, maxChars);
}

function parseJsonResult(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return raw;
  }
}

function isErrorResult(raw: unknown): boolean {
  return typeof raw === 'string' && raw.toLowerCase().startsWith('error:');
}

function summarizeToolResult(toolName: string, raw: unknown): string {
  if (isErrorResult(raw)) return preview(String(raw), RESULT_SUMMARY_CHARS);

  const parsed = parseJsonResult(raw);
  if (toolName === 'canvas_read_node') {
    const node = nodeRefFromUnknown(parsed, 'read_node');
    if (node) {
      const size = node.contentChars != null ? `, ${node.contentChars} chars` : '';
      return `Read node: ${node.title} (${node.type}, ${node.id}${size})`;
    }
  }

  if (toolName === 'canvas_read_context') {
    const contextRead = extractContextRead(parsed);
    if (contextRead) {
      return `Read context: ${contextRead.workspaceName ?? contextRead.workspaceId ?? 'workspace'} (${contextRead.detail ?? 'summary'}, ${contextRead.nodeCount ?? 0} nodes)`;
    }
  }

  return previewJson(parsed, RESULT_SUMMARY_CHARS) ?? '';
}

function extractReadNodes(raw: unknown, source: 'read_node' | 'read_context'): CanvasAgentDebugTraceNodeRef[] {
  const parsed = parseJsonResult(raw);
  if (source === 'read_node') {
    const node = nodeRefFromUnknown(parsed, source);
    return node ? [node] : [];
  }

  if (!parsed || typeof parsed !== 'object') return [];
  const data = parsed as { workspaceId?: unknown; workspaceName?: unknown; nodes?: unknown };
  if (!Array.isArray(data.nodes)) return [];
  return data.nodes
    .map(node => nodeRefFromUnknown(node, source, {
      workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId : undefined,
      workspaceName: typeof data.workspaceName === 'string' ? data.workspaceName : undefined,
    }))
    .filter((node): node is CanvasAgentDebugTraceNodeRef => !!node);
}

function extractContextRead(raw: unknown): CanvasAgentDebugTraceContextRead | undefined {
  const parsed = parseJsonResult(raw);
  if (typeof raw === 'string' && !raw.trim().startsWith('{')) {
    const totalMatch = raw.match(/Total nodes:\s*(\d+)/i);
    const nameMatch = raw.match(/# Canvas Workspace:\s*(.+)/i);
    const workspaceIdMatch = raw.match(/Workspace ID:\s*(.+)/i);
    return {
      workspaceName: nameMatch?.[1]?.trim(),
      workspaceId: workspaceIdMatch?.[1]?.trim(),
      detail: 'summary',
      nodeCount: totalMatch ? Number(totalMatch[1]) : undefined,
      resultChars: raw.length,
    };
  }

  if (!parsed || typeof parsed !== 'object') return undefined;
  const data = parsed as { workspaceId?: unknown; workspaceName?: unknown; nodes?: unknown };
  return {
    workspaceId: typeof data.workspaceId === 'string' ? data.workspaceId : undefined,
    workspaceName: typeof data.workspaceName === 'string' ? data.workspaceName : undefined,
    detail: Array.isArray(data.nodes) ? 'full' : 'summary',
    nodeCount: Array.isArray(data.nodes) ? data.nodes.length : undefined,
    resultChars: typeof raw === 'string' ? raw.length : (JSON.stringify(raw) ?? '').length,
  };
}

function nodeRefFromUnknown(
  value: unknown,
  source: 'read_node' | 'read_context',
  workspace?: { workspaceId?: string; workspaceName?: string },
): CanvasAgentDebugTraceNodeRef | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const node = value as {
    id?: unknown;
    title?: unknown;
    type?: unknown;
    workspaceId?: unknown;
    workspaceName?: unknown;
    content?: unknown;
    scrollback?: unknown;
  };
  if (typeof node.id !== 'string' || typeof node.type !== 'string') return undefined;

  const content = typeof node.content === 'string'
    ? node.content
    : typeof node.scrollback === 'string'
      ? node.scrollback
      : undefined;

  return {
    id: node.id,
    title: typeof node.title === 'string' && node.title.trim() ? node.title : node.id,
    type: node.type,
    workspaceId: typeof node.workspaceId === 'string' ? node.workspaceId : workspace?.workspaceId,
    workspaceName: typeof node.workspaceName === 'string' ? node.workspaceName : workspace?.workspaceName,
    contentChars: content?.length,
    source,
  };
}

function addUniqueReadNodes(trace: CanvasAgentDebugTrace, nodes: CanvasAgentDebugTraceNodeRef[]): void {
  const seen = new Set(trace.readNodes.map(node => `${node.workspaceId ?? ''}:${node.id}:${node.source ?? ''}`));
  for (const node of nodes) {
    const key = `${node.workspaceId ?? ''}:${node.id}:${node.source ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    trace.readNodes.push(node);
  }
}
