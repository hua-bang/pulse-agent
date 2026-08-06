export interface StepUsageMetrics {
  inputTokens?: number;
  outputTokens?: number;
  /** Prompt-cache hit tokens for this step; undefined when the provider does not report caching. */
  cachedInputTokens?: number;
}

const CACHED_TOKEN_KEYS = [
  'cachedInputTokens',
  'cached_tokens',
  'cachedTokens',
  'cacheReadInputTokens',
  'cache_read_input_tokens',
  'prompt_cache_hit_tokens',
];

/**
 * Normalizes an AI SDK StepResult's usage numbers. `usage.cachedInputTokens`
 * is the standard field (ai@6); some providers only expose cache hits inside
 * `providerMetadata`, so scan known key spellings there as a fallback.
 */
export function extractStepUsage(step: unknown): StepUsageMetrics {
  const record = asRecord(step);
  if (!record) {
    return {};
  }

  const usage = asRecord(record.usage);
  const metrics: StepUsageMetrics = {
    inputTokens: asTokenCount(usage?.inputTokens),
    outputTokens: asTokenCount(usage?.outputTokens),
    cachedInputTokens: asTokenCount(usage?.cachedInputTokens),
  };

  if (metrics.cachedInputTokens === undefined) {
    metrics.cachedInputTokens = findCachedTokensInMetadata(record.providerMetadata);
  }

  return metrics;
}

function findCachedTokensInMetadata(providerMetadata: unknown): number | undefined {
  const metadata = asRecord(providerMetadata);
  if (!metadata) {
    return undefined;
  }

  for (const providerEntry of Object.values(metadata)) {
    const provider = asRecord(providerEntry);
    if (!provider) {
      continue;
    }
    for (const key of CACHED_TOKEN_KEYS) {
      const value = asTokenCount(provider[key]);
      if (value !== undefined) {
        return value;
      }
    }
    const nestedUsage = asRecord(provider.usage);
    if (nestedUsage) {
      for (const key of CACHED_TOKEN_KEYS) {
        const value = asTokenCount(nestedUsage[key]);
        if (value !== undefined) {
          return value;
        }
      }
    }
  }
  return undefined;
}

function asTokenCount(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}
