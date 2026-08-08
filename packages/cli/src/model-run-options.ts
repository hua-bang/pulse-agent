import { buildProvider, type LLMProviderFactory } from 'pulse-coder-engine';

import type { ModelChoice } from './model-registry.js';

export interface ModelRunOptions {
  model?: string;
  modelType?: 'openai' | 'claude';
  contextWindowTokens?: number;
  provider?: LLMProviderFactory;
}

/** Single conversion path from models.json choices to Engine run options. */
export function buildModelRunOptions(
  choice: ModelChoice | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): ModelRunOptions {
  if (!choice) {
    return {};
  }
  const needsCustomConnection = Boolean(choice.baseUrl || choice.apiKeyEnv);
  return {
    model: choice.model,
    ...(choice.modelType ? { modelType: choice.modelType } : {}),
    ...(choice.contextWindow ? { contextWindowTokens: choice.contextWindow } : {}),
    ...(needsCustomConnection ? {
      provider: buildProvider(choice.modelType ?? 'openai', {
        ...(choice.baseUrl ? { baseURL: choice.baseUrl } : {}),
        ...(choice.apiKeyEnv && env[choice.apiKeyEnv]
          ? { apiKey: env[choice.apiKeyEnv] }
          : {}),
      }),
    } : {}),
  };
}
