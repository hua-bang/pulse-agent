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
}

export type HeadlessRunResult =
  | { ok: true; text: string }
  | { ok: false; error: string; timedOut?: boolean };

/**
 * Minimal Engine surface the runner needs — also the test seam: tests inject
 * a fake factory instead of standing up a real Engine + LLM.
 */
export interface HeadlessEngineLike {
  initialize(): Promise<void>;
  run(
    context: { messages: Array<{ role: string; content: string }> },
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
  const timer = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const engine = engineFactory({
      disableBuiltInPlugins: true,
      enginePlugins: { plugins: [] },
      builtInTools: {},
      tools: options.tools ?? {},
    });
    await engine.initialize();

    const modelConfig = await resolveCanvasModel();
    const text = await engine.run(
      { messages: [{ role: 'user', content: options.prompt }] },
      {
        provider: modelConfig.provider,
        model: modelConfig.model,
        modelType: modelConfig.modelType,
        systemPrompt: options.systemPrompt,
        maxSteps: options.maxSteps ?? DEFAULT_MAX_STEPS,
        abortSignal: abortController.signal,
      },
    );
    return { ok: true, text: text || '' };
  } catch (err) {
    const timedOut = abortController.signal.aborted;
    const error = err instanceof Error ? err.message : String(err);
    console.warn(`[headless-run] ${options.label} failed${timedOut ? ' (timeout)' : ''}:`, error);
    return { ok: false, error, timedOut: timedOut || undefined };
  } finally {
    clearTimeout(timer);
  }
}
