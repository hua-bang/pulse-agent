// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { count } from './counters';
import { installPerfMonitor } from './monitor';

describe('window.__pulsePerf frame evidence', () => {
  let now = 0;
  let nextRafId = 1;
  let rafCallbacks: Map<number, FrameRequestCallback>;

  const runFrame = (at: number): void => {
    now = at;
    const pending = [...rafCallbacks.entries()];
    rafCallbacks.clear();
    for (const [, callback] of pending) callback(at);
  };

  beforeEach(() => {
    now = 0;
    nextRafId = 1;
    rafCallbacks = new Map();
    delete window.__pulsePerf;
    vi.spyOn(performance, 'now').mockImplementation(() => now);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      rafCallbacks.delete(id);
    });
    installPerfMonitor();
  });

  afterEach(() => {
    window.__pulsePerf?.end();
    delete window.__pulsePerf;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reports the number of frame deltas over 20ms', () => {
    window.__pulsePerf?.begin('typing');
    runFrame(10);
    runFrame(35);
    runFrame(51);

    expect(window.__pulsePerf?.end()?.frames).toMatchObject({
      count: 2,
      over20msCount: 1,
      over20msPct: 50,
    });
  });

  it('freezes frame evidence at the active end while counters keep collecting', () => {
    window.__pulsePerf?.begin('drag');
    runFrame(10);
    runFrame(35);
    now = 40;

    window.__pulsePerf?.markActiveEnd();
    count('canvas-save-ipc');
    runFrame(100);
    runFrame(140);

    const report = window.__pulsePerf?.end();
    expect(report?.frames).toEqual({
      count: 1,
      over20msCount: 1,
      over20msPct: 100,
      p95DeltaMs: 25,
      windowDurationMs: 40,
    });
    expect(report?.counters).toEqual({ 'canvas-save-ipc': 1 });
    expect(report?.durationMs).toBe(140);
  });

  it('uses the full scenario as the frame window when no active end is marked', () => {
    window.__pulsePerf?.begin('resize');
    runFrame(10);
    runFrame(35);
    runFrame(70);
    now = 90;

    expect(window.__pulsePerf?.end()?.frames).toEqual({
      count: 2,
      over20msCount: 2,
      over20msPct: 100,
      p95DeltaMs: 35,
      windowDurationMs: 90,
    });
  });
});
