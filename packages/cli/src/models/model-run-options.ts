import { createHash } from 'crypto';

import { buildProvider, type LLMProviderFactory } from 'pulse-coder-engine';

import { loadModelRegistry } from './model-registry.js';
import { resolveModelSpec, type ModelChoice } from './model-spec.js';

export interface ModelRunOptions {
  model?: string;
  modelType?: 'openai' | 'claude';
  contextWindowTokens?: number;
  provider?: LLMProviderFactory;
  /** Stable per-session cache-routing key (see sessionPromptCacheKey). */
  promptCacheKey?: string;
}

/**
 * Stable cache-routing key for one session on one provider+model: 64 hex chars
 * of SHA-256 over `provider:model:sessionId`.
 *
 * Gateways with several upstream accounts/cache nodes route by
 * `prompt_cache_key` — without one, identical prompt prefixes still land on
 * different cache nodes and the hit rate collapses. The key is routing
 * AFFINITY, not cache isolation: `/clear` keeps the session and therefore the
 * key (rotating it buys nothing), while `/new`, `/resume` and model switches
 * change an input and yield the session's own key naturally.
 */
export function sessionPromptCacheKey(choice: ModelChoice, sessionId: string): string {
  return createHash('sha256')
    .update(`${choice.providerName ?? choice.modelType ?? ''}:${choice.model}:${sessionId}`)
    .digest('hex');
}

/**
 * Turns a resolved registry choice into engine run options.
 *
 * Shared by print, Ink, and readline hosts so provider wiring and context-window
 * behavior cannot drift. The injectable env keeps this conversion deterministic
 * in tests while production callers use process.env.
 */
export function buildModelRunOptions(
  choice: ModelChoice | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
  run: { sessionId?: string | null } = {},
): ModelRunOptions {
  if (!choice) {
    return {};
  }

  const needsCustomConnection = Boolean(choice.baseUrl || choice.apiKeyEnv);
  const apiKey = choice.apiKeyEnv ? env[choice.apiKeyEnv] : undefined;
  return {
    model: choice.model,
    ...(choice.modelType ? { modelType: choice.modelType } : {}),
    ...(choice.contextWindow ? { contextWindowTokens: choice.contextWindow } : {}),
    // Strictly opt-in per provider, and only when a session exists to anchor
    // the key — print mode and session-less runs stay untouched. The engine
    // additionally drops the key on the Claude path.
    ...(choice.promptCacheKey === true && run.sessionId
      ? { promptCacheKey: sessionPromptCacheKey(choice, run.sessionId) }
      : {}),
    ...(needsCustomConnection ? {
      provider: buildProvider(choice.modelType ?? 'openai', {
        ...(choice.baseUrl ? { baseURL: choice.baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
      }),
    } : {}),
  };
}

/** Resolve a CLI model spec against the merged home+project registry. */
export async function resolveModelChoice(
  spec: string | undefined,
  onWarning?: (warning: string) => void,
): Promise<ModelChoice | null> {
  if (!spec?.trim()) {
    return null;
  }
  const registry = await loadModelRegistry();
  registry.warnings.forEach(warning => onWarning?.(`[models.json] ${warning}`));
  return resolveModelSpec(spec, registry);
}
