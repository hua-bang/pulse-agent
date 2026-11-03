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
import { resolveCanvasModel } from '../../models/config';
import { createGlobalCanvasTools } from '../tools/index';
import type { CanvasTool } from '../tools/types';

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

/**
 * The headless toolset is the safe baseline returned by
 * `createGlobalCanvasTools()` (the non-interactive global boundary), with
 * exactly two categories of exceptions:
 * - `user_ask`: an unattended run has no user to answer.
 * - memory writes (`memory_save`/`memory_forget`/`memory_adopt`): the memory
 *   product's invariant is that writes happen only with the user's explicit
 *   confirmation in chat — a background run must not hold a write path.
 */
export const HEADLESS_EXCLUDED_TOOLS = new Set([
  'user_ask',
  'memory_save',
  'memory_forget',
  'memory_adopt',
]);

/** Global-chat toolset aligned for unattended use (see HEADLESS_EXCLUDED_TOOLS). */
export function createHeadlessCanvasTools(): Record<string, CanvasTool> {
  const tools: Record<string, CanvasTool> = {};
  for (const [name, tool] of Object.entries(createGlobalCanvasTools())) {
    if (!HEADLESS_EXCLUDED_TOOLS.has(name)) tools[name] = tool;
  }
  return tools;
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
        contextWindowTokens: modelConfig.contextWindowTokens,
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

// ── Plugin entry points (`MainCtx.agent`) ─────────────────────────────────

const PLUGIN_RUN_MAX_STEPS = 30;

/**
 * Plugin runs get an allowlist, not the headless toolset as is: that set
 * still holds writes (scheduled tasks, chat roles) and tools that change or
 * capture the user's screen (Dock tabs, screen capture, browser history).
 * New tools stay out until they are added here.
 */
export const PLUGIN_RUN_TOOL_NAMES = new Set([
  'workspace_list',
  'canvas_read_context',
  'canvas_read_node',
  'canvas_read_layout',
  'canvas_search_nodes',
  'canvas_list_edges',
  'workspace_node_list',
  'workspace_node_get',
  'knowledge_search_nodes',
  'knowledge_list_nodes',
  'knowledge_list_tags',
  'knowledge_read_node',
  'session_search',
  'session_summary',
  'memory_list',
  'scheduled_task_list',
  'chat_role_list',
]);

function createPluginRunTools(): Record<string, CanvasTool> {
  return Object.fromEntries(
    Object.entries(createHeadlessCanvasTools()).filter(([name]) => PLUGIN_RUN_TOOL_NAMES.has(name)),
  );
}
const PLUGIN_COMPLETE_TIMEOUT_MS = 2 * 60_000;

const PLUGIN_COMPLETE_SYSTEM = 'You are a text helper inside a Pulse Canvas plugin. '
  + 'Answer the request directly. Return only the requested output.';

const PLUGIN_RUN_SYSTEM = 'You are the Pulse Canvas agent, running a background task for a plugin. '
  + 'No user is watching this run, so do not ask questions. You can read canvases, knowledge, '
  + 'sessions, and memory through your tools; you cannot change them. Finish with the answer the '
  + 'plugin asked for.';

export interface PluginAgentCallOptions {
  /** Extra system instructions from the plugin. */
  system?: string;
  timeoutMs?: number;
  /** `run` only: upper bound on model steps. */
  maxSteps?: number;
}

function pluginSystemPrompt(base: string, extra?: string): string {
  return extra?.trim() ? `${base}\n\n${extra.trim()}` : base;
}

/** One model call with the user's current model and no tools. Nothing reaches chat history. */
export function completeForPlugin(
  pluginId: string,
  prompt: string,
  options: PluginAgentCallOptions = {},
  engineFactory?: HeadlessEngineFactory,
): Promise<HeadlessRunResult> {
  return runHeadlessAgentTask({
    label: `plugin:${pluginId}:complete`,
    systemPrompt: pluginSystemPrompt(PLUGIN_COMPLETE_SYSTEM, options.system),
    prompt,
    maxSteps: 1,
    timeoutMs: options.timeoutMs ?? PLUGIN_COMPLETE_TIMEOUT_MS,
  }, ...(engineFactory ? [engineFactory] : []));
}

/**
 * A full agent loop in an isolated background run with read-only tools
 * (`PLUGIN_RUN_TOOL_NAMES`). It has no session store, so nothing reaches the
 * user's chat history, and it cannot change app state.
 */
export function runForPlugin(
  pluginId: string,
  prompt: string,
  options: PluginAgentCallOptions = {},
  engineFactory?: HeadlessEngineFactory,
): Promise<HeadlessRunResult> {
  return runHeadlessAgentTask({
    label: `plugin:${pluginId}:run`,
    systemPrompt: pluginSystemPrompt(PLUGIN_RUN_SYSTEM, options.system),
    prompt,
    tools: createPluginRunTools(),
    maxSteps: options.maxSteps ?? PLUGIN_RUN_MAX_STEPS,
    timeoutMs: options.timeoutMs,
  }, ...(engineFactory ? [engineFactory] : []));
}
