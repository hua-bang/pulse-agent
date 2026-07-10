import { describe, expect, it } from 'vitest';
import {
  collectChatStreamMetrics,
  collectImageMemoryMetric,
  collectInteractionScenarioMetrics,
  collectPtyStreamMetric,
  collectWelcomeWebviewMetric,
} from './collect-metrics.mjs';

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
              counters: [
                { 'nodes-array-replace': 1, 'canvas-save-ipc': 1 },
                { 'nodes-array-replace': 2, 'canvas-save-ipc': 1 },
                { 'nodes-array-replace': 2, 'canvas-save-ipc': 1 },
              ],
            },
            interactions: { p95: 13 },
            frames: { over20msPct: 1.5 },
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
      { id: 'interact.resize.frames_over20_pct', value: 1.5, runs: 3, raw: [1, 2, 1.5] },
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
            counters: { 'chat-md-render': 2, 'chat-md-cache-hit': 2 },
          },
          markdownRenders: 64,
          tailBurstMs: 0.8,
        },
      },
      gates: [{
        scenario: 'chat-stream', counter: 'chat-md-stream-render', max: 80, value: 64, pass: true,
      }],
    })).toEqual([
      { id: 'chat.stream.frames_over20_pct', value: 0.3, runs: 1 },
      { id: 'chat.stream.md_render_count', value: 64, runs: 1, pass: true, limit: 80 },
      { id: 'chat.stream.tail_burst_ms', value: 0.8, runs: 1 },
      { id: 'chat.stream.md_cache_hit_ratio', value: 50, runs: 1 },
    ]);
  });
});

describe('collectMetrics remaining scenario coverage', () => {
  it('maps welcome webview completion and dual-PTY IPC throughput', () => {
    const scenarios = {
      scenarios: {
        startup: { welcomeWebviewMs: 438 },
        'pty-stream': {
          terminals: 2,
          events: 96,
          durationMs: 1200,
          ipcPerSec: 80,
        },
      },
    };
    expect(collectWelcomeWebviewMetric(scenarios)).toEqual({
      id: 'startup.welcome_webview_ms', value: 438, runs: 1,
    });
    expect(collectPtyStreamMetric(scenarios)).toEqual({
      id: 'main.pty.ipc_per_sec',
      value: 80,
      runs: 1,
      detail: '2 terminals · 96 IPC events · 1200 ms',
    });
  });
});
