import { buildProvider, type LLMProviderFactory } from 'pulse-coder-engine';

import { loadModelRegistry, resolveModelSpec, type ModelChoice } from './model-registry.js';

export interface ModelRunOptions {
  model?: string;
  modelType?: 'openai' | 'claude';
  contextWindowTokens?: number;
  provider?: LLMProviderFactory;
}

/**
 * Turns a resolved registry choice into engine run options.
 *
 * Shared by BOTH hosts: `model-registry.ts` stays engine-free (and fast to test),
 * while the provider wiring lives here so the Ink controller and the readline
 * fallback cannot drift on how a provider-bound model reaches the engine.
 *
 * `contextWindowTokens` must reach the run options AND `compactContext`, or the
 * status line's ctx% denominator and the engine's compaction trigger diverge.
 */
export function buildModelRunOptions(choice: ModelChoice | null | undefined): ModelRunOptions {
  if (!choice) {
    return {};
  }

  const needsCustomConnection = Boolean(choice.baseUrl || choice.apiKeyEnv);
  const apiKey = choice.apiKeyEnv ? process.env[choice.apiKeyEnv] : undefined;

  return {
    model: choice.model,
    ...(choice.modelType ? { modelType: choice.modelType } : {}),
    ...(choice.contextWindow ? { contextWindowTokens: choice.contextWindow } : {}),
    ...(needsCustomConnection ? {
      provider: buildProvider(choice.modelType ?? 'openai', {
        ...(choice.baseUrl ? { baseURL: choice.baseUrl } : {}),
        ...(apiKey ? { apiKey } : {}),
      }),
    } : {}),
  };
}

/**
 * Resolves a `--model`/`/model` spec against the merged home+project registry.
 *
 * Returns null for an empty spec. A spec that matches nothing in the registry
 * still resolves (to a bare model id) — that leniency is intentional for
 * ad-hoc ids; only the startup-restore path wants strictness.
 */
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
