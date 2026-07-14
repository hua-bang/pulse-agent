import { describe, expect, it } from 'vitest';
import {
  collectChatStreamMetrics,
  collectColdZoomMetrics,
  collectImageMemoryMetric,
  collectInteractionScenarioMetrics,
  collectPanzoomMetrics,
  collectPtyStreamMetric,
  collectPackageMetrics,
  collectRendererTraceMetrics,
  collectWebviewResidencyMetrics,
  collectWelcomeContentMetric,
  collectWorkspaceCycleMetrics,
  collectZoomSettleMetrics,
} from './collect-metrics.mjs';

describe('collectMetrics WebView residency', () => {
  it('maps a verified discard/restore diagnostic into guest, RSS, and restore metrics', () => {
    expect(collectWebviewResidencyMetrics({
      scenarios: {
        'webview-discard-restore': {
          status: 'measured',
          liveCap: 16,
          before: { domGuests: 29, targetGuests: 29, rssMb: 3304.1 },
          afterDiscard: {
            discarded: 13,
            domGuests: 16,
            live: 16,
            targetGuests: 16,
            rssMb: 2135.4,
            rssReleasedMb: 1168.7,
          },
          restore: {
            readyMs: 268,
            before: { webContentsId: 101, instanceToken: 'old' },
            after: { webContentsId: 202, instanceToken: 'new' },
          },
        },
      },
    })).toEqual([
      {
        id: 'memory.webview_guest_count',
        value: 16,
        runs: 1,
        detail: '29→16 CDP WebView targets · cap 16 · 13 discarded',
      },
      {
        id: 'memory.webview.total_rss_released_mb',
        value: 1168.7,
        runs: 1,
        detail: '3304.1→2135.4 MB after discard',
      },
      {
        id: 'memory.webview.after_discard_rss_mb',
        value: 2135.4,
        runs: 1,
        detail: '29→16 CDP WebView targets · before 3304.1 MB',
      },
      {
        id: 'memory.webview.restore_ready_ms',
        value: 268,
        runs: 1,
        detail: 'new WebContents 101→202 · new document generation verified',
      },
    ]);
  });

  it('rejects incomplete or unverified diagnostic output', () => {
    expect(collectWebviewResidencyMetrics(null)).toEqual([]);
    expect(collectWebviewResidencyMetrics({
      scenarios: {
        'webview-discard-restore': {
          status: 'measured',
          liveCap: 16,
          before: { targetGuests: 29 },
          afterDiscard: { targetGuests: 17, discarded: 12 },
          restore: { readyMs: 200 },
        },
      },
    })).toEqual([]);
  });
});

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

