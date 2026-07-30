import { describe, expect, it } from 'vitest';
import type { ModelMessage } from 'ai';

import { modelMessagesToToolCalls, normalizeToolResult } from './engine-stream-callbacks';

describe('normalizeToolResult', () => {
  it('preserves AI SDK error results as failed outcomes', () => {
    expect(normalizeToolResult(
      { type: 'error-text', value: 'permission denied' },
      { name: 'bash', toolCallId: 'tool-1' },
    )).toEqual({
      name: 'bash',
      toolCallId: 'tool-1',
      result: 'permission denied',
      status: 'failed',
      error: 'permission denied',
    });
  });

  it('treats structured non-zero command results as failures', () => {
    const outcome = normalizeToolResult(
      { type: 'json', value: { output: '', error: 'exit 2', exitCode: 2 } },
      { name: 'bash' },
    );

    expect(outcome).toMatchObject({ status: 'failed', error: 'exit 2' });
  });

  it('keeps a declined approval distinct from execution failure', () => {
    const outcome = normalizeToolResult(
      {
        type: 'json',
        value: { ok: false, cancelled: true, error: 'Not approved' },
      },
      { name: 'write' },
    );

    expect(outcome).toMatchObject({
      status: 'cancelled',
      error: 'Not approved',
    });
  });

  it('persists successful and failed tool frames distinctly', () => {
    const messages = [{
      role: 'assistant',
      content: [
        { type: 'tool-call', toolCallId: 'ok-1', toolName: 'read', input: { path: 'a' } },
        { type: 'tool-result', toolCallId: 'ok-1', toolName: 'read', output: { type: 'text', value: 'hello' } },
        { type: 'tool-call', toolCallId: 'bad-1', toolName: 'bash', input: { command: 'false' } },
        { type: 'tool-result', toolCallId: 'bad-1', toolName: 'bash', output: { type: 'error-text', value: 'exit 1' } },
      ],
    }] as unknown as ModelMessage[];

    expect(modelMessagesToToolCalls(messages)).toMatchObject([
      { name: 'read', status: 'succeeded', result: 'hello' },
      { name: 'bash', status: 'failed', result: 'exit 1', error: 'exit 1' },
    ]);
  });
});
