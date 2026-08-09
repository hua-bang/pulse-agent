import { describe, expect, it } from 'vitest';

import { buildModelRunOptions, sessionPromptCacheKey } from './model-run-options.js';
import type { ModelChoice } from './model-registry.js';

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

  it('generates a prompt cache key only for opted-in providers with a session', () => {
    const optedIn: ModelChoice = {
      model: 'gpt-test',
      modelType: 'openai',
      providerName: 'sub2api',
      promptCacheKey: true,
    };

    const withSession = buildModelRunOptions(optedIn, {}, { sessionId: 'session-1' });
    // 64 hex chars of SHA-256, stable for the same provider+model+session.
    expect(withSession.promptCacheKey).toMatch(/^[0-9a-f]{64}$/);
    expect(withSession.promptCacheKey).toBe(sessionPromptCacheKey(optedIn, 'session-1'));
    expect(buildModelRunOptions(optedIn, {}, { sessionId: 'session-1' }).promptCacheKey)
      .toBe(withSession.promptCacheKey);

    // Another session or model routes to its own key.
    expect(buildModelRunOptions(optedIn, {}, { sessionId: 'session-2' }).promptCacheKey)
      .not.toBe(withSession.promptCacheKey);
    expect(sessionPromptCacheKey({ ...optedIn, model: 'other-model' }, 'session-1'))
      .not.toBe(withSession.promptCacheKey);

    // No opt-in → no key, even with a session; opt-in without a session
    // (print mode) → no key either.
    expect(buildModelRunOptions({ ...optedIn, promptCacheKey: undefined }, {}, { sessionId: 'session-1' }).promptCacheKey)
      .toBeUndefined();
    expect(buildModelRunOptions(optedIn, {}, {}).promptCacheKey).toBeUndefined();
    expect(buildModelRunOptions(optedIn, {}, { sessionId: null }).promptCacheKey).toBeUndefined();
  });
});
