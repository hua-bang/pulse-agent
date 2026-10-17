import { AsyncLocalStorage } from 'node:async_hooks';

/** Response-level timing of one LLM call, filled in by `createTimedFetch`. */
export interface LLMRequestTiming {
  /** Headers of the latest HTTP attempt arrived. */
  responseHeadersAt?: number;
  /** Provider request id of the latest attempt, when the provider sent one. */
  requestId?: string;
  /** HTTP status of the latest attempt. */
  status?: number;
  /** HTTP attempts made for this call; the SDK retries some failures itself. */
  attempts: number;
}

const currentTiming = new AsyncLocalStorage<LLMRequestTiming>();

/**
 * Run one LLM call with a timing record. Fetches the SDK makes inside this
 * async context (including its own retries) write into `timing`, so
 * concurrent runs never share a record.
 */
export const withLLMRequestTiming = <T>(timing: LLMRequestTiming, operation: () => T): T => (
  currentTiming.run(timing, operation)
);

const REQUEST_ID_HEADERS = ['request-id', 'x-request-id', 'anthropic-request-id', 'openai-request-id'];

/**
 * A `fetch` for provider SDKs that records when response headers arrive.
 * It never reads, clones or buffers the body: streaming responses pass
 * through unchanged, so memory use does not depend on response size.
 * Outside `withLLMRequestTiming` (model listing, tests) it is a plain fetch.
 */
export function createTimedFetch(base?: typeof fetch): typeof fetch {
  return (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const timing = currentTiming.getStore();
    if (timing) timing.attempts += 1;
    // Resolve the global lazily so hosts and tests that replace it still apply.
    const response = await (base ?? globalThis.fetch)(input, init);
    if (timing) {
      timing.responseHeadersAt = Date.now();
      timing.status = response.status;
      timing.requestId = REQUEST_ID_HEADERS
        .map((header) => response.headers.get(header))
        .find((value): value is string => Boolean(value)) ?? timing.requestId;
    }
    return response;
  }) as typeof fetch;
}
