import { describe, expect, it } from 'vitest';
import { followVpsRun, VpsRunStartError } from './run-stream';

const frame = (id: number, event: string, data: unknown) => `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

/** A stream that delivers `chunks`, then either ends or fails. */
function sse(chunks: string[], fail = false): Response {
  const encoder = new TextEncoder();
  const pending = [...chunks];
  // Pull-based, so a failure arrives only after every chunk was read.
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = pending.shift();
      if (next !== undefined) controller.enqueue(encoder.encode(next));
      else if (fail) controller.error(new Error('socket hang up'));
      else controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

const start = {
  kind: 'start' as const,
  body: { workspaceId: 'ws', sessionId: 's1', runId: 'r1', message: 'hi' },
};

describe('followVpsRun', () => {
  it('resumes from the last event id after the stream drops', async () => {
    const calls: string[] = [];
    const responses = [
      sse([frame(1, 'started', {}), frame(2, 'text_delta', { delta: 'Hel' })], true),
      sse([frame(3, 'text_delta', { delta: 'lo' }), frame(4, 'complete', { ok: true, runId: 'r1', response: 'Hello' })]),
    ];
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      return responses.shift()!;
    }) as unknown as typeof fetch;
    const text: string[] = [];
    const result = await followVpsRun({
      endpoint: 'http://vps',
      token: 't',
      start,
      fetchImpl,
      handlers: { onText: (delta) => text.push(delta) },
    });
    expect(result).toMatchObject({ ok: true, response: 'Hello', runId: 'r1' });
    expect(text.join('')).toBe('Hello');
    expect(calls).toEqual(['http://vps/v1/agent/chat', 'http://vps/v1/agent/runs/r1/events?after=2']);
  });

  it('re-sends the start when the first request never reached the daemon', async () => {
    const calls: string[] = [];
    let attempt = 0;
    const fetchImpl = (async (url: string) => {
      calls.push(String(url));
      attempt += 1;
      if (attempt === 1) throw new TypeError('fetch failed');
      return sse([frame(1, 'complete', { ok: true, runId: 'r1', response: '' })]);
    }) as unknown as typeof fetch;
    const result = await followVpsRun({ endpoint: 'http://vps', token: 't', start, fetchImpl });
    expect(result.ok).toBe(true);
    expect(calls).toEqual(['http://vps/v1/agent/chat', 'http://vps/v1/agent/chat']);
  });

  it('emits only the unseen part of a snapshot', async () => {
    const responses = [
      sse([frame(1, 'text_delta', { delta: 'Hel' }), frame(2, 'tool_call', { toolCallId: 't1', name: 'bash', args: {} })], true),
      sse([
        frame(9, 'snapshot', {
          status: 'done',
          text: 'Hello',
          tools: [{ toolCallId: 't1', name: 'bash', status: 'succeeded', result: 'ok' }],
          complete: { ok: true, runId: 'r1', response: 'Hello' },
        }),
      ]),
    ];
    const fetchImpl = (async () => responses.shift()!) as unknown as typeof fetch;
    const text: string[] = [];
    const toolCalls: string[] = [];
    const toolResults: string[] = [];
    const result = await followVpsRun({
      endpoint: 'http://vps',
      token: 't',
      start: { kind: 'follow', runId: 'r1' },
      fetchImpl,
      handlers: {
        onText: (delta) => text.push(delta),
        onToolCall: (call) => toolCalls.push(call.toolCallId),
        onToolResult: (res) => toolResults.push(`${res.toolCallId}:${res.result}`),
      },
    });
    expect(text).toEqual(['Hel', 'lo']);
    expect(toolCalls).toEqual(['t1']);
    expect(toolResults).toEqual(['t1:ok']);
    expect(result.response).toBe('Hello');
  });

  it('surfaces a refused start with the daemon code', async () => {
    const fetchImpl = (async () => new Response(
      JSON.stringify({ ok: false, code: 'agent_not_configured', message: 'not configured' }),
      { status: 503 },
    )) as unknown as typeof fetch;
    await expect(followVpsRun({ endpoint: 'http://vps', token: 't', start, fetchImpl }))
      .rejects.toMatchObject({ name: 'VpsRunStartError', code: 'agent_not_configured', status: 503 });
    expect(VpsRunStartError).toBeDefined();
  });

  it('stops following without error when the caller detaches', async () => {
    const controller = new AbortController();
    const fetchImpl = (async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    }) as unknown as typeof fetch;
    const result = await followVpsRun({ endpoint: 'http://vps', token: 't', start, fetchImpl, signal: controller.signal });
    expect(result).toMatchObject({ ok: false, stopped: true, error: 'Detached' });
  });
});
