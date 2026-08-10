import { describe, expect, it } from 'vitest';

import { extractStepUsage } from './usage-metrics.js';

describe('extractStepUsage', () => {
  it('reads the standard ai@6 usage fields', () => {
    expect(extractStepUsage({
      usage: { inputTokens: 1500, outputTokens: 200, cachedInputTokens: 1230 },
    })).toEqual({ inputTokens: 1500, outputTokens: 200, cachedInputTokens: 1230 });
  });

  it('keeps cachedInputTokens undefined when the provider does not report it', () => {
    expect(extractStepUsage({ usage: { inputTokens: 100, outputTokens: 10 } })).toEqual({
      inputTokens: 100,
      outputTokens: 10,
      cachedInputTokens: undefined,
    });
  });

  it('falls back to providerMetadata cache fields (deepseek/openai spellings)', () => {
    expect(extractStepUsage({
      usage: { inputTokens: 100, outputTokens: 10 },
      providerMetadata: { openai: { prompt_cache_hit_tokens: 64 } },
    }).cachedInputTokens).toBe(64);

    expect(extractStepUsage({
      usage: { inputTokens: 100 },
      providerMetadata: { anthropic: { usage: { cache_read_input_tokens: 80 } } },
    }).cachedInputTokens).toBe(80);
  });

  it('ignores malformed values', () => {
    expect(extractStepUsage({
      usage: { inputTokens: 'many', cachedInputTokens: -5 },
      providerMetadata: { p: { cached_tokens: 'NaN' } },
    })).toEqual({ inputTokens: undefined, outputTokens: undefined, cachedInputTokens: undefined });
    expect(extractStepUsage(null)).toEqual({});
  });
});
