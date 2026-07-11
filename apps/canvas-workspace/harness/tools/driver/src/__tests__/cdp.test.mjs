import { describe, expect, it, vi } from 'vitest';
import { CdpClient } from '../cdp.mjs';

describe('CdpClient events', () => {
  it('routes protocol events and supports unsubscribe', () => {
    const client = new CdpClient('ws://example.test');
    const listener = vi.fn();
    const unsubscribe = client.on('Tracing.bufferUsage', listener);

    client.handleMessage({ method: 'Tracing.bufferUsage', params: { percentFull: 0.25 } });
    unsubscribe();
    client.handleMessage({ method: 'Tracing.bufferUsage', params: { percentFull: 0.5 } });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ percentFull: 0.25 });
  });

  it('resolves a one-shot event waiter', async () => {
    const client = new CdpClient('ws://example.test');
    const event = client.waitForEvent('Tracing.tracingComplete', 100);

    client.handleMessage({ method: 'Tracing.tracingComplete', params: { stream: 'trace-1' } });

    await expect(event).resolves.toEqual({ stream: 'trace-1' });
    expect(client.listeners.size).toBe(0);
  });

  it('rejects event waiters immediately when the client closes', async () => {
    const client = new CdpClient('ws://example.test');
    const event = client.waitForEvent('Tracing.tracingComplete', 25);

    client.close();

    await expect(event).rejects.toThrow('CDP client closed');
    expect(client.listeners.size).toBe(0);
  });

  it('replaces an inert page socket without letting its close affect the new connection', async () => {
    const client = new CdpClient('ws://example.test');
    const previous = { readyState: WebSocket.OPEN, close: vi.fn() };
    client.socket = previous;
    const replacement = {};
    vi.spyOn(client, 'connect').mockImplementation(async () => {
      client.socket = replacement;
    });

    await client.reconnect();

    expect(previous.close).toHaveBeenCalledOnce();
    expect(client.socket).toBe(replacement);
  });
});
