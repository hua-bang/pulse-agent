import { builtInPlanModePlugin, DEFAULT_MODEL, PulseAgent, type Context, type EngineOptions } from 'pulse-coder-engine';

import { BenchmarkTrace } from './benchmark-trace.js';
import { loadModelRegistry, resolveModelSpec } from '../models/model-registry.js';
import { buildModelRunOptions } from '../models/model-run-options.js';
import { createPulseCliTools } from '../tools/runtime-tools.js';
import { extractStepUsage } from '../shared/usage-metrics.js';

export interface PrintModeOptions {
  modelSpec?: string;
  isolated?: boolean;
  timeoutSeconds?: number;
  maxSteps?: number;
  maxTokens?: number;
  outputFormat?: 'text' | 'jsonl';
  traceFile?: string;
}

type TerminationReason = 'completed' | 'timeout' | 'signal' | 'token_budget' | 'max_steps' | 'error';
type MemoryIntegration = typeof import('../shared/memory-integration.js')['memoryIntegration'];

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

function agentOptions(isolated: boolean, memory?: MemoryIntegration): EngineOptions {
  if (isolated) {
    return {
      disableBuiltInPlugins: true,
      enginePlugins: { plugins: [builtInPlanModePlugin], dirs: [], scan: false },
      userConfigPlugins: { dirs: [], scan: false },
      tools: createPulseCliTools({}),
    };
  }
  return {
    enginePlugins: {
      plugins: memory ? [memory.enginePlugin] : [],
      dirs: ['.pulse-coder/engine-plugins', '.coder/engine-plugins', '~/.pulse-coder/engine-plugins', '~/.coder/engine-plugins'],
      scan: true,
    },
    userConfigPlugins: {
      dirs: ['.pulse-coder/config', '.coder/config', '~/.pulse-coder/config', '~/.coder/config'],
      scan: true,
    },
    tools: createPulseCliTools(),
  };
}

export function printModeExitCode(reason: TerminationReason, signal?: NodeJS.Signals): number {
  if (reason === 'timeout') return 124;
  if (reason === 'signal') return signal === 'SIGTERM' ? 143 : 130;
  if (reason === 'token_budget' || reason === 'max_steps') return 2;
  return reason === 'completed' ? 0 : 1;
}

function toolCallId(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object') return undefined;
  const record = payload as { toolCallId?: unknown; id?: unknown };
  const id = record.toolCallId ?? record.id;
  return typeof id === 'string' && id ? id : undefined;
}

/**
 * Non-interactive one-shot mode: `pulse-coder -p "<prompt>"`.
 * Piped stdin is appended to the prompt. Text mode keeps stdout answer-only;
 * JSONL mode and trace files expose benchmark events without session persistence.
 */
