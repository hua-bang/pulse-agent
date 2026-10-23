import { afterEach, describe, expect, it, vi } from 'vitest';
import worker, { type Env } from './index';
import { parseBatch } from './batch';

const NOW = Date.UTC(2026, 9, 21);

const validBatch = () => ({
  deviceId: 'device-1',
  sessionId: 'session-1',
  app: { version: '0.1.80', platform: 'darwin', arch: 'arm64', packaged: true },
  events: [{ event: 'node_created', ts: NOW, props: { type: 'text' } }],
});

function post(body: unknown, headers: Record<string, string> = {}) {
  return new Request('https://t.example.com/v1/events', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

async function run(request: Request, env: Env = {}) {
  const pending: Promise<unknown>[] = [];
  const response = await worker.fetch(request, env, { waitUntil: p => { pending.push(p); } });
  await Promise.all(pending);
  return response;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('telemetry gateway', () => {
  it('forwards a valid batch to PostHog without the client IP', async () => {
    vi.useFakeTimers({ now: NOW });
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => new Response('{}'));
    vi.stubGlobal('fetch', fetchMock);

    const response = await run(post(validBatch(), { 'cf-connecting-ip': '203.0.113.7' }), {
      POSTHOG_API_KEY: 'phc_test',
      POSTHOG_HOST: 'https://eu.i.posthog.com/',
    });

    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://eu.i.posthog.com/batch/');
    expect(JSON.parse(String(init.body))).toEqual({
      api_key: 'phc_test',
      batch: [{
        event: 'node_created',
        distinct_id: 'device-1',
        timestamp: new Date(NOW).toISOString(),
        properties: {
          type: 'text',
          $process_person_profile: false,
          $session_id: 'session-1',
          $lib: 'pulse-telemetry-gateway',
          $os: 'Mac OS X',
          $geoip_disable: true,
          app_version: '0.1.80',
          arch: 'arm64',
          packaged: true,
        },
      }],
    });
    expect(String(init.body)).not.toContain('203.0.113.7');
  });

  it('writes Analytics Engine data points when the binding exists', async () => {
    vi.useFakeTimers({ now: NOW });
    const writeDataPoint = vi.fn();
    const response = await run(post(validBatch()), { EVENTS: { writeDataPoint } });

    expect(response.status).toBe(204);
    expect(writeDataPoint).toHaveBeenCalledWith({
      indexes: ['device-1'],
      blobs: ['node_created', '0.1.80', 'darwin', 'arm64', 'session-1', '{"type":"text"}'],
      doubles: [NOW, 1],
    });
  });

  it('accepts a batch with no sink configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await run(post(validBatch()))).status).toBe(204);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects wrong routes, methods, bodies, and oversized requests', async () => {
    expect((await run(new Request('https://t.example.com/other', { method: 'POST' }))).status).toBe(404);
    expect((await run(new Request('https://t.example.com/v1/events'))).status).toBe(405);
    expect((await run(post('not json'))).status).toBe(400);
    expect((await run(post({ ...validBatch(), deviceId: 'bad id!' }))).status).toBe(400);
    expect((await run(post('x'.repeat(70 * 1024)))).status).toBe(413);
    expect((await run(post(validBatch(), { 'content-type': 'text/plain' }))).status).toBe(415);
  });

  it('measures the body limit in UTF-8 bytes', async () => {
    // 30k CJK characters: under 64 KB in UTF-16 units, about 90 KB on the wire.
    const body = JSON.stringify({ ...validBatch(), pad: '字'.repeat(30_000) });
    const request = new Request('https://t.example.com/v1/events', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: new Blob([body]).stream(),
      duplex: 'half',
    } as RequestInit);
    expect((await run(request)).status).toBe(413);
  });

  it('returns 429 when the device is over its rate limit', async () => {
    const limit = vi.fn(async () => ({ success: false }));
    expect((await run(post(validBatch()), { RATE_LIMITER: { limit } })).status).toBe(429);
    expect(limit).toHaveBeenCalledWith({ key: 'device-1' });
  });

  it('limits by client IP before reading the body', async () => {
    const ipLimit = vi.fn(async () => ({ success: false }));
    const deviceLimit = vi.fn(async () => ({ success: true }));
    const response = await run(post('not json', { 'cf-connecting-ip': '203.0.113.7' }), {
      IP_RATE_LIMITER: { limit: ipLimit },
      RATE_LIMITER: { limit: deviceLimit },
    });
    expect(response.status).toBe(429);
    expect(ipLimit).toHaveBeenCalledWith({ key: '203.0.113.7' });
    expect(deviceLimit).not.toHaveBeenCalled();
  });
});

describe('parseBatch', () => {
  it('drops unlisted events and keeps only listed props', () => {
    const batch = parseBatch({
      ...validBatch(),
      events: [
        { event: 'Bad Name', ts: NOW },
        { event: 'conversation_text', ts: NOW, props: { text: 'secret' } },
        { event: 'toString', ts: NOW },
        {
          event: 'agent_turn_finished',
          ts: 0,
          props: { 'Bad Key': 1, nested: {}, text: 'secret', outcome: 'x'.repeat(300), tool_calls: 2 },
        },
      ],
    }, NOW);

    expect(batch?.events).toEqual([
      { event: 'agent_turn_finished', ts: NOW, props: { outcome: 'x'.repeat(200), tool_calls: 2 } },
    ]);
  });

  it('rejects a batch with no valid event', () => {
    expect(parseBatch({ ...validBatch(), events: [{ event: '' }] }, NOW)).toBeNull();
  });
});
