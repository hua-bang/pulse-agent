import { app } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { getStartupReport, type StartupReport } from '../../main/app/perf-marks';
import type { MainCanvasPlugin } from '../types';

// ── Detachable performance plugin (main half) ───────────────────────────────
//
// Pull-based IPC handlers only — they run solely when the renderer /perf panel
// invokes them, so the plugin is completely inert when the panel is closed or
// the `perf-panel` flag is off (no listeners, timers, or background work).
//
// To remove the plugin entirely: delete this file + src/plugins/renderer/perf,
// drop the two BUILT_IN_* registrations, and remove the EXPERIMENTAL_FLAG_PERF_PANEL
// entry. Nothing in core depends on it.

interface ProcSummary {
  type: string;
  count: number;
  memoryKB: number;
  cpu: number;
}

export interface PerfMetrics {
  capturedAt: number;
  processCount: number;
  totalMemoryKB: number;
  totalCpu: number;
  processes: ProcSummary[];
}

export interface PerfSnapshot {
  path: string;
  data: unknown;
}

const snapshotCandidates = (): string[] => [
  join(process.cwd(), 'perf', 'out', 'perf-snapshot.json'),
  join(app.getAppPath(), 'perf', 'out', 'perf-snapshot.json'),
];

export const PerfMainPlugin: MainCanvasPlugin = {
  id: 'perf',
  activate(ctx) {
    // Per-process CPU/memory and process-type counts (Tab = guest webview
    // renderers — validates D1/H2). app.getAppMetrics() is a cheap snapshot.
    ctx.handle('metrics', async (): Promise<PerfMetrics> => {
      const metrics = app.getAppMetrics();
      const byType = new Map<string, ProcSummary>();
      for (const m of metrics) {
        const cur = byType.get(m.type) ?? { type: m.type, count: 0, memoryKB: 0, cpu: 0 };
        cur.count += 1;
        cur.memoryKB += m.memory?.workingSetSize ?? 0;
        cur.cpu += m.cpu?.percentCPUUsage ?? 0;
        byType.set(m.type, cur);
      }
      const processes = [...byType.values()].sort((a, b) => b.memoryKB - a.memoryKB);
      return {
        capturedAt: Date.now(),
        processCount: metrics.length,
        totalMemoryKB: processes.reduce((a, p) => a + p.memoryKB, 0),
        totalCpu: processes.reduce((a, p) => a + p.cpu, 0),
        processes,
      };
    });

    // Main-process bootstrap phase timings (L3). Empty/disabled unless the
    // app was launched with PULSE_PERF=1.
    ctx.handle('startup', async (): Promise<StartupReport> => getStartupReport());

    // The latest CI snapshot produced by `pnpm perf:report`, if present on
    // disk. Returns null when it has not been generated (e.g. packaged app).
    ctx.handle('snapshot', async (): Promise<PerfSnapshot | null> => {
      for (const path of snapshotCandidates()) {
        try {
          const raw = await readFile(path, 'utf-8');
          return { path, data: JSON.parse(raw) };
        } catch {
          // try next candidate
        }
      }
      return null;
    });
  },
};
