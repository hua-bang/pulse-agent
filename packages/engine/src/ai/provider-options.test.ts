import { describe, expect, it } from 'vitest';

import { resolveProviderOptions } from './index.js';

describe('resolveProviderOptions', () => {
  it('sends promptCacheKey only on the OpenAI-compatible path', () => {
    const key = 'a'.repeat(64);
    const withKey = resolveProviderOptions(undefined, key) as Record<string, any>;
    expect(withKey.openai.promptCacheKey).toBe(key);
    // The base OpenAI options must survive the merge.
    expect(withKey.openai.store).toBe(false);
  });

  it('drops promptCacheKey entirely on the Claude path', () => {
    const claude = resolveProviderOptions('claude', 'b'.repeat(64)) as Record<string, any>;
    expect(JSON.stringify(claude)).not.toContain('promptCacheKey');
    // Claude keeps its cacheControl mechanism.
    expect(claude.anthropic.cacheControl.type).toBe('ephemeral');
  });

  it('leaves requests untouched when no key is provided', () => {
    const plain = resolveProviderOptions('openai') as Record<string, any>;
    expect(plain.openai.promptCacheKey).toBeUndefined();
    expect(plain.openai.store).toBe(false);
  });
});
