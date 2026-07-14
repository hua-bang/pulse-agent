import { describe, expect, it } from 'vitest';
import {
  collectChatStreamMetrics,
  collectImageMemoryMetric,
  collectInteractionScenarioMetrics,
  collectPanzoomMetrics,
  collectPtyStreamMetric,
  collectPackageMetrics,
  collectRendererTraceMetrics,
  collectWelcomeContentMetric,
  collectWorkspaceCycleMetrics,
} from './collect-metrics.mjs';

describe('collectPackageMetrics', () => {
  it('maps the packaged artifact report without inventing missing values', () => {
    expect(collectPackageMetrics({
      platform: 'darwin',
      arch: 'arm64',
      commit: 'abc123',
      metrics: { dmgMB: 96.6, appUnpackedMiB: 235.1, electronLocaleCount: 3 },
    })).toEqual([
      { id: 'package.dmg_mb', value: 96.6, runs: 1, detail: 'darwin/arm64 · commit abc123' },
      { id: 'package.app_unpacked_mib', value: 235.1, runs: 1, detail: 'darwin/arm64 · commit abc123' },
      { id: 'package.electron_locale_count', value: 3, runs: 1, detail: 'darwin/arm64 · commit abc123' },
    ]);
  });
});

describe('collectInteractionScenarioMetrics', () => {
  it('normalizes resize timing, counters, repeat samples, and gate results', () => {
    const scenarios = {
      scenarios: {
        resize: {
          report: {
            runs: 3,
            raw: {
              interactionsP95: [12, 14, 13],
              framesOver20Pct: [1, 2, 1.5],
              framesOver20Count: [0, 1, 1],
              counters: [
                { 'nodes-array-replace': 1, 'canvas-save-ipc': 1 },
                { 'nodes-array-replace': 2, 'canvas-save-ipc': 1 },
                { 'nodes-array-replace': 2, 'canvas-save-ipc': 1 },
              ],
            },
            interactions: { p95: 13 },
            frames: { over20msPct: 1.5, over20msPctMax: 2, over20msCountMax: 1 },
            counters: { 'nodes-array-replace': 2, 'canvas-save-ipc': 1 },
          },
        },
      },
      gates: [
        { scenario: 'resize', counter: 'nodes-array-replace', max: 10, value: 2, pass: true },
        { scenario: 'resize', counter: 'canvas-save-ipc', max: 3, value: 1, pass: true },
      ],
    };

    expect(collectInteractionScenarioMetrics(scenarios, 'resize')).toEqual([
      { id: 'interact.resize.inp_p95_ms', value: 13, runs: 3, raw: [12, 14, 13] },
      {
        id: 'interact.resize.frames_over20_pct', value: 1.5, runs: 3, raw: [1, 2, 1.5],
        detail: 'median 1.5% · max 2% · max 1 frames >20ms',
      },
      {
        id: 'interact.resize.frames_over20_pct_max', value: 2, runs: 3, raw: [1, 2, 1.5],
        detail: 'max across 3 active-window runs · 1 frames >20ms',
      },
      {
        id: 'interact.resize.counter.nodes_array_replace', value: 2, runs: 3,
        raw: [1, 2, 2], pass: true, limit: 10,
      },
      {
        id: 'interact.resize.counter.canvas_save_ipc', value: 1, runs: 3,
        raw: [1, 1, 1], pass: true, limit: 3,
      },
    ]);
  });

  it('returns no entries when the selected scenario did not run', () => {
    expect(collectInteractionScenarioMetrics({ scenarios: {}, gates: [] }, 'resize')).toEqual([]);
    expect(collectInteractionScenarioMetrics(null, 'resize')).toEqual([]);
  });

  it('preserves a failed gate when its scenario or counter value is missing', () => {
    const scenarios = {
      scenarios: {},
      gates: [{
        scenario: 'resize',
        counter: 'canvas-save-ipc',
        max: 3,
        value: null,
        pass: false,
        missing: true,
      }],
    };

    expect(collectInteractionScenarioMetrics(scenarios, 'resize')).toEqual([{
      id: 'interact.resize.counter.canvas_save_ipc',
      value: null,
      runs: 1,
      pass: false,
      limit: 3,
      missing: true,
    }]);
  });
});

describe('collectMetrics image memory', () => {
  it('maps the image-memory scenario into the metric dictionary id', () => {
    expect(collectImageMemoryMetric({
      scenarios: {
        'image-memory': {
          images: 10,
          decodedMB: 26.4,
          originalDecodedMB: 457.8,
          reductionRatio: 17.4,
        },
      },
    })).toEqual({
      id: 'memory.image.decoded_mb',
      value: 26.4,
      runs: 1,
      detail: '10×4K · original 457.8 MB · 17.4× reduction',
    });
  });
});

