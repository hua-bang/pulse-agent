import { hasAgentTraceSubscribers, publishAgentTraceEvent } from '../../../plugins/main';
import { promptFingerprint } from './prompt-fingerprint';
import type { AgentTraceGenerationTimings, AgentTraceGenerationUsage } from '../../../shared/agent-observability';

interface RunState {
  runId: string;
  owner: 'engine' | 'pi';
  generationCounter: number;
  activeGenerationId?: string;
  toolCounter: number;
  /** Open tool calls: toolCallId -> tool name. */
  openTools: Map<string, string>;
}

const PLUGIN_NAME = 'canvas-agent-observability';
/** Hook calls below this are noise on the timeline and are not recorded. */
const HOOK_TRACE_MIN_MS = 10;
const ERROR_PREVIEW_CHARS = 200;

const stateByContext = new WeakMap<object, RunState>();

const runtimeOwner = (runtimeId: unknown): 'engine' | 'pi' =>
  runtimeId === 'pi-agent-harness' ? 'pi' : 'engine';

const contextObject = (value: unknown): object | undefined =>
  value != null && typeof value === 'object' ? value : undefined;

/** Codemode nests script calls under the outer tool call that ran the script. */
const parentToolCall = (toolContext: any): { parentToolCallId?: string } =>
  typeof toolContext?.parentToolCallId === 'string'
    ? { parentToolCallId: toolContext.parentToolCallId }
    : {};

const finiteNumber = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const withDefinedValues = <T extends object>(value: T): T | undefined => {
  const entries = Object.entries(value).filter(([, entry]) => entry !== undefined);
  return entries.length ? Object.fromEntries(entries) as T : undefined;
};

