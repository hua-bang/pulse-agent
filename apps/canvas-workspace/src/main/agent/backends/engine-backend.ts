import type { ModelMessage } from 'ai';

import { buildEngineStreamCallbacks } from '../engine-stream-callbacks';
import type { TurnBackend, TurnSegmentRequest, TurnSegmentResult } from './types';

const CANVAS_AGENT_MAX_STEPS = 200;

/**
 * The built-in backend: one `engine.run` per segment against the shared
 * model history, with canvas tools, native clarifications, and compaction
 * write-back through `replaceMessages`.
 */
export const engineTurnBackend: TurnBackend = {
  id: 'engine',
  capabilities: {
    nativeCanvasTools: 'full',
    clarifications: 'native',
    historyFidelity: 'full',
    sessionResume: 'host',
  },
  async runSegment(request: TurnSegmentRequest): Promise<TurnSegmentResult> {
    const resultText = await request.engine.run(request.context, {
      provider: request.modelConfig.provider,
      model: request.configuredModel ?? request.modelConfig.model,
      modelType: request.modelConfig.modelType,
      systemPrompt: request.systemPrompt,
      maxSteps: CANVAS_AGENT_MAX_STEPS,
      abortSignal: request.abortSignal,
      runContext: { executionMode: request.executionMode },
      onClarificationRequest: request.onClarificationRequest,
      ...buildEngineStreamCallbacks(request, request.debugTrace),
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
