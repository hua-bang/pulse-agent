/**
 * Runtime frontend performance monitor.
 *
 * Exposes `window.__pulsePerf` so the app harness (via CDP `Runtime.evaluate`)
 * or a developer console can drive measurement scenarios:
 *
 *   __pulsePerf.begin('typing');   // start observers + counters
 *   ...drive the interaction...
 *   __pulsePerf.end();             // stop and aggregate
 *   __pulsePerf.dump();            // structured JSON report
 *
 * Collected signals (all Chromium-native, zero overhead until `begin()`):
 * - interaction latency (Event Timing API entries with `interactionId`, INP-style)
 * - long animation frames (LoAF) and long tasks
 * - rAF frame deltas (dropped-frame percentage)
 * - paint marks (FCP), custom `markOnce` startup marks
 * - domain counters from `./counters`
 * - JS heap delta (Chromium `performance.memory`)
 */
import {
  resetCounters,
  setCountersEnabled,
  snapshotCounters,
} from './counters';

interface LoafLikeEntry extends PerformanceEntry {
  blockingDuration?: number;
}

interface EventTimingLikeEntry extends PerformanceEntry {
  interactionId?: number;
}

export interface PerfScenarioReport {
  scenario: string;
  durationMs: number;
  marks: Record<string, number>;
  counters: Record<string, number>;
  paint: Record<string, number>;
  interactions: { count: number; p75: number; p95: number; max: number };
  longAnimationFrames: { count: number; blockingMs: number; maxMs: number };
  longTasks: { count: number; totalMs: number };
  frames: {
    count: number;
    over20msCount: number;
    over20msPct: number;
    p95DeltaMs: number;
    maxDeltaMs: number;
    windowDurationMs: number;
  };
  jsHeapMB: { begin: number; end: number };
}

const marks = new Map<string, number>();

/** Record a named timestamp once (first call wins). Used for startup marks. */
export const markOnce = (name: string): void => {
  if (!marks.has(name)) marks.set(name, round1(performance.now()));
};

const round1 = (n: number): number => Math.round(n * 10) / 10;

const percentile = (sorted: number[], p: number): number => {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return round1(sorted[Math.max(0, idx)]);
};

const readHeapMB = (): number => {
  const memory = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
  return memory ? Math.round(memory.usedJSHeapSize / (1024 * 1024)) : 0;
};

const readPaintEntries = (): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const entry of performance.getEntriesByType('paint')) {
    out[entry.name] = round1(entry.startTime);
  }
  return out;
};

class ScenarioSession {
  private readonly interactionDurations: number[] = [];
  private loafCount = 0;
  private loafBlocking = 0;
  private loafMax = 0;
  private longTaskCount = 0;
  private longTaskTotal = 0;
  private frameDeltas: number[] = [];
  private observers: PerformanceObserver[] = [];
  private rafId = 0;
  private lastFrameAt = 0;
  private frameWindowEndedAt: number | null = null;
  private readonly startedAt = performance.now();
  private readonly heapAtBegin = readHeapMB();

  constructor(private readonly scenario: string) {
    resetCounters();
    setCountersEnabled(true);
    this.observe('event', (entry) => {
      const timing = entry as EventTimingLikeEntry;
      if (timing.interactionId) this.interactionDurations.push(entry.duration);
    }, { durationThreshold: 16 } as PerformanceObserverInit);
    this.observe('long-animation-frame', (entry) => {
      const loaf = entry as LoafLikeEntry;
      this.loafCount += 1;
      this.loafBlocking += loaf.blockingDuration ?? entry.duration;
      this.loafMax = Math.max(this.loafMax, entry.duration);
    });
    this.observe('longtask', (entry) => {
      this.longTaskCount += 1;
      this.longTaskTotal += entry.duration;
    });
    const onFrame = (now: number): void => {
      if (this.lastFrameAt > 0) this.frameDeltas.push(now - this.lastFrameAt);
      this.lastFrameAt = now;
      this.rafId = requestAnimationFrame(onFrame);
    };
    this.rafId = requestAnimationFrame(onFrame);
  }

  private observe(
    type: string,
    onEntry: (entry: PerformanceEntry) => void,
    extra?: PerformanceObserverInit,
  ): void {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) onEntry(entry);
      });
      observer.observe({ type, buffered: false, ...extra } as PerformanceObserverInit);
      this.observers.push(observer);
    } catch {
      // Entry type unsupported on this Chromium — skip that signal.
    }
  }

  markActiveEnd(): void {
    if (this.frameWindowEndedAt !== null) return;
    this.frameWindowEndedAt = performance.now();
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  finish(): PerfScenarioReport {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    for (const observer of this.observers) observer.disconnect();
    this.observers = [];
    setCountersEnabled(false);
    const finishedAt = performance.now();

    const interactions = [...this.interactionDurations].sort((a, b) => a - b);
    const deltas = [...this.frameDeltas].sort((a, b) => a - b);
    const over20 = this.frameDeltas.filter((d) => d > 20).length;
    return {
      scenario: this.scenario,
      durationMs: round1(finishedAt - this.startedAt),
      marks: Object.fromEntries(marks),
      counters: snapshotCounters(),
      paint: readPaintEntries(),
      interactions: {
        count: interactions.length,
        p75: percentile(interactions, 75),
        p95: percentile(interactions, 95),
        max: round1(interactions[interactions.length - 1] ?? 0),
      },
      longAnimationFrames: {
        count: this.loafCount,
        blockingMs: round1(this.loafBlocking),
        maxMs: round1(this.loafMax),
      },
      longTasks: { count: this.longTaskCount, totalMs: round1(this.longTaskTotal) },
      frames: {
        count: this.frameDeltas.length,
        over20msCount: over20,
        over20msPct: this.frameDeltas.length
          ? round1((over20 / this.frameDeltas.length) * 100)
          : 0,
        p95DeltaMs: percentile(deltas, 95),
        maxDeltaMs: round1(deltas[deltas.length - 1] ?? 0),
        windowDurationMs: round1(
          (this.frameWindowEndedAt ?? finishedAt) - this.startedAt,
        ),
      },
      jsHeapMB: { begin: this.heapAtBegin, end: readHeapMB() },
    };
  }
}

let activeSession: ScenarioSession | null = null;
let lastReport: PerfScenarioReport | null = null;

export interface PulsePerfApi {
  begin: (scenario?: string) => void;
  end: () => PerfScenarioReport | null;
  dump: () => PerfScenarioReport | null;
  mark: (name: string) => void;
  markActiveEnd: () => void;
}

declare global {
  interface Window {
    __pulsePerf?: PulsePerfApi;
  }
}

/** Idempotently expose the monitor on `window.__pulsePerf`. */
export const installPerfMonitor = (): void => {
  if (window.__pulsePerf) return;
  window.__pulsePerf = {
    begin: (scenario = 'adhoc') => {
      activeSession?.finish();
      activeSession = new ScenarioSession(scenario);
    },
    end: () => {
      if (!activeSession) return null;
      lastReport = activeSession.finish();
      activeSession = null;
      return lastReport;
    },
    dump: () => lastReport,
    mark: markOnce,
    markActiveEnd: () => activeSession?.markActiveEnd(),
  };
};