/** Engine `afterLLMCall` timings, renamed to the trace contract. */
export const generationTimings = (timings: any): AgentTraceGenerationTimings | undefined => withDefinedValues({
  requestStartedAt: finiteNumber(timings?.requestStartAt),
  responseHeadersAt: finiteNumber(timings?.responseHeadersAt),
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

const errorPreview = (error: unknown): string | undefined => {
  if (error === undefined) return undefined;
  const message = error instanceof Error ? error.message : String(error);
  return message.length > ERROR_PREVIEW_CHARS ? `${message.slice(0, ERROR_PREVIEW_CHARS)}…` : message;
};

const retryInfo = (retry: any): { attempt: number; delayMs: number } | undefined => {
  const attempt = finiteNumber(retry?.attempt);
  const delayMs = finiteNumber(retry?.delayMs);
  return attempt !== undefined && delayMs !== undefined ? { attempt, delayMs } : undefined;
};

const runStateOf = (input: any): RunState | undefined => {
  const context = contextObject(input?.context);
  return context ? stateByContext.get(context) : undefined;
};

/**
 * Match a tool end with its start by toolCallId. Parallel calls of one tool
 * finish in any order, so pairing by name would swap their durations. The
 * name fallback only covers runtimes that pass no id.
 */
const closeToolCall = (state: RunState, name: string, toolContext: any): string => {
  const id = typeof toolContext?.toolCallId === 'string' ? toolContext.toolCallId : undefined;
  if (id && state.openTools.delete(id)) return id;
  for (const [openId, openName] of state.openTools) {
    if (openName !== name) continue;
    state.openTools.delete(openId);
    return openId;
  }
  return id ?? `${state.runId}:tool:${name}:unknown`;
};

const publishToolCompleted = (input: any, status: 'done' | 'error') => {
  const state = runStateOf(input);
  if (!state || typeof input.name !== 'string') return;
  publishAgentTraceEvent({
    type: 'tool.completed', runId: state.runId, timestamp: Date.now(),
    toolCallId: closeToolCall(state, input.name, input.toolContext),
    toolName: input.name, owner: state.owner, status,
    ...parentToolCall(input.toolContext),
  });
};

export const canvasAgentObservabilityEnginePlugin = {
  name: PLUGIN_NAME,
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
        toolCounter: 0,
        openTools: new Map(),
      });
    });

    ctx.registerHook('beforeLLMCall', (input: any) => {
      const state = runStateOf(input);
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
        // Tools as filtered by earlier beforeLLMCall hooks (tool search).
        ...(hasAgentTraceSubscribers() ? { prompt: promptFingerprint(input.systemPrompt, input.tools) } : {}),
      });
    });

    ctx.registerHook('afterLLMCall', (input: any) => {
      const state = runStateOf(input);
      if (!state?.activeGenerationId || state.owner === 'pi') return;
      const generationId = state.activeGenerationId;
      state.activeGenerationId = undefined;
      publishAgentTraceEvent({
        type: 'generation.completed', runId: state.runId,
        timestamp: Date.now(), generationId, owner: state.owner,
        finishReason: typeof input.finishReason === 'string' ? input.finishReason : undefined,
        timings: generationTimings(input.timings),
        usage: generationUsage(input.usage),
        error: errorPreview(input.error),
        requestId: typeof input.requestId === 'string' ? input.requestId : undefined,
        httpAttempts: finiteNumber(input.timings?.httpAttempts),
        retry: retryInfo(input.retry),
      });
    });

    ctx.registerHook('beforeToolCall', (input: any) => {
      const state = runStateOf(input);
      if (!state || typeof input.name !== 'string') return;
      const toolCallId = typeof input.toolContext?.toolCallId === 'string'
        ? input.toolContext.toolCallId
        : `${state.runId}:tool:${input.name}:${++state.toolCounter}`;
      state.openTools.set(toolCallId, input.name);
      publishAgentTraceEvent({
        type: 'tool.started', runId: state.runId, timestamp: Date.now(),
        toolCallId, toolName: input.name, owner: state.owner,
        ...parentToolCall(input.toolContext),
      });
    });

    ctx.registerHook('afterToolCall', (input: any) => publishToolCompleted(input, 'done'));
    // Without this, a thrown tool left its span open until the run ended.
    ctx.registerHook('onToolError', (input: any) => publishToolCompleted(input, 'error'));

    ctx.registerHook('onCompacted', (input: any) => {
      const state = runStateOf(input);
      if (!state) return;
      const trigger = input.event?.trigger;
      publishAgentTraceEvent({
        type: 'context.compacted', runId: state.runId,
        timestamp: Date.now(), owner: state.owner,
        beforeTokens: input.event?.beforeEstimatedTokens,
        afterTokens: input.event?.afterEstimatedTokens,
        trigger: trigger === 'pre-loop' || trigger === 'length-retry' ? trigger : undefined,
        startedAt: finiteNumber(input.event?.startedAt),
        finishedAt: finiteNumber(input.event?.finishedAt),
      });
    });

    // PluginManager times every hook call of every plugin. Record the slow
    // ones so plugin overhead shows on the timeline instead of as a gap.
    ctx.events?.on?.('hookTiming', (timing: any) => {
      if (timing?.pluginName === PLUGIN_NAME) return;
      const durationMs = finiteNumber(timing?.durationMs);
      const startedAt = finiteNumber(timing?.at);
      if (durationMs === undefined || startedAt === undefined || durationMs < HOOK_TRACE_MIN_MS) return;
      const state = runStateOf(timing);
      if (!state || typeof timing.hookName !== 'string' || typeof timing.pluginName !== 'string') return;
      publishAgentTraceEvent({
        type: 'hook.completed', runId: state.runId, timestamp: startedAt + durationMs,
        owner: state.owner, hookName: timing.hookName, pluginName: timing.pluginName,
        startedAt, finishedAt: startedAt + durationMs,
      });
    });

    ctx.registerHook('afterRun', (input: any) => {
      const context = contextObject(input.context);
      if (context) stateByContext.delete(context);
    });
  },
};