export async function runPrintMode(promptArg: string, options: PrintModeOptions = {}): Promise<number> {
  console.log = (...args: unknown[]) => console.error(...args);
  console.info = console.log;
  console.debug = console.log;

  const stdinText = process.stdin.isTTY ? '' : await readAllStdin();
  const prompt = [promptArg.trim(), stdinText.trim()].filter(Boolean).join('\n\n');
  if (!prompt) {
    console.error('Usage: pulse-coder -p "<prompt>"  (or pipe input on stdin)');
    return 1;
  }

  const outputFormat = options.outputFormat ?? 'text';
  const trace = new BenchmarkTrace({ outputFormat, traceFile: options.traceFile });
  const startedAt = Date.now();
  const ac = new AbortController();
  let terminationReason: TerminationReason = 'completed';
  let receivedSignal: NodeJS.Signals | undefined;
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  let stepCount = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cachedInputTokens = 0;
  let lastFinishReason: unknown;
  let assistantText = '';
  const toolStartedAt = new Map<string, number>();
  const emitRunEnd = (extra: Record<string, unknown>) => trace.emit({
    type: 'run_end',
    status: terminationReason,
    durationMs: Date.now() - startedAt,
    steps: stepCount,
    usage: { inputTokens, outputTokens, cachedInputTokens },
    ...extra,
  });

  const onSignal = (signal: NodeJS.Signals) => {
    receivedSignal = signal;
    terminationReason = 'signal';
    ac.abort();
  };
  const onSigint = () => onSignal('SIGINT');
  const onSigterm = () => onSignal('SIGTERM');
  process.once('SIGINT', onSigint);
  process.once('SIGTERM', onSigterm);

  if (options.timeoutSeconds) {
    timeoutHandle = setTimeout(() => {
      terminationReason = 'timeout';
      ac.abort();
    }, options.timeoutSeconds * 1000);
  }

  try {
    const registry = options.modelSpec ? await loadModelRegistry() : null;
    registry?.warnings.forEach(warning => console.error(`[models.json] ${warning}`));
    const choice = options.modelSpec && registry
      ? resolveModelSpec(options.modelSpec, registry)
      : null;
    if (choice?.apiKeyEnv && !process.env[choice.apiKeyEnv]) {
      console.error(`[models.json] ${choice.apiKeyEnv} is not set; using the provider channel fallback key`);
    }

    trace.emit({
      type: 'run_start',
      cwd: process.cwd(),
      model: choice?.model ?? DEFAULT_MODEL,
      provider: choice?.providerName ?? choice?.modelType,
      isolated: Boolean(options.isolated),
      budgets: {
        timeoutSeconds: options.timeoutSeconds,
        maxSteps: options.maxSteps,
        maxTokens: options.maxTokens,
      },
    });

    const memory = options.isolated
      ? undefined
      : (await import('../shared/memory-integration.js')).memoryIntegration;
    const agent = new PulseAgent(agentOptions(Boolean(options.isolated), memory));
    if (!options.isolated) {
      await memory?.initialize();
    }
    await agent.initialize();

    const context: Context = { messages: [{ role: 'user', content: prompt }] };
    const result = await agent.run(context, {
      abortSignal: ac.signal,
      errorMode: 'throw',
      maxSteps: options.maxSteps,
      ...buildModelRunOptions(choice),
      onText: (delta) => {
        assistantText += delta;
        if (outputFormat === 'text') {
          process.stdout.write(delta);
        }
      },
      onToolCall: toolCall => {
        const id = toolCallId(toolCall);
        if (id) toolStartedAt.set(id, Date.now());
        trace.emit({ type: 'tool_call', toolCall });
      },
      onToolResult: toolResult => {
        const id = toolCallId(toolResult);
        const toolStart = id ? toolStartedAt.get(id) : undefined;
        if (id) toolStartedAt.delete(id);
        trace.emit({
          type: 'tool_result',
          toolResult,
          ...(toolStart !== undefined ? { durationMs: Date.now() - toolStart } : {}),
        });
      },
      onCompactionStart: info => trace.emit({ type: 'compaction_start', ...info }),
      onCompacted: (messages, event) => {
        context.messages = messages;
        trace.emit({ type: 'compaction_end', event });
      },
      onResponse: messages => {
        context.messages.push(...messages);
      },
      onClarificationRequest: async request => {
        trace.emit({ type: 'clarification_unavailable', request });
        return 'Clarification is unavailable in non-interactive benchmark mode. Proceed with the best reasonable interpretation.';
      },
      onStepFinish: step => {
        stepCount += 1;
        lastFinishReason = (step as { finishReason?: unknown }).finishReason;
        const usage = extractStepUsage(step);
        inputTokens += usage.inputTokens ?? 0;
        outputTokens += usage.outputTokens ?? 0;
        cachedInputTokens += usage.cachedInputTokens ?? 0;
        trace.emit({
          type: 'step_finish',
          step: stepCount,
          finishReason: lastFinishReason,
          usage,
        });
        if (options.maxTokens && inputTokens + outputTokens >= options.maxTokens) {
          terminationReason = 'token_budget';
          ac.abort();
        }
      },
    });

    if (!assistantText && result) {
      assistantText = result;
      if (outputFormat === 'text') {
        process.stdout.write(result);
      }
    }
    if (terminationReason === 'completed' && options.maxSteps && stepCount >= options.maxSteps && lastFinishReason !== 'stop') {
      terminationReason = 'max_steps';
    }
    if (outputFormat === 'text') {
      process.stdout.write('\n');
    }

    emitRunEnd({ result: assistantText });
    return printModeExitCode(terminationReason, receivedSignal);
  } catch (error: any) {
    if (terminationReason === 'completed') {
      terminationReason = 'error';
    }
    emitRunEnd({
      error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error),
    });
    const exitCode = printModeExitCode(terminationReason, receivedSignal);
    if (terminationReason === 'error') {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
    }
    return exitCode;
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
    process.off('SIGINT', onSigint);
    process.off('SIGTERM', onSigterm);
    await trace.close();
  }
}
