import type { ModelMessage } from 'ai';
import type { Engine } from 'pulse-coder-engine';

import type { AgentRoleDefinition } from '../../shared/agent-roles';
import type { ResolvedCanvasModel } from './model/config';
import type {
  CanvasAgentDebugTrace,
  CanvasAgentMessage,
  CanvasAgentToolCall,
} from './types';
import type { CanvasToolResultEvent } from './engine-stream-callbacks';
import { resolveTurnBackend } from './backends';
import { ENGINE_ABORT_SENTINEL } from './chat-stop';

type ClarificationHandler = (request: {
  id: string;
  question: string;
  context?: string;
}) => Promise<string>;

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
  debugTrace?: CanvasAgentDebugTrace;
  appendMessages: (messages: ModelMessage[]) => void;
  replaceMessages: (messages: ModelMessage[]) => void;
}

/**
 * Execute one chat segment on whichever backend the role routes to
 * (`resolveTurnBackend`). This executor owns the backend-AGNOSTIC policies,
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
}> {
  const responseMessages: ModelMessage[] = [];
  let externalToolCalls: CanvasAgentToolCall[] | undefined;
  let streamedText = '';
  const handleText = (delta: string) => {
    streamedText += delta;
    options.onText?.(delta);
  };
  const recordResponseMessages = (messages: ModelMessage[]) => {
    options.appendMessages(messages);
    responseMessages.push(...messages);
  };

  const backend = resolveTurnBackend(options.role);
  try {
    const result = await backend.runSegment({
      ...options,
      onText: handleText,
      recordResponseMessages,
    });
    externalToolCalls = result.toolCalls;
    return { resultText: result.resultText, streamedText, responseMessages, externalToolCalls };
  } catch (error) {
    if (!options.abortSignal.aborted) throw error;
    return {
      resultText: ENGINE_ABORT_SENTINEL,
      streamedText,
      responseMessages,
      externalToolCalls,
    };
  }
}
