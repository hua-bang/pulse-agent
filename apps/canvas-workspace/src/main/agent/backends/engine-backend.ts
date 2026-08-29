import type { ModelMessage } from 'ai';

import { buildEngineStreamCallbacks } from '../engine-stream-callbacks';
import type { AgentRuntime, TurnSegmentRequest, TurnSegmentResult } from './types';
import type { MCPAppsManager } from 'pulse-coder-engine/built-in';
import { resolveMcpApp } from '../mcp-app-runtime';

const CANVAS_AGENT_MAX_STEPS = 200;

/**
 * The built-in backend: one `engine.run` per segment against the shared
 * model history, with canvas tools, native clarifications, and compaction
 * write-back through `replaceMessages`.
 */
export const engineTurnBackend: AgentRuntime = {
  id: 'engine',
  capabilities: {
    nativeCanvasTools: true,
    clarifications: 'native',
    historyFidelity: 'full',
    sessionResume: 'host',
    steering: 'none',
    compaction: 'native',
  },
  async runSegment(request: TurnSegmentRequest): Promise<TurnSegmentResult> {
    const mcpApps = request.engine.getService?.<MCPAppsManager>('mcp:__apps__');
    const resultText = await request.engine.run(request.context, {
      provider: request.modelConfig.provider,
      model: request.configuredModel ?? request.modelConfig.model,
      modelType: request.modelConfig.modelType,
      systemPrompt: request.systemPrompt,
      maxSteps: CANVAS_AGENT_MAX_STEPS,
      errorMode: 'throw',
      abortSignal: request.abortSignal,
      runContext: {
        executionMode: request.executionMode,
        runId: request.observabilityRunId,
        sessionId: request.chatSessionId,
        runtimeId: 'engine',
      },
      onClarificationRequest: request.onClarificationRequest,
      ...buildEngineStreamCallbacks(
        request,
        request.debugTrace,
        (name, toolCallId) => resolveMcpApp(mcpApps, name, toolCallId),
      ),
      onResponse: (messages: ModelMessage[]) => {
        request.recordResponseMessages(messages);
      },
      onCompacted: (messages: ModelMessage[]) => {
        request.replaceMessages(messages);
        request.context.messages = messages;
      },
    });
    return { resultText };
  },
};
