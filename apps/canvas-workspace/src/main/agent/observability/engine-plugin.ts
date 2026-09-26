import { publishAgentTraceEvent } from '../../../plugins/main';
import type { AgentTraceGenerationTimings, AgentTraceGenerationUsage } from '../../../shared/agent-observability';

interface RunState {
  runId: string;
  owner: 'engine' | 'pi';
  generationCounter: number;
  activeGenerationId?: string;
  toolIdsByName: Map<string, string[]>;
}

const stateByContext = new WeakMap<object, RunState>();

const runtimeOwner = (runtimeId: unknown): 'engine' | 'pi' =>
  runtimeId === 'pi-agent-harness' ? 'pi' : 'engine';

const contextObject = (value: unknown): object | undefined =>
  value != null && typeof value === 'object' ? value : undefined;

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const withDefinedValues = <T extends object>(value: T): T | undefined => {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) as T : undefined;
};

/** Engine `afterLLMCall` timings, renamed to the trace contract. */
export const generationTimings = (timings: any): AgentTraceGenerationTimings | undefined => withDefinedValues({
  requestStartedAt: finiteNumber(timings?.requestStartAt),
  firstChunkAt: finiteNumber(timings?.firstChunkAt),
  firstTextAt: finiteNumber(timings?.firstTextAt),
  lastChunkAt: finiteNumber(timings?.lastChunkAt),
});

/** AI SDK v6 usage (nested details) with the flat legacy fields as fallback. */
export const generationUsage = (usage: any): AgentTraceGenerationUsage | undefined => withDefinedValues({
  inputTokens: finiteNumber(usage?.inputTokens),
  cachedInputTokens: finiteNumber(usage?.inputTokenDetails?.cacheReadTokens ?? usage?.cachedInputTokens),
  outputTokens: finiteNumber(usage?.outputTokens),
  reasoningTokens: finiteNumber(usage?.outputTokenDetails?.reasoningTokens ?? usage?.reasoningTokens),
});

export const canvasAgentObservabilityEnginePlugin = {
  name: 'canvas-agent-observability',
  version: '1.0.0',
  async initialize(ctx: any) {
    ctx.registerHook('beforeRun', (input: any) => {
      const context = contextObject(input.context);
      const runId = typeof input.runContext?.runId === 'string'
        ? input.runContext.runId
        : undefined;
      if (!context || !runId) return;
      stateByContext.set(context, {
        runId,
        owner: runtimeOwner(input.runContext?.runtimeId),
        generationCounter: 0,
        toolIdsByName: new Map(),
      });
    });

    ctx.registerHook('beforeLLMCall', (input: any) => {
      const context = contextObject(input.context);
      const state = context ? stateByContext.get(context) : undefined;
      // Pi uses beforeLLMCall to refresh its policy-visible tool table. Its
      // actual provider request lives in AgentHarness and is recorded by the
      // Pi adapter, so treating this hook as a generation would be false.
      if (!state || state.owner === 'pi') return;
      const generationId = `${state.runId}:generation:${++state.generationCounter}`;
      state.activeGenerationId = generationId;
      publishAgentTraceEvent({
        type: 'generation.started', runId: state.runId,
        timestamp: Date.now(), generationId, owner: state.owner,
        model: typeof input.model === 'string' ? input.model : undefined,
      });
    });

    ctx.registerHook('afterLLMCall', (input: any) => {
      const context = contextObject(input.context);
      const state = context ? stateByContext.get(context) : undefined;
      if (!state?.activeGenerationId || state.owner === 'pi') return;
      const generationId = state.activeGenerationId;
      state.activeGenerationId = undefined;
      publishAgentTraceEvent({
        type: 'generation.completed', runId: state.runId,
        timestamp: Date.now(), generationId, owner: state.owner,
        finishReason: typeof input.finishReason === 'string' ? input.finishReason : undefined,
        timings: generationTimings(input.timings),
        usage: generationUsage(input.usage),
      });
    });

    ctx.registerHook('beforeToolCall', (input: any) => {
      const context = contextObject(input.context);
      const state = context ? stateByContext.get(context) : undefined;
      if (!state || typeof input.name !== 'string') return;
      const toolCallId = typeof input.toolContext?.toolCallId === 'string'
        ? input.toolContext.toolCallId
        : `${state.runId}:tool:${input.name}:${Date.now()}`;
      const ids = state.toolIdsByName.get(input.name) ?? [];
      ids.push(toolCallId);
      state.toolIdsByName.set(input.name, ids);
      publishAgentTraceEvent({
        type: 'tool.started', runId: state.runId, timestamp: Date.now(),
        toolCallId, toolName: input.name, owner: state.owner,
      });
    });

    ctx.registerHook('afterToolCall', (input: any) => {
      const context = contextObject(input.context);
      const state = context ? stateByContext.get(context) : undefined;
      if (!state || typeof input.name !== 'string') return;
      const ids = state.toolIdsByName.get(input.name) ?? [];
      const toolCallId = ids.shift() ?? `${state.runId}:tool:${input.name}:unknown`;
      if (ids.length === 0) state.toolIdsByName.delete(input.name);
      publishAgentTraceEvent({
        type: 'tool.completed', runId: state.runId, timestamp: Date.now(),
        toolCallId, toolName: input.name, owner: state.owner, status: 'done',
      });
    });

    ctx.registerHook('onCompacted', (input: any) => {
      const context = contextObject(input.context);
      const state = context ? stateByContext.get(context) : undefined;
      if (!state) return;
      publishAgentTraceEvent({
        type: 'context.compacted', runId: state.runId,
        timestamp: Date.now(), owner: state.owner,
        beforeTokens: input.event?.beforeEstimatedTokens,
        afterTokens: input.event?.afterEstimatedTokens,
      });
    });

    ctx.registerHook('afterRun', (input: any) => {
      const context = contextObject(input.context);
      if (context) stateByContext.delete(context);
    });
  },
};
