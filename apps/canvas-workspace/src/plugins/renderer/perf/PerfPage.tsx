import { useEffect, useRef, useState } from 'react';
import type { RendererCtx } from '../../types';
import './PerfPage.css';

// Local mirrors of the main-half return shapes (renderer must not import main).
interface ProcSummary {
  type: string;
  count: number;
  memoryKB: number;
  cpu: number;
}
interface PerfMetrics {
  capturedAt: number;
  processCount: number;
  totalMemoryKB: number;
  totalCpu: number;
  processes: ProcSummary[];
}
interface PerfSnapshot {
  path: string;
  data: unknown;
}

const fmtMB = (kb: number) => `${(kb / 1024).toFixed(1)} MB`;

interface PerfPageProps {
  invoke: RendererCtx['invoke'];
  onBack: () => void;
}

export const PerfPage = ({ invoke, onBack }: PerfPageProps) => {
  const [fps, setFps] = useState(0);
  const [heapMB, setHeapMB] = useState<number | null>(null);
  const [longTasks, setLongTasks] = useState(0);
  const [metrics, setMetrics] = useState<PerfMetrics | null>(null);
  const [snapshot, setSnapshot] = useState<PerfSnapshot | null>(null);
  const [metricsError, setMetricsError] = useState<string | null>(null);
  const frames = useRef(0);

  // Live FPS: count animation frames over ~500ms windows.
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      frames.current += 1;
      if (now - last >= 500) {
        setFps(Math.round((frames.current * 1000) / (now - last)));
        frames.current = 0;
        last = now;
        const mem = (performance as { memory?: { usedJSHeapSize: number } }).memory;
        if (mem) setHeapMB(mem.usedJSHeapSize / 1024 / 1024);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Long tasks (main-thread blocks > 50ms) via PerformanceObserver.
  useEffect(() => {
    let observer: PerformanceObserver | null = null;
    try {
      observer = new PerformanceObserver((list) => {
        setLongTasks((n) => n + list.getEntries().length);
      });
      observer.observe({ entryTypes: ['longtask'] });
    } catch {
      // longtask entry type unsupported — leave counter at 0
    }
    return () => observer?.disconnect();
  }, []);

  // Poll process metrics from the main half every 2s.
  useEffect(() => {
    let cancelled = false;
    const poll = async () => {
      try {
        const m = await invoke<PerfMetrics>('metrics');
        if (!cancelled) {
          setMetrics(m);
          setMetricsError(null);
        }
      } catch (err) {
        if (!cancelled) setMetricsError(String(err));
      }
    };
    void poll();
    const id = window.setInterval(poll, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [invoke]);

  // Load the latest CI snapshot once.
  useEffect(() => {
    let cancelled = false;
    void invoke<PerfSnapshot | null>('snapshot')
      .then((s) => {
        if (!cancelled) setSnapshot(s);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [invoke]);

  const snapshotBundle = (snapshot?.data as { bundle?: Record<string, unknown> } | undefined)?.bundle;

  return (
    <div className="perf-page">
      <header className="perf-header">
        <button type="button" className="perf-back" onClick={onBack}>
          ← Canvas
        </button>
        <h1>Performance</h1>
        <span className="perf-hint">detachable plugin · flag: perf-panel</span>
      </header>

      <section className="perf-cards">
        <div className="perf-card">
          <div className="perf-card-value">{fps}</div>
          <div className="perf-card-label">FPS (renderer)</div>
        </div>
        <div className="perf-card">
          <div className="perf-card-value">{heapMB != null ? `${heapMB.toFixed(0)}` : '—'}</div>
          <div className="perf-card-label">JS heap (MB)</div>
        </div>
        <div className="perf-card">
          <div className="perf-card-value">{longTasks}</div>
          <div className="perf-card-label">Long tasks (&gt;50ms)</div>
        </div>
        <div className="perf-card">
          <div className="perf-card-value">{metrics?.processCount ?? '—'}</div>
          <div className="perf-card-label">Processes</div>
        </div>
      </section>

      <section className="perf-section">
        <h2>Processes (CPU / memory)</h2>
        {metricsError && <p className="perf-error">{metricsError}</p>}
        {metrics ? (
          <table className="perf-table">
            <thead>
              <tr>
                <th>type</th>
                <th>count</th>
                <th>memory</th>
                <th>cpu %</th>
              </tr>
            </thead>
            <tbody>
              {metrics.processes.map((p) => (
                <tr key={p.type}>
                  <td>{p.type}</td>
                  <td>{p.count}</td>
                  <td>{fmtMB(p.memoryKB)}</td>
                  <td>{p.cpu.toFixed(1)}</td>
                </tr>
              ))}
              <tr className="perf-table-total">
                <td>total</td>
                <td>{metrics.processCount}</td>
                <td>{fmtMB(metrics.totalMemoryKB)}</td>
                <td>{metrics.totalCpu.toFixed(1)}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <p className="perf-muted">collecting…</p>
        )}
      </section>

      <section className="perf-section">
        <h2>CI snapshot (perf:report)</h2>
        {snapshotBundle ? (
          <ul className="perf-list">
            <li>
              entry chunk gzip: <strong>{String((snapshotBundle as Record<string, unknown>).entryGzipBytes ?? '—')}</strong> bytes
            </li>
            <li>chunks: {String((snapshotBundle as Record<string, unknown>).chunkCount ?? '—')}</li>
            <li className="perf-muted">source: {snapshot?.path}</li>
          </ul>
        ) : (
          <p className="perf-muted">
            no snapshot on disk — run <code>pnpm --filter canvas-workspace perf:report</code> first.
          </p>
        )}
      </section>
    </div>
  );
};
