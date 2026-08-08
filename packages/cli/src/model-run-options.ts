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
 * Shared by print, Ink, and readline hosts so provider wiring and context-window
 * behavior cannot drift. The injectable env keeps this conversion deterministic
 * in tests while production callers use process.env.
 */
export function buildModelRunOptions(
  choice: ModelChoice | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
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
