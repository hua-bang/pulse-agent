import { describe, expect, it } from 'vitest';

import { streamTextAI } from './index.js';
import { createTimedFetch, withLLMRequestTiming, type LLMRequestTiming } from './timed-fetch.js';
import { buildProvider } from '../config/index.js';

const sse = (events: object[]) => events
  .map((event) => `event: ${(event as { type: string }).type}\ndata: ${JSON.stringify(event)}\n\n`)
  .join('');

const anthropicStream = (text: string) => sse([
  {
    type: 'message_start',
    message: {
      id: 'msg_1', type: 'message', role: 'assistant', model: 'claude-test', content: [],
      stop_reason: null, usage: { input_tokens: 1, output_tokens: 0 },
    },
  },
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
  { type: 'content_block_stop', index: 0 },
  { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 1 } },
  { type: 'message_stop' },
]);

function stubProvider(requestId: string, text: string, delayMs = 0) {
  return buildProvider('claude', {
    apiKey: 'test-key',
    baseURL: 'https://anthropic.test/v1',
    fetch: async () => {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      return new Response(anthropicStream(text), {
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'request-id': requestId },
      });
    },
  });
}

async function timedRun(requestId: string, text: string, delayMs = 0) {
  const timing: LLMRequestTiming = { attempts: 0 };
  const startedAt = Date.now();
  const result = withLLMRequestTiming(timing, () => streamTextAI(
    [{ role: 'user', content: 'hi' }],
    {},
    { provider: stubProvider(requestId, text, delayMs), model: 'claude-test', modelType: 'claude' },
  ));
  return { timing, startedAt, text: await result.text };
}

describe('timed provider fetch', () => {
  it('records header arrival and request id without consuming the stream', async () => {
    const { timing, startedAt, text } = await timedRun('req_123', 'hello');

    expect(text).toBe('hello');
    expect(timing).toMatchObject({ attempts: 1, status: 200, requestId: 'req_123' });
    expect(timing.responseHeadersAt).toBeGreaterThanOrEqual(startedAt);
  });

  it('keeps concurrent calls in separate timing records', async () => {
    const [slow, fast] = await Promise.all([
      timedRun('req_slow', 'slow', 30),
      timedRun('req_fast', 'fast'),
    ]);

    expect(slow.timing.requestId).toBe('req_slow');
    expect(fast.timing.requestId).toBe('req_fast');
    expect(slow.timing.attempts).toBe(1);
    expect(fast.timing.attempts).toBe(1);
  });

  it('acts as a plain fetch outside a timing scope', async () => {
    const timedFetch = createTimedFetch(async () => new Response('ok', { headers: { 'x-request-id': 'r1' } }));

    await expect((await timedFetch('https://example.test')).text()).resolves.toBe('ok');
  });
});