describe('collectMetrics zoom settle coverage', () => {
  it('publishes rest latency plus median and worst settle-window frame evidence', () => {
    expect(collectZoomSettleMetrics({
      scenarios: {
        'zoom-settle': {
          lastWheelToRestMs: 365.9,
          rawLastWheelToRestMs: [358.5, 366.7, 365.9],
          includesSettleTransitionMs: 160,
          report: {
            runs: 3,
            frames: { over20msPct: 0.9, over20msPctMax: 2.7, over20msCountMax: 3 },
            raw: { framesOver20Pct: [0, 0.9, 2.7], framesOver20Count: [0, 1, 3] },
          },
        },
      },
    })).toEqual([
      {
        id: 'interact.zoom_settle.last_wheel_to_rest_ms', value: 365.9, runs: 3,
        raw: [358.5, 366.7, 365.9],
        detail: 'last wheel → moving flags clear + 160ms transition budget',
      },
      {
        id: 'interact.zoom_settle.frames_over20_pct', value: 0.9, runs: 3,
        raw: [0, 0.9, 2.7], detail: 'median 0.9% · max 2.7% · max 3 frames >20ms',
      },
      {
        id: 'interact.zoom_settle.frames_over20_pct_max', value: 2.7, runs: 3,
        raw: [0, 0.9, 2.7], detail: 'max across 3 settle-window runs · 3 frames >20ms',
      },
    ]);
  });

  it('does not manufacture settle metrics from an incomplete scenario', () => {
    expect(collectZoomSettleMetrics({ scenarios: { 'zoom-settle': {} } })).toEqual([]);
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

describe('collectMetrics cold zoom evidence', () => {
  it('publishes the median first wheel only when every run carries cold-start proof', () => {
    expect(collectColdZoomMetrics({
      scenarios: {
        'zoom-cold': {
          report: {
            runs: 3,
            raw: {
              wheelToNextFrameP95: [14.2, 11.8, 12.6],
              wheelToPresentedFrameP95: [30.9, 28.4, 29.2],
              wheelToTransformObservedP95: [14.6, 12.1, 12.9],
            },
            wheelToNextFrame: { count: 1, p95: 12.6, max: 14.2 },
            wheelToPresentedFrame: {
              count: 1,
              p95: 29.2,
              max: 30.9,
              transformObservedP95: 12.9,
              transformChanged: true,
              framesUntilTransform: 1,
              framesAfterTransform: 1,
            },
            coldStartVerified: true,
            transformChanged: true,
          },
        },
      },
    })).toEqual([
      {
        id: 'interact.zoom_cold.first_wheel_to_next_frame_ms',
        value: 12.6,
        runs: 3,
        raw: [14.2, 11.8, 12.6],
        detail: '1 Ctrl+Wheel/run × 3 · idle state verified · transform verified',
      },
      {
        id: 'interact.zoom_cold.first_wheel_to_presented_frame_ms',
        value: 29.2,
        runs: 3,
        raw: [30.9, 28.4, 29.2],
        detail: '1 Ctrl+Wheel/run × 3 · transform observed at 12.9ms · +1 post-transform rAF (presented-frame proxy)',
      },
    ]);
  });

  it('keeps legacy-only reports readable after adding the presented-frame metric', () => {
    expect(collectColdZoomMetrics({
      scenarios: {
        'zoom-cold': {
          report: {
            wheelToNextFrame: { count: 1, p95: 12.6, max: 12.6 },
            coldStartVerified: true,
            transformChanged: true,
          },
        },
      },
    })).toEqual([{
      id: 'interact.zoom_cold.first_wheel_to_next_frame_ms',
      value: 12.6,
      runs: 1,
      detail: '1 Ctrl+Wheel/run × 1 · idle state verified · transform verified',
    }]);
  });

  it('retains the legacy metric when presented-frame evidence is impossible', () => {
    const metrics = collectColdZoomMetrics({
      scenarios: {
        'zoom-cold': {
          report: {
            wheelToNextFrame: { count: 1, p95: 12.6, max: 12.6 },
            wheelToPresentedFrame: {
              count: 1,
              p95: 12.7,
              max: 12.7,
              transformObservedP95: 12.8,
              transformChanged: true,
              framesUntilTransform: 1,
              framesAfterTransform: 1,
            },
            coldStartVerified: true,
            transformChanged: true,
          },
        },
      },
    });

    expect(metrics.map((entry) => entry.id)).toEqual([
      'interact.zoom_cold.first_wheel_to_next_frame_ms',
    ]);
  });

  it.each([
    { coldStartVerified: false, transformChanged: true, count: 1 },
    { coldStartVerified: true, transformChanged: false, count: 1 },
    { coldStartVerified: true, transformChanged: true, count: 2 },
  ])('rejects incomplete or warmed evidence: %o', ({ coldStartVerified, transformChanged, count }) => {
    expect(collectColdZoomMetrics({
      scenarios: {
        'zoom-cold': {
          report: {
            wheelToNextFrame: { count, p95: 12, max: 12 },
            coldStartVerified,
            transformChanged,
          },
        },
      },
    })).toEqual([]);
  });

  it('rejects a repeated result whose raw first-wheel samples are incomplete', () => {
    expect(collectColdZoomMetrics({
      scenarios: {
        'zoom-cold': {
          report: {
            runs: 3,
            raw: { wheelToNextFrameP95: [12, 13] },
            wheelToNextFrame: { count: 1, p95: 12, max: 13 },
            coldStartVerified: true,
            transformChanged: true,
          },
        },
      },
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
