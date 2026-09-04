import type { ModelMessage } from 'ai';
import type { Engine } from 'pulse-coder-engine';

import type { AgentRoleDefinition } from '../../shared/agent-roles';
import type { AgentClarificationRequest } from '../../shared/agent-chat';
import type { ResolvedCanvasModel } from '../models/config';
import type {
  CanvasAgentDebugTrace,
  CanvasAgentMessage,
  CanvasAgentToolCall,
} from './types';
import type { CanvasToolResultEvent } from './engine-stream-callbacks';
import { resolveAgentRuntime } from './backends';
import { ENGINE_ABORT_SENTINEL } from './chat-stop';
import { attachTraceRuntime, recordTraceStreamEvent } from './debug-trace';
import { publishAgentTraceEvent } from '../../plugins/main';

type ClarificationHandler = (request: AgentClarificationRequest) => Promise<string>;

interface ExecuteCanvasAgentSegmentOptions {
  engine: Engine;
  context: { messages: ModelMessage[] };
  role: AgentRoleDefinition | null;
  chatSessionId: string;
  workspaceRootFolder?: string;
  history: CanvasAgentMessage[];
  currentAsk: string;
  handoffNames: string[];
  abortSignal: AbortSignal;
  executionMode: 'auto' | 'ask';
  onClarificationRequest?: ClarificationHandler;
  onText?: (delta: string) => void;
  onToolCall?: (data: { name: string; args: any; toolCallId?: string }) => void;
  onToolResult?: (data: CanvasToolResultEvent) => void;
  onToolInputStart?: (data: { id: string; toolName: string }) => void;
  onToolInputDelta?: (data: { id: string; delta: string }) => void;
  onToolInputEnd?: (data: { id: string }) => void;
  modelConfig: ResolvedCanvasModel;
  configuredModel?: string;
  systemPrompt: string;
  observabilityRunId?: string;
  observeFirstActivity?: boolean;
  debugTrace?: CanvasAgentDebugTrace;
  appendMessages: (messages: ModelMessage[]) => void;
  replaceMessages: (messages: ModelMessage[]) => void;
}

/**
 * Execute one chat segment on whichever backend the role routes to
 * (`resolveAgentRuntime`). This executor owns the runtime-agnostic policies,
 * which must behave identically for every backend:
 *
 * - `streamedText` accumulation, independent of what the backend returns or
 *   throws (the stopped-vs-failed rule needs the partial text).
 * - Response-message collection: backends report produced messages through
 *   `recordResponseMessages`, which appends to the live model history AND
 *   the per-segment collection, so partial output survives an abort.
 * - Abort normalization: a rejection after `abortSignal` fired is a STOPPED
 *   turn (`ENGINE_ABORT_SENTINEL`), never a failure — see
 *   harness/knowledge/agent-roles.md (stopped-vs-failed turn rule).
 */
export async function executeCanvasAgentSegment(
  options: ExecuteCanvasAgentSegmentOptions,
): Promise<{
  resultText: string;
  streamedText: string;
  responseMessages: ModelMessage[];
  externalToolCalls?: CanvasAgentToolCall[];
  runtimeOwner: 'engine' | 'pi';
}> {
  const responseMessages: ModelMessage[] = [];
  const backend = resolveAgentRuntime(options.role);
  const runtimeOwner = backend.id === 'pi-agent-harness' ? 'pi' : 'engine';
  let externalToolCalls: CanvasAgentToolCall[] | undefined;
  let streamedText = '';
  let firstActivityRecorded = false;
  let firstTextRecorded = false;
  const markMilestone = (milestone: 'runtime.first-activity' | 'runtime.first-text') => {
    if (!options.observabilityRunId || !options.observeFirstActivity) return;
    if (milestone === 'runtime.first-activity' && firstActivityRecorded) return;
    if (milestone === 'runtime.first-text' && firstTextRecorded) return;
    if (milestone === 'runtime.first-activity') firstActivityRecorded = true;
    if (milestone === 'runtime.first-text') firstTextRecorded = true;
    publishAgentTraceEvent({
      type: 'milestone', runId: options.observabilityRunId,
      timestamp: Date.now(), milestone, owner: runtimeOwner,
    });
  };
  const markActivity = () => markMilestone('runtime.first-activity');
  const handleText = (delta: string) => {
    recordTraceStreamEvent(options.debugTrace, 'text');
    markActivity();
    markMilestone('runtime.first-text');
    streamedText += delta;
    options.onText?.(delta);
  };
  const recordResponseMessages = (messages: ModelMessage[]) => {
    options.appendMessages(messages);
    responseMessages.push(...messages);
  };

  attachTraceRuntime(options.debugTrace, backend.id);
  if (options.observabilityRunId) {
    publishAgentTraceEvent({
      type: 'runtime.resolved', runId: options.observabilityRunId,
      timestamp: Date.now(), runtimeId: backend.id,
      owner: runtimeOwner,
    });
  }
  try {
    const result = await backend.runSegment({
      ...options,
      onText: handleText,
      onToolCall: data => { markActivity(); options.onToolCall?.(data); },
      onToolResult: data => { markActivity(); options.onToolResult?.(data); },
      onToolInputStart: data => { markActivity(); options.onToolInputStart?.(data); },
      recordResponseMessages,
    });
    externalToolCalls = result.toolCalls;
    return { resultText: result.resultText, streamedText, responseMessages, externalToolCalls, runtimeOwner };
  } catch (error) {
    if (!options.abortSignal.aborted) throw error;
    return {
      resultText: ENGINE_ABORT_SENTINEL,
      streamedText,
      responseMessages,
      externalToolCalls,
      runtimeOwner,
    };
  }
}