describe('collectMetrics chat stream', () => {
  it('maps timing and render-count gates from the deterministic replay', () => {
    expect(collectChatStreamMetrics({
      scenarios: {
        'chat-stream': {
          report: {
            frames: { over20msPct: 0.3 },
            counters: {
              'chat-md-render': 2,
              'chat-md-cache-hit': 2,
              'chat-stream-commit': 65,
            },
          },
          cacheProbe: { hits: 2, renders: 2, opportunities: 4, ratio: 99 },
          markdownRenders: 64,
          tailBurstMs: 0.8,
        },
      },
      gates: [
        { scenario: 'chat-stream', counter: 'chat-md-stream-render', max: 80, value: 64, pass: true },
        { scenario: 'chat-stream', counter: 'chat-stream-commit', max: 80, value: 65, pass: true },
      ],
    })).toEqual([
      { id: 'chat.stream.frames_over20_pct', value: 0.3, runs: 1 },
      { id: 'chat.stream.md_render_count', value: 64, runs: 1, pass: true, limit: 80 },
      { id: 'chat.stream.commit_count', value: 65, runs: 1, pass: true, limit: 80 },
      { id: 'chat.stream.tail_burst_ms', value: 0.8, runs: 1 },
      { id: 'chat.stream.md_cache_hit_ratio', value: 50, runs: 1, detail: '2 hits / 4 settled render opportunities' },
      { id: 'chat.stream.md_cache_hit_count', value: 2, runs: 1 },
      { id: 'chat.stream.md_cache_opportunity_count', value: 4, runs: 1 },
    ]);
  });

  it('does not manufacture a zero cache ratio without a verified reuse probe', () => {
    const metrics = collectChatStreamMetrics({
      scenarios: {
        'chat-stream': {
          report: {
            frames: { over20msPct: 0 },
            counters: { 'chat-md-render': 2 },
          },
          markdownRenders: 64,
          tailBurstMs: 1,
        },
      },
      gates: [],
    });

    expect(metrics.map((metric) => metric.id)).toEqual([
      'chat.stream.frames_over20_pct',
      'chat.stream.md_render_count',
      'chat.stream.tail_burst_ms',
    ]);
  });

  it('rejects an impossible cache probe instead of publishing an invalid ratio', () => {
    const metrics = collectChatStreamMetrics({
      scenarios: {
        'chat-stream': {
          report: { frames: { over20msPct: 0.3 } },
          cacheProbe: { hits: 5, renders: 0, opportunities: 4, ratio: 125 },
          markdownRenders: 64,
          tailBurstMs: 0.8,
        },
      },
      gates: [],
    });

    expect(metrics.some((metric) => metric.id.startsWith('chat.stream.md_cache_'))).toBe(false);
  });
});

describe('collectMetrics remaining scenario coverage', () => {
  it('maps local welcome content completion and dual-PTY IPC throughput', () => {
    const scenarios = {
      scenarios: {
        startup: { welcomeLocalContentMs: 138 },
        'pty-stream': {
          terminals: 2,
          events: 96,
          durationMs: 1200,
          ipcPerSec: 80,
        },
      },
    };
    expect(collectWelcomeContentMetric(scenarios)).toEqual({
      id: 'startup.welcome_local_content_ms', value: 138, runs: 1,
    });
    expect(collectPtyStreamMetric(scenarios)).toEqual({
      id: 'main.pty.ipc_per_sec',
      value: 80,
      runs: 1,
      detail: '2 terminals · 96 IPC events · 1200 ms',
    });
  });
});

describe('collectMetrics renderer trace diagnostics', () => {
  it('maps a measured warm-reload trace into diagnostic metric ids', () => {
    const metrics = collectRendererTraceMetrics({
      scenarios: {
        'renderer-trace': {
          status: 'measured',
          capture: { urlScheme: 'file' },
          artifact: { path: 'perf/out/renderer-trace.json.gz' },
          vitals: { lcpMs: 180, cls: 0.02, layoutShiftCount: 2 },
          window: { fcpMs: 20, firstCanvasMs: 90 },
          blocking: {
            timeToCanvasMs: 4,
            timeCanvasToLcpMs: 26,
            longTaskCount: 2,
            longTaskMaxMs: 82,
          },
          resources: { loadedToCanvasKB: 1100, loadedToLcpKB: 1500 },
          cpu: { taskMs: 120, scriptMs: 70, recalcStyleMs: 8, layoutMs: 12 },
        },
      },
    });

    expect(metrics.map(({ id, value }) => ({ id, value }))).toEqual([
      { id: 'startup.renderer_reload.lcp_ms', value: 180 },
      { id: 'startup.renderer_reload.cls', value: 0.02 },
      { id: 'startup.renderer_reload.layout_shift_count', value: 2 },
      { id: 'startup.renderer_reload.blocking_time_to_canvas_ms', value: 4 },
      { id: 'startup.renderer_reload.blocking_canvas_to_lcp_ms', value: 26 },
      { id: 'startup.renderer_reload.long_task_count', value: 2 },
      { id: 'startup.renderer_reload.long_task_max_ms', value: 82 },
      { id: 'startup.loaded_to_canvas_kb', value: 1100 },
      { id: 'startup.loaded_to_lcp_kb', value: 1500 },
      { id: 'startup.renderer_reload.task_ms', value: 120 },
      { id: 'startup.renderer_reload.script_ms', value: 70 },
      { id: 'startup.renderer_reload.recalc_style_ms', value: 8 },
      { id: 'startup.renderer_reload.layout_ms', value: 12 },
    ]);
  });

  it('does not turn an unavailable or lossy trace into zero-valued metrics', () => {
    expect(collectRendererTraceMetrics({
      scenarios: { 'renderer-trace': { status: 'unavailable', reason: 'CDP missing' } },
    })).toEqual([]);
    expect(collectRendererTraceMetrics({
      scenarios: { 'renderer-trace': { status: 'invalid', reason: 'data loss' } },
    })).toEqual([]);
  });
});

