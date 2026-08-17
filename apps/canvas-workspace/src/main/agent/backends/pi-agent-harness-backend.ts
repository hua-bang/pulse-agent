import {
  AgentHarness,
  InMemorySessionRepo,
  type AgentMessage,
} from '@earendil-works/pi-agent-core';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import type { ModelMessage } from 'ai';

import { unwrapToolOutput } from '../engine-stream-callbacks';
import type { CanvasAgentToolCall } from '../types';
import { createPiGenerationObserver } from '../observability/pi-generation-events';
import { createPiModelRuntime, type PiModelRuntime } from './pi-model-adapter';
import { adaptEngineToolsForPi } from './pi-tool-adapter';
import type { AgentRuntime, TurnSegmentRequest, TurnSegmentResult } from './types';

interface PiAgentHarnessBackendOptions {
  createModelRuntime?: (config: TurnSegmentRequest['modelConfig']) => PiModelRuntime;
}

const EMPTY_USAGE: AssistantMessage['usage'] = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

const messageText = (content: unknown): string => {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content
    .map(part => part && typeof part === 'object' && (part as any).type === 'text'
      ? String((part as any).text ?? '')
      : '')
    .join('');
};

const toolOutputText = (output: unknown): string => {
  const value = unwrapToolOutput(output);
  if (typeof value === 'string') return value;
  if (value === undefined) return '';
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
};

const toPiHistoryMessages = (
  message: ModelMessage,
  model: PiModelRuntime['model'],
): AgentMessage[] => {
  const timestamp = Date.now();
  if (message.role === 'user') {
    return [{ role: 'user', content: messageText(message.content), timestamp }];
  }
  if (message.role === 'system') {
    const text = messageText(message.content);
    return text
      ? [{ role: 'user', content: `[System context]\n${text}`, timestamp }]
      : [];
  }
  if (message.role === 'assistant') {
    const source = Array.isArray(message.content) ? message.content : [];
    const content: AssistantMessage['content'] = [];
    if (typeof message.content === 'string') {
      content.push({ type: 'text', text: message.content });
    } else {
      for (const part of source as any[]) {
        if (part?.type === 'text') {
          content.push({ type: 'text', text: String(part.text ?? '') });
        } else if (part?.type === 'reasoning') {
          content.push({ type: 'thinking', thinking: String(part.text ?? part.reasoning ?? '') });
        } else if (part?.type === 'tool-call') {
          content.push({
            type: 'toolCall',
            id: String(part.toolCallId ?? ''),
            name: String(part.toolName ?? ''),
            arguments: (part.input && typeof part.input === 'object') ? part.input : {},
          });
        }
      }
    }
    return [{
      role: 'assistant',
      content,
      api: model.api,
      provider: model.provider,
      model: model.id,
      usage: EMPTY_USAGE,
      stopReason: content.some(part => part.type === 'toolCall') ? 'toolUse' : 'stop',
      timestamp,
    }];
  }
  if (message.role === 'tool' && Array.isArray(message.content)) {
    return message.content.flatMap((part: any) => {
      if (part?.type !== 'tool-result') return [];
      const outputType = part.output?.type;
      return [{
        role: 'toolResult' as const,
        toolCallId: String(part.toolCallId ?? ''),
        toolName: String(part.toolName ?? ''),
        content: [{ type: 'text' as const, text: toolOutputText(part.output) }],
        details: part.output,
        isError: outputType === 'error-text' || outputType === 'error-json',
        timestamp,
      }];
    });
  }
  return [];
};

const assistantText = (message: AssistantMessage): string => message.content
  .map(block => block.type === 'text' ? block.text : '')
  .join('');

const jsonValue = (value: unknown): unknown | undefined => {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return undefined;
  }
};

const fromPiMessage = (message: AgentMessage): ModelMessage | undefined => {
  if (message.role === 'user') {
    return { role: 'user', content: messageText(message.content) };
  }
  if (message.role === 'assistant') {
    if (message.stopReason === 'error') return undefined;
    if (message.content.every(part => part.type === 'text')) {
      return { role: 'assistant', content: assistantText(message) };
    }
    return {
      role: 'assistant',
      content: message.content.map((part) => {
        if (part.type === 'text') return { type: 'text', text: part.text };
        if (part.type === 'thinking') return { type: 'reasoning', text: part.thinking };
        return {
          type: 'tool-call',
          toolCallId: part.id,
          toolName: part.name,
          input: part.arguments,
        };
      }),
    } as ModelMessage;
  }
  if (message.role === 'toolResult') {
    const structuredDetails = jsonValue(message.details);
    const hasImage = message.content.some(part => part.type === 'image');
    const output = !message.isError && structuredDetails !== undefined && !hasImage
      ? { type: 'json' as const, value: structuredDetails }
      : hasImage
        ? {
            type: 'content' as const,
            value: message.content.map(part => part.type === 'text'
              ? { type: 'text' as const, text: part.text }
              : {
                  type: 'image-data' as const,
                  data: part.data,
                  mediaType: part.mimeType,
                }),
          }
        : {
            type: message.isError ? 'error-text' as const : 'text' as const,
            value: message.content.map(part => part.type === 'text' ? part.text : '').join('\n'),
          };
    return {
      role: 'tool',
      content: [{
        type: 'tool-result',
        toolCallId: message.toolCallId,
        toolName: message.toolName,
        output,
      }],
    } as ModelMessage;
  }
  return undefined;
};

