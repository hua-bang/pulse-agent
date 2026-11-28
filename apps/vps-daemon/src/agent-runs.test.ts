import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { AgentRunHub, MAX_RUN_EVENTS, type AgentRunContext } from './agent-runs.js';

class FakeRes extends EventEmitter {
  chunks: string[] = [];
  ended = false;
  destroyed = false;
  writableLength = 0;
  writeHead() {
    return this;
  }
  write(chunk: string) {
    this.chunks.push(chunk);
    return true;
  }
  end() {
    this.ended = true;
    this.emit('close');
  }
  destroy() {
    this.destroyed = true;
    this.emit('close');
  }
  /** Parsed `event`/`id` pairs, ignoring comments. */
  events(): Array<{ id: number; event: string; data: Record<string, unknown> }> {
    return this.chunks.filter((c) => c.startsWith('id:')).map((c) => {
      const lines = c.trim().split('\n');
      return {
        id: Number(lines[0].slice(4)),
        event: lines[1].slice(7),
        data: JSON.parse(lines[2].slice(6)) as Record<string, unknown>,
      };
    });
  }
}

const req = () => new EventEmitter() as unknown as IncomingMessage;
const asRes = (res: FakeRes) => res as unknown as ServerResponse;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const info = (runId: string, sessionId = 's1') => ({
  runId,
  workspaceId: 'ws',
  sessionId,
  clientId: 'c1',
  senderName: 'Me',
  prompt: `prompt ${runId}`,
});

describe('AgentRunHub', () => {
  it('keeps running after the subscriber disconnects and replays from a seq', async () => {
    const hub = new AgentRunHub();
    const gate = deferred();
    let ctxRef: AgentRunContext | null = null;
    hub.submit(info('r1'), async (ctx) => {
      ctxRef = ctx;
      ctx.emit('text_delta', { delta: 'Hel' });
      await gate.promise;
      ctx.emit('text_delta', { delta: 'lo' });
      return { ok: true };
    });
    await flush();
    const first = new FakeRes();
    hub.subscribe(req(), asRes(first), 'r1', 0);
    first.destroy();
    const lastSeen = first.events().at(-1)!.id;

    gate.resolve();
    await flush();
    await flush();
    expect(ctxRef!.signal.aborted).toBe(false);

    const resumed = new FakeRes();
    hub.subscribe(req(), asRes(resumed), 'r1', lastSeen);
    const events = resumed.events();
    expect(events.map((e) => e.event)).toEqual(['text_delta', 'complete']);
    expect(events[0].data.delta).toBe('lo');
    expect(events[1].data).toMatchObject({ ok: true, response: 'Hello', runId: 'r1' });
    expect(resumed.ended).toBe(true);
  });

  it('sends one snapshot when the resume gap is no longer buffered', async () => {
    const hub = new AgentRunHub();
    hub.submit(info('r1'), async (ctx) => {
      for (let i = 0; i < MAX_RUN_EVENTS + 10; i += 1) ctx.emit('text_delta', { delta: 'x' });
      ctx.emit('tool_call', { toolCallId: 't1', name: 'bash', args: { command: 'ls' } });
      ctx.emit('tool_result', { toolCallId: 't1', name: 'bash', status: 'succeeded', result: 'ok' });
      return { ok: true };
    });
    await flush();
    await flush();
    const res = new FakeRes();
    hub.subscribe(req(), asRes(res), 'r1', 1);
    const [snap] = res.events();
    expect(snap.event).toBe('snapshot');
    expect((snap.data.text as string).length).toBe(MAX_RUN_EVENTS + 10);
    expect(snap.data.tools).toEqual([
      { toolCallId: 't1', name: 'bash', args: { command: 'ls' }, status: 'succeeded', result: 'ok' },
    ]);
    expect(snap.data.complete).toMatchObject({ ok: true });
  });

  it('dispatches queued runs for one session in FIFO order and reports queue changes', async () => {
    const changes: Array<{ active: string | null; queued: string[] }> = [];
    const hub = new AgentRunHub({
      onSessionChange: (_ws, _s, active, queued) => {
        changes.push({ active: active?.runId ?? null, queued: queued.map((q) => q.runId) });
      },
    });
    const order: string[] = [];
    const gate = deferred();
    hub.submit(info('r1'), async () => {
      order.push('r1');
      await gate.promise;
      return { ok: true };
    });
    hub.submit(info('r2'), async () => {
      order.push('r2');
      return { ok: true };
    });
    hub.submit(info('r3'), async () => {
      order.push('r3');
      return { ok: true };
    });
    expect(hub.get('r2')?.status).toBe('queued');
    expect(hub.abort('r3')).toBe(true);
    await flush();
    expect(order).toEqual(['r1']);
    gate.resolve();
    for (let i = 0; i < 6; i += 1) await flush();
    expect(order).toEqual(['r1', 'r2']);
    expect(hub.get('r3')?.status).toBe('done');
    expect(changes.at(-1)).toEqual({ active: null, queued: [] });
    expect(changes).toContainEqual({ active: 'r1', queued: ['r2', 'r3'] });
    expect(changes).toContainEqual({ active: 'r2', queued: [] });
  });

  it('aborts only the active run and reports it as stopped', async () => {
    const hub = new AgentRunHub();
    hub.submit(info('r1'), (ctx) => new Promise((_resolve, reject) => {
      ctx.signal.addEventListener('abort', () => reject(new Error('aborted')));
    }));
    hub.submit(info('other', 's2'), async () => new Promise(() => undefined));
    await flush();
    expect(hub.abort('r1')).toBe(true);
    await flush();
    await flush();
    const res = new FakeRes();
    hub.subscribe(req(), asRes(res), 'r1', 0);
    expect(res.events().at(-1)).toMatchObject({ event: 'complete', data: { ok: false, stopped: true, error: 'Aborted' } });
    expect(hub.get('other')?.status).toBe('running');
    hub.close();
  });
});
