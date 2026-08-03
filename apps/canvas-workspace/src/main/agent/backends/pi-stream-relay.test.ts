import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'http';

import { ensurePiStreamRelay, stopPiStreamRelay } from './pi-stream-relay';

type UpstreamBehavior = (chunks: string[]) => string[];

let upstream: Server | null = null;
let lastAuth: string | undefined;

async function startUpstream(events: string[]): Promise<string> {
  upstream = createServer((req, res) => {
    lastAuth = req.headers.authorization as string | undefined;
    if (req.url?.endsWith('/json-error')) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'bad request' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    for (const event of events) res.write(`${event}\n\n`);
    res.end();
  });
  const port = await new Promise<number>((resolve) => {
    upstream!.listen(0, '127.0.0.1', () => {
      resolve((upstream!.address() as { port: number }).port);
    });
  });
  return `http://127.0.0.1:${port}/v1`;
}

afterEach(async () => {
  await stopPiStreamRelay();
  if (upstream) await new Promise<void>((resolve) => upstream!.close(() => resolve()));
  upstream = null;
  lastAuth = undefined;
});

const chunk = (content: string | null, finish: string | null) => `data: ${JSON.stringify({
  id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'm',
  choices: [{ index: 0, delta: content === null ? {} : { content }, finish_reason: finish }],
})}`;

async function callThroughRelay(base: string): Promise<string[]> {
  const relay = await ensurePiStreamRelay(base);
  const response = await fetch(`${relay}/chat/completions`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer sk-x' },
    body: JSON.stringify({ model: 'm', stream: true, messages: [] }),
  });
  const text = await response.text();
  return text.split('\n\n').filter(Boolean).map(event => event.split('\n')
    .filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join(''));
}

const finishReasons = (events: string[]) => events
  .filter(data => data !== '[DONE]')
  .map((data) => { try { return JSON.parse(data)?.choices?.[0]?.finish_reason ?? null; } catch { return null; } });

describe('pi stream relay', () => {
  it('injects a finish_reason chunk when the upstream never sends one', async () => {
    const base = await startUpstream([chunk('你好', null), chunk(',世界', null), 'data: [DONE]']);
    const events = await callThroughRelay(base);
    expect(events.at(-1)).toBe('[DONE]');
    expect(finishReasons(events)).toContain('stop');
    expect(lastAuth).toBe('Bearer sk-x');
  });

  it('appends both the finish chunk and [DONE] when the upstream ends abruptly', async () => {
    const base = await startUpstream([chunk('hi', null)]);
    const events = await callThroughRelay(base);
    expect(events.at(-1)).toBe('[DONE]');
    expect(finishReasons(events)).toContain('stop');
  });

  it('passes a compliant stream through without doubling the finish chunk', async () => {
    const base = await startUpstream([chunk('ok', null), chunk(null, 'stop'), 'data: [DONE]']);
    const events = await callThroughRelay(base);
    expect(finishReasons(events).filter(reason => reason === 'stop')).toHaveLength(1);
    expect(events.at(-1)).toBe('[DONE]');
  });

  it('passes non-SSE responses through untouched', async () => {
    const base = await startUpstream([]);
    const relay = await ensurePiStreamRelay(base);
    const response = await fetch(`${relay}/json-error`, { method: 'POST', body: '{}' });
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: { message: 'bad request' } });
  });
});
