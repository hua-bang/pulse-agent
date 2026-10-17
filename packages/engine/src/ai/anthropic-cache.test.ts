import { describe, expect, it } from 'vitest';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { ModelMessage } from 'ai';

import { streamTextAI } from './index.js';

// Wire-level guard: assert what the Anthropic request body carries, not what
// option object we built. The call-level `cacheControl` option looked right in
// unit tests but was never sent.
async function captureRequestBody(messages: ModelMessage[], modelType?: 'claude' | 'openai') {
  let body = '';
  const anthropic = createAnthropic({
    apiKey: 'test-key',
    fetch: async (_url, init) => {
      body = String(init?.body ?? '');
      return new Response('{"type":"error","error":{"type":"invalid_request_error","message":"stop"}}', { status: 400 });
    },
  });
  const result = streamTextAI(messages, {}, { provider: anthropic, model: 'claude-test', modelType, systemPrompt: 'SYSTEM' });
  try {
    await result.text;
  } catch {
    // The stub always fails; only the captured request matters.
  }
  return JSON.parse(body);
}

const countBreakpoints = (value: unknown): number => JSON.stringify(value).split('"cache_control"').length - 1;

describe('Anthropic prompt caching on the wire', () => {
  it('marks the system prompt and the newest user message', async () => {
    const body = await captureRequestBody([
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'answer' },
      { role: 'user', content: 'second' },
    ], 'claude');

    expect(body.system).toEqual([expect.objectContaining({ text: 'SYSTEM', cache_control: { type: 'ephemeral' } })]);
    const last = body.messages.at(-1);
    expect(last.content.at(-1)).toMatchObject({ text: 'second', cache_control: { type: 'ephemeral' } });
    expect(countBreakpoints(body)).toBe(2);
  });

  it('marks a trailing tool result so tool loops reuse the cached history', async () => {
    const body = await captureRequestBody([
      { role: 'user', content: 'read it' },
      { role: 'assistant', content: [{ type: 'tool-call', toolCallId: 'c1', toolName: 'read', input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'c1', toolName: 'read', output: { type: 'text', value: 'data' } }] },
    ], 'claude');

    const last = body.messages.at(-1);
    expect(last.content.at(-1)).toMatchObject({ type: 'tool_result', cache_control: { type: 'ephemeral' } });
    expect(countBreakpoints(body)).toBe(2);
  });

  it('adds no breakpoints when the request is not marked as Claude', async () => {
    const body = await captureRequestBody([{ role: 'user', content: 'hi' }]);

    expect(countBreakpoints(body)).toBe(0);
  });
});
