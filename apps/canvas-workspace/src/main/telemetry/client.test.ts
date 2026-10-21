import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sanitizeTelemetryProps, TelemetryClient, type TelemetryClientOptions } from './client';

const APP = { version: '1.2.3', platform: 'darwin', arch: 'arm64', packaged: true };

let dir: string;
let settingsPath: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'telemetry-'));
  settingsPath = join(dir, 'telemetry.json');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function createClient(overrides: Partial<TelemetryClientOptions> = {}) {
  const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => (
    new Response(null, { status: 204 })
  ));
  const client = new TelemetryClient({
    endpoint: 'https://t.example.com/v1/events',
    settingsPath,
    app: APP,
    fetch: fetchMock as unknown as typeof fetch,
    now: () => 1_700_000_000_000,
    ...overrides,
  });
  return { client, fetchMock };
}

function sentBody(fetchMock: { mock: { calls: unknown[][] } }, call = 0) {
  const init = fetchMock.mock.calls[call][1] as RequestInit;
  return JSON.parse(String(init.body));
}

describe('TelemetryClient', () => {
  it('batches known events with a stable device id', async () => {
    const { client, fetchMock } = createClient();
    await client.track('app_started');
    await client.track('node_created', { type: 'text' });
    await client.flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = sentBody(fetchMock);
    expect(body.app).toEqual(APP);
    expect(body.events).toEqual([
      { event: 'app_started', ts: 1_700_000_000_000, props: {} },
      { event: 'node_created', ts: 1_700_000_000_000, props: { type: 'text' } },
    ]);
    const stored = JSON.parse(await readFile(settingsPath, 'utf8'));
    expect(stored).toEqual({ enabled: true, deviceId: body.deviceId });
  });

  it('reuses the stored device id', async () => {
    await writeFile(settingsPath, JSON.stringify({ enabled: true, deviceId: 'device-1' }));
    const { client, fetchMock } = createClient();
    await client.track('app_started');
    await client.flush();
    expect(sentBody(fetchMock).deviceId).toBe('device-1');
  });

  it('drops unknown events', async () => {
    const { client, fetchMock } = createClient();
    await client.track('conversation_text', { text: 'secret' });
    await client.flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends nothing and writes nothing when the build has no endpoint', async () => {
    const { client, fetchMock } = createClient({ endpoint: '' });
    await client.track('app_started');
    await client.flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await client.status()).toEqual({ configured: false, enabled: true });
    await expect(readFile(settingsPath, 'utf8')).rejects.toThrow();
  });

  it('stops sending and clears the queue when the user turns it off', async () => {
    const { client, fetchMock } = createClient();
    await client.track('app_started');
    expect(await client.setEnabled(false)).toEqual({ configured: true, enabled: false });
    await client.track('node_created', { type: 'text' });
    await client.flush();
    expect(fetchMock).not.toHaveBeenCalled();

    const reloaded = createClient();
    expect(await reloaded.client.status()).toEqual({ configured: true, enabled: false });
  });

  it('flushes when the batch is full', async () => {
    const { client, fetchMock } = createClient({ batchSize: 2 });
    await client.track('app_started');
    await client.track('app_started');
    await client.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBody(fetchMock).events).toHaveLength(2);
  });

  it('drops a batch when the send fails', async () => {
    const { client, fetchMock } = createClient();
    fetchMock.mockRejectedValueOnce(new Error('offline'));
    await client.track('app_started');
    await expect(client.flush()).resolves.toBeUndefined();
    await client.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('sanitizeTelemetryProps', () => {
  it('keeps short primitive props with plain keys', () => {
    expect(sanitizeTelemetryProps({
      type: 'x'.repeat(300),
      count: 3,
      ok: true,
      nested: { a: 1 },
      'Bad Key': 'v',
      nan: Number.NaN,
    })).toEqual({ type: 'x'.repeat(200), count: 3, ok: true });
  });

  it('ignores non-object input', () => {
    expect(sanitizeTelemetryProps('text')).toEqual({});
    expect(sanitizeTelemetryProps([1])).toEqual({});
  });
});
