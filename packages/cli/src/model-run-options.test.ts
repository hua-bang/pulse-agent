import { describe, expect, it } from 'vitest';

import { buildModelRunOptions } from './model-run-options.js';

describe('buildModelRunOptions', () => {
  it('keeps model and context window aligned', () => {
    expect(buildModelRunOptions({
      model: 'gpt-test',
      modelType: 'openai',
      contextWindow: 128000,
    })).toMatchObject({
      model: 'gpt-test',
      modelType: 'openai',
      contextWindowTokens: 128000,
    });
  });

  it('builds a provider factory for registry-bound connections', () => {
    expect(buildModelRunOptions({
      model: 'custom-model',
      modelType: 'openai',
      baseUrl: 'https://example.invalid/v1',
      apiKeyEnv: 'CUSTOM_MODEL_KEY',
    }, { CUSTOM_MODEL_KEY: 'secret' }).provider).toBeTypeOf('function');
  });
});
