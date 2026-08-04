import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { openAIResponsesApi } from '@earendil-works/pi-ai/api/openai-responses.lazy';
import {
  createModels,
  createProvider,
  type Api,
  type Model,
  type Models,
} from '@earendil-works/pi-ai';

import {
  DEFAULT_CLAUDE_BASE_URL,
  DEFAULT_OPENAI_BASE_URL,
  type ResolvedCanvasModel,
} from '../model/config';

export interface PiModelRuntime {
  models: Models;
  model: Model<Api>;
}

const providerIdFor = (config: ResolvedCanvasModel): string => {
  const suffix = (config.providerId ?? config.providerType)
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-');
  return `canvas-${suffix}`;
};

/** Build an in-memory pi provider directly from Canvas model configuration. */
export function createPiModelRuntime(config: ResolvedCanvasModel): PiModelRuntime {
  const providerId = providerIdFor(config);
  const isClaude = config.providerType === 'claude';
  // @ai-sdk/openai v3's callable provider (used by Canvas Engine) defaults
  // to the Responses API. Use the same transport here for real parity.
  const api = isClaude ? 'anthropic-messages' : 'openai-responses';
  const baseUrl = config.connection?.baseURL
    ?? (isClaude ? DEFAULT_CLAUDE_BASE_URL : DEFAULT_OPENAI_BASE_URL);
  const model: Model<Api> = {
    id: config.model,
    name: config.modelLabel,
    api,
    provider: providerId,
    baseUrl,
    reasoning: false,
    input: ['text', 'image'],
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128_000,
    maxTokens: 16_384,
    headers: config.connection?.headers,
  };
  const provider = createProvider({
    id: providerId,
    name: config.providerName ?? 'Pulse Canvas',
    baseUrl,
    headers: config.connection?.headers,
    auth: {
      apiKey: {
        name: 'Pulse Canvas model config',
        resolve: async () => ({
          auth: {
            apiKey: config.connection?.apiKey,
            baseUrl,
            headers: config.connection?.headers,
          },
          source: 'Pulse Canvas model config',
        }),
      },
    },
    models: [model],
    api: isClaude ? anthropicMessagesApi() : openAIResponsesApi(),
  });
  const models = createModels();
  models.setProvider(provider);
  return { models, model };
}
