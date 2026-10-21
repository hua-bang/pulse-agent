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

  it('marks only the launch that created the device id as first', async () => {
    expect(await createClient().client.isFirstLaunch()).toBe(true);
    expect(await createClient().client.isFirstLaunch()).toBe(false);
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

  it('splits a long queue into gateway-sized requests', async () => {
    const { client, fetchMock } = createClient({ batchSize: 1_000 });
    for (let index = 0; index < 150; index += 1) await client.track('app_started');
    await client.flush();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentBody(fetchMock, 0).events).toHaveLength(100);
    expect(sentBody(fetchMock, 1).events).toHaveLength(50);
  });

  it('rejects an opt-out that cannot be saved and keeps sending', async () => {
    // A regular file where the settings directory should be makes the write fail.
    await writeFile(join(dir, 'blocker'), '');
    const { client, fetchMock } = createClient({ settingsPath: join(dir, 'blocker', 'telemetry.json') });
    await expect(client.setEnabled(false)).rejects.toThrow();
    expect(await client.status()).toEqual({ configured: true, enabled: true });
    await client.track('app_started');
    await client.flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
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
  it('keeps only the keys listed for the event', () => {
    expect(sanitizeTelemetryProps('node_created', {
      type: 'x'.repeat(300),
      text: 'conversation text',
      count: 3,
    })).toEqual({ type: 'x'.repeat(200) });
    expect(sanitizeTelemetryProps('app_started', { type: 'text' })).toEqual({});
  });

  it('drops non-primitive values and non-object input', () => {
    expect(sanitizeTelemetryProps('node_created', { type: { a: 1 } })).toEqual({});
    expect(sanitizeTelemetryProps('node_created', 'text')).toEqual({});
    expect(sanitizeTelemetryProps('toString', { type: 'x' })).toEqual({});
  });
});