describe('collectMetrics pan/zoom evidence', () => {
  it('uses wheel-to-next-frame latency instead of structural zero INP and preserves worst-run frames', () => {
    expect(collectPanzoomMetrics({
      scenarios: {
        panzoom: {
          report: {
            runs: 3,
            raw: {
              wheelToNextFrameP95: [7.2, 8.4, 7.8],
              framesOver20Pct: [0, 0.5, 0],
              framesOver20Count: [0, 1, 0],
            },
            wheelToNextFrame: { count: 50, p95: 7.8, max: 9.1 },
            frames: { over20msPct: 0, over20msPctMax: 0.5, over20msCountMax: 1 },
            transformChanged: true,
          },
        },
      },
    })).toEqual([
      {
        id: 'interact.panzoom.wheel_to_next_frame_p95_ms', value: 7.8, runs: 3,
        raw: [7.2, 8.4, 7.8], detail: '50 wheel samples/run × 3 · transform verified',
      },
      {
        id: 'interact.panzoom.frames_over20_pct', value: 0, runs: 3,
        raw: [0, 0.5, 0], detail: 'median 0% · max 0.5% · max 1 frames >20ms',
      },
      {
        id: 'interact.panzoom.frames_over20_pct_max', value: 0.5, runs: 3,
        raw: [0, 0.5, 0], detail: 'max across 3 active-window runs · 1 frames >20ms',
      },
    ]);
  });

  it('does not emit a latency metric when the transform probe did not verify work', () => {
    expect(collectPanzoomMetrics({
      scenarios: { panzoom: { report: { transformChanged: false } } },
    })).toEqual([]);
  });
});

describe('collectMetrics workspace retention evidence', () => {
  it('maps the equal-load, post-capacity heap slope and scenario size', () => {
    expect(collectWorkspaceCycleMetrics({
      scenarios: {
        'ws-cycle': {
          workspaces: 8,
          nodesPerWorkspace: 100,
          heapsMB: [60, 70, 80, 90, 91, 90, 91, 90],
          postCapacityHeapsMB: [90, 91, 90, 91, 90],
          heapSlopeMB: 0,
          peakHeapMB: 91,
          mountedWorkspaceCounts: [2, 3, 4, 4, 4, 4, 4, 4],
        },
      },
    })).toEqual([
      {
        id: 'memory.ws_cycle.post_capacity_heap_slope', value: 0, runs: 1,
        detail: '8 equal-load workspaces × 100 nodes · post-capacity heap 90 → 91 → 90 → 91 → 90 MB',
      },
      { id: 'memory.ws_cycle.peak_heap_mb', value: 91, runs: 1 },
      { id: 'memory.ws_cycle.nodes_per_workspace', value: 100, runs: 1 },
      { id: 'memory.ws_cycle.post_capacity_sample_count', value: 5, runs: 1 },
      { id: 'memory.ws_cycle.peak_mounted_workspace_count', value: 4, runs: 1 },
    ]);
  });

  it('does not relabel a legacy uneven-load slope as post-capacity evidence', () => {
    expect(collectWorkspaceCycleMetrics({
      scenarios: {
        'ws-cycle': {
          workspaces: 5,
          heapsMB: [78, 90, 102, 59, 59],
          heapSlopeMB: -5,
          peakHeapMB: 102,
        },
      },
    })).toEqual([]);
  });

  it('rejects incomplete two-point data even when it carries the new field names', () => {
    expect(collectWorkspaceCycleMetrics({
      scenarios: {
        'ws-cycle': {
          workspaces: 2,
          nodesPerWorkspace: 100,
          heapsMB: [90, 91],
          postCapacityHeapsMB: [90, 91],
          heapSlopeMB: 1,
          peakHeapMB: 91,
          mountedWorkspaceCounts: [1],
        },
      },
    })).toEqual([]);
  });
});
