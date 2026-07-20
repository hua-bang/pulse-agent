/**
 * One-shot background Engine run — the base capability for scheduled agent
 * tasks (first consumer: the periodic memory report).
 *
 * Differences from a CanvasAgent chat turn, all deliberate:
 * - No chat window, no session store: nothing is persisted to chat history.
 * - Structurally read-only: `builtInTools: {}` disables every engine built-in
 *   (bash/write/edit/...), so a headless task can only call the tools the
 *   caller passes in. Callers must pass read-only tools; write paths (like
 *   memory adoption) stay in interactive chat where the user confirms them.
 * - Bounded: maxSteps + wall-clock timeout; failures return a result object
 *   instead of throwing, so schedulers can log-and-skip.
 */

import { Engine } from 'pulse-coder-engine';
import { resolveCanvasModel } from './model/config';
import type { CanvasTool } from './tools/types';

const DEFAULT_MAX_STEPS = 12;
const DEFAULT_TIMEOUT_MS = 5 * 60_000;

export interface HeadlessRunOptions {
  /** Short identifier used in logs, e.g. "memory-report". */
  label: string;
  systemPrompt: string;
  /** The single user-turn instruction for this run. */
  prompt: string;
  /** Read-only tools the task may call. Default: none. */
  tools?: Record<string, CanvasTool>;
  maxSteps?: number;
  timeoutMs?: number;
  /** Fired when the model starts a tool call (progress reporting). */
  onToolCall?: (toolName: string) => void;
  /** Fired once when the model starts emitting final text. */
  onTextStart?: () => void;
  /** External cancellation (e.g. a user cancel button). */
  abortSignal?: AbortSignal;
}

export type HeadlessRunResult =
  | { ok: true; text: string }
  | { ok: false; error: string; timedOut?: boolean; cancelled?: boolean };

/**
 * Minimal Engine surface the runner needs — also the test seam: tests inject
 * a fake factory instead of standing up a real Engine + LLM.
 */
export interface HeadlessEngineLike {
  initialize(): Promise<void>;
  run(
    context: { messages: unknown[] },
    options: Record<string, unknown>,
  ): Promise<string>;
}

export type HeadlessEngineFactory = (config: {
  disableBuiltInPlugins: true;
  enginePlugins: { plugins: never[] };
  builtInTools: Record<string, never>;
  tools: Record<string, CanvasTool>;
}) => HeadlessEngineLike;

const defaultEngineFactory: HeadlessEngineFactory = (config) => new Engine(config as never) as HeadlessEngineLike;

export async function runHeadlessAgentTask(
  options: HeadlessRunOptions,
  engineFactory: HeadlessEngineFactory = defaultEngineFactory,
): Promise<HeadlessRunResult> {
  const abortController = new AbortController();
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    abortController.abort();
  }, timeoutMs);
  const onExternalAbort = (): void => abortController.abort();
  options.abortSignal?.addEventListener('abort', onExternalAbort);
  if (options.abortSignal?.aborted) abortController.abort();

  try {
    const engine = engineFactory({
      disableBuiltInPlugins: true,
      enginePlugins: { plugins: [] },
      builtInTools: {},
      tools: options.tools ?? {},
    });
    await engine.initialize();

    const modelConfig = await resolveCanvasModel();
    let textStarted = false;
    // CONTRACT (mirrors canvas-agent): the engine loop does NOT accumulate
    // step messages itself — it hands them to onResponse and the caller owns
    // the mutable context. Without this, every loop iteration re-sends only
    // the original user message, the model never sees its own tool calls or
    // their results, and it repeats the same call until maxSteps/timeout.
    const messages: unknown[] = [{ role: 'user', content: options.prompt }];
    const runContext = { messages };
    const text = await engine.run(
      runContext,
      {
        provider: modelConfig.provider,
        model: modelConfig.model,
        modelType: modelConfig.modelType,
        systemPrompt: options.systemPrompt,
        maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
        abortSignal: abortController.signal,
        onResponse: (stepMessages: unknown[]) => {
          for (const message of stepMessages) runContext.messages.push(message);
        },
        onCompacted: (newMessages: unknown[]) => {
          runContext.messages = newMessages;
        },
        ...(options.onToolCall
          ? { onToolCall: (chunk: { toolName?: string }) => options.onToolCall?.(chunk.toolName ?? '') }
          : {}),
        ...(options.onTextStart
          ? {
              onText: () => {
                if (textStarted) return;
                textStarted = true;
                options.onTextStart?.();
              },
            }
          : {}),
      },
    );
    return { ok: true, text: text || '' };
  } catch (err) {
    const cancelled = Boolean(options.abortSignal?.aborted) && !timedOut;
    const error = err instanceof Error ? err.message : String(err);
    console.warn(
      `[headless-run] ${options.label} ${cancelled ? 'cancelled' : `failed${timedOut ? ' (timeout)' : ''}`}:`,
      error,
    );
    return { ok: false, error, timedOut: timedOut || undefined, cancelled: cancelled || undefined };
  } finally {
    clearTimeout(timer);
    options.abortSignal?.removeEventListener('abort', onExternalAbort);
  }
}