const resolvePolicySystemPrompt = (
  policyPrompt: ReturnType<Awaited<ReturnType<TurnSegmentRequest['engine']['createToolSession']>>['getSystemPrompt']>,
  fallback: string,
): string => {
  if (typeof policyPrompt === 'string') return policyPrompt;
  if (typeof policyPrompt === 'function') return policyPrompt();
  if (policyPrompt?.append) return `${fallback}\n\n${policyPrompt.append}`;
  return fallback;
};

const seedHistory = async (
  session: Awaited<ReturnType<InMemorySessionRepo['create']>>,
  request: TurnSegmentRequest,
  model: PiModelRuntime['model'],
  currentPrompt: string,
): Promise<void> => {
  const messages = request.context.messages;
  const last = messages.at(-1);
  const history = last?.role === 'user' && messageText(last.content) === currentPrompt
    ? messages.slice(0, -1)
    : messages;
  for (const message of history) {
    for (const converted of toPiHistoryMessages(message, model)) {
      await session.appendMessage(converted);
    }
  }
};

/** Embedded pi AgentHarness implementation of the Canvas turn seam. */
export function createPiAgentHarnessTurnBackend(
  options: PiAgentHarnessBackendOptions = {},
): AgentRuntime {
  const createModelRuntime = options.createModelRuntime ?? createPiModelRuntime;
  const activeHarnesses = new Map<string, AgentHarness>();
  return {
    id: 'pi-agent-harness',
    capabilities: {
      nativeCanvasTools: true,
      clarifications: 'native',
      historyFidelity: 'full',
      sessionResume: 'host',
      steering: 'native',
      compaction: 'host',
    },
    async steer(sessionId, text) {
      const harness = activeHarnesses.get(sessionId);
      if (!harness) return false;
      await harness.steer(text);
      return true;
    },
    async followUp(sessionId, text) {
      const harness = activeHarnesses.get(sessionId);
      if (!harness) return false;
      await harness.followUp(text);
      return true;
    },
    async runSegment(request: TurnSegmentRequest): Promise<TurnSegmentResult> {
      if (request.abortSignal.aborted) throw new Error('Pi AgentHarness run aborted');
      // Canvas remains the cross-runtime session SSOT. Reuse its established
      // compaction policy before hydrating pi, then persist the replacement.
      const compacted = await request.engine.compactContext(request.context, {
        provider: request.modelConfig.provider,
        model: request.configuredModel ?? request.modelConfig.model,
      });
      if (compacted.didCompact && compacted.newMessages) {
        request.replaceMessages(compacted.newMessages);
        request.context.messages = compacted.newMessages;
      }
      // Canvas stores the complete model-facing current turn in context. For
      // image attachments that envelope includes local paths and inspection
      // guidance, while `currentAsk` remains only the composer text (and may
      // be empty for an image-only turn). Prompt Pi with the host envelope and
      // exclude that same frame from seeded history so it is sent exactly once.
      const lastHostMessage = request.context.messages.at(-1);
      const currentPrompt = lastHostMessage?.role === 'user'
        ? messageText(lastHostMessage.content)
        : request.currentAsk;
      const modelRuntime = createModelRuntime(request.modelConfig);
      const repo = new InMemorySessionRepo();
      const session = await repo.create({ id: request.chatSessionId });
      await seedHistory(session, request, modelRuntime.model, currentPrompt);
      const toolSession = await request.engine.createToolSession(
        request.context,
        {
          runContext: {
            executionMode: request.executionMode,
            runId: request.observabilityRunId,
            sessionId: request.chatSessionId,
            runtimeId: 'pi-agent-harness',
          },
          model: request.configuredModel ?? request.modelConfig.model,
          systemPrompt: request.systemPrompt,
        },
      );

      let harness!: AgentHarness;
      const policyToolRegistry = () => ({
        ...request.engine.getTools(),
        ...(toolSession.getRegisteredTools?.() ?? {}),
        ...toolSession.getTools(),
      });
      const syncHarnessTools = async () => {
        const next = adaptEngineToolsForPi({
          tools: policyToolRegistry(),
          activeToolNames: Object.keys(toolSession.getTools()),
          executeTool: executePolicyTool,
          executionContext: {
            abortSignal: request.abortSignal,
            onClarificationRequest: request.onClarificationRequest,
            runContext: {
              executionMode: request.executionMode,
              runId: request.observabilityRunId,
              sessionId: request.chatSessionId,
              runtimeId: 'pi-agent-harness',
            },
          },
        });
        await harness.setTools(next.tools, next.activeToolNames);
      };
      const executePolicyTool = async (
        name: string,
        input: unknown,
        context: Parameters<typeof toolSession.executeTool>[2],
      ) => {
        let failed = false;
        try {
          return await toolSession.executeTool(name, input, context);
        } catch (error) {
          failed = true;
          throw error;
        } finally {
          try {
            await syncHarnessTools();
          } catch (syncError) {
            if (!failed) throw syncError;
          }
        }
      };
      try {
        const adapted = adaptEngineToolsForPi({
          tools: policyToolRegistry(),
          activeToolNames: Object.keys(toolSession.getTools()),
          executeTool: executePolicyTool,
          executionContext: {
            abortSignal: request.abortSignal,
            onClarificationRequest: request.onClarificationRequest,
            runContext: {
              executionMode: request.executionMode,
              runId: request.observabilityRunId,
              sessionId: request.chatSessionId,
              runtimeId: 'pi-agent-harness',
            },
          },
        });
        harness = new AgentHarness({
          session,
          models: modelRuntime.models,
          model: modelRuntime.model,
          systemPrompt: () => resolvePolicySystemPrompt(
            toolSession.getSystemPrompt(),
            request.systemPrompt,
          ),
          tools: adapted.tools,
          activeToolNames: adapted.activeToolNames,
        });
      } catch (error) {
        try {
          await toolSession.dispose('');
        } catch {
          // Preserve the setup failure as the actionable error.
        }
        throw error;
      }
      activeHarnesses.set(request.chatSessionId, harness);
      const toolCalls: CanvasAgentToolCall[] = [];
      const byId = new Map<string, CanvasAgentToolCall>();
      let currentPromptPending = true;
      const generationObserver = createPiGenerationObserver(request.observabilityRunId);
      const unsubscribe = harness.subscribe((event) => {
        generationObserver.onEvent(event);
        if (event.type === 'message_end') {
          if (
            currentPromptPending
            && event.message.role === 'user'
            && messageText(event.message.content) === currentPrompt
          ) {
            currentPromptPending = false;
          } else {
            const converted = fromPiMessage(event.message);
            if (converted) request.recordResponseMessages([converted]);
          }
        }
        if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
          request.onText(event.assistantMessageEvent.delta);
        }
        if (event.type === 'tool_execution_start') {
          const tool: CanvasAgentToolCall = {
            id: toolCalls.length + 1,
            name: event.toolName,
            args: event.args,
            status: 'running',
            toolCallId: event.toolCallId,
          };
          toolCalls.push(tool);
          byId.set(event.toolCallId, tool);
          request.onToolInputStart?.({ id: event.toolCallId, toolName: event.toolName });
          request.onToolInputDelta?.({ id: event.toolCallId, delta: JSON.stringify(event.args) });
          request.onToolInputEnd?.({ id: event.toolCallId });
          request.onToolCall?.({
            name: event.toolName,
            args: event.args,
            toolCallId: event.toolCallId,
          });
        }
        if (event.type === 'tool_execution_end') {
          // Pi wraps tool output for the model as content blocks, while
          // `details` retains the Engine tool's original structured result.
          // Persist the latter so rich chat renderers can parse visuals and
          // generated-image metadata after streaming and across reloads.
          const result = unwrapToolOutput(
            event.result?.details ?? event.result?.content ?? event.result,
          );
          const tool = byId.get(event.toolCallId);
          if (tool) {
            tool.status = event.isError ? 'failed' : 'succeeded';
            tool.result = result;
            if (event.isError) tool.error = result;
          }
          request.onToolResult?.({
            name: event.toolName,
            result,
            toolCallId: event.toolCallId,
            status: event.isError ? 'failed' : 'succeeded',
            error: event.isError ? result : undefined,
          });
        }
      });
      const abort = () => { void harness.abort(); };
      request.abortSignal.addEventListener('abort', abort, { once: true });
      let resultText = '';
      let runError: unknown;
      try {
        const response = await harness.prompt(currentPrompt);
        if (response.stopReason === 'error') {
          throw new Error(response.errorMessage || 'Pi AgentHarness provider request failed');
        }
        resultText = assistantText(response);
        return { resultText, toolCalls };
      } catch (error) {
        runError = error;
        throw error;
      } finally {
        request.abortSignal.removeEventListener('abort', abort);
        unsubscribe();
        if (activeHarnesses.get(request.chatSessionId) === harness) {
          activeHarnesses.delete(request.chatSessionId);
        }
        try {
          await toolSession.dispose(resultText);
        } catch (disposeError) {
          if (!runError) throw disposeError;
        }
      }
    },
  };
}

export const piAgentHarnessTurnBackend = createPiAgentHarnessTurnBackend();
