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
import { buildEngineStreamCallbacks } from './engine-stream-callbacks';
import { runExternalRoleSegment } from './external/segment';
import { ENGINE_ABORT_SENTINEL } from './chat-stop';

const CANVAS_AGENT_MAX_STEPS = 200;

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

  try {
    let resultText: string;
    if (options.role?.external) {
      const external = await runExternalRoleSegment({
        role: options.role,
        external: options.role.external,
        chatSessionId: options.chatSessionId,
        workspaceRootFolder: options.workspaceRootFolder,
        history: options.history,
        currentAsk: options.currentAsk,
        handoffNames: options.handoffNames,
        abortSignal: options.abortSignal,
        executionMode: options.executionMode,
        onApprovalRequest: options.onClarificationRequest,
        onText: handleText,
        onToolCall: options.onToolCall,
        onToolResult: options.onToolResult,
      });
      resultText = external.text;
      externalToolCalls = external.toolCalls;
      const message = { role: 'assistant', content: resultText } as ModelMessage;
      options.appendMessages([message]);
      responseMessages.push(message);
    } else {
      resultText = await options.engine.run(options.context, {
        provider: options.modelConfig.provider,
        model: options.configuredModel ?? options.modelConfig.model,
        modelType: options.modelConfig.modelType,
        systemPrompt: options.systemPrompt,
        maxSteps: CANVAS_AGENT_MAX_STEPS,
        abortSignal: options.abortSignal,
        runContext: { executionMode: options.executionMode },
        onClarificationRequest: options.onClarificationRequest,
        ...buildEngineStreamCallbacks(options, options.debugTrace),
        onResponse: (messages: ModelMessage[]) => {
          options.appendMessages(messages);
          responseMessages.push(...messages);
        },
        onCompacted: (messages: ModelMessage[]) => {
          options.replaceMessages(messages);
          options.context.messages = messages;
        },
      });
    }
    return { resultText, streamedText, responseMessages, externalToolCalls };
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
