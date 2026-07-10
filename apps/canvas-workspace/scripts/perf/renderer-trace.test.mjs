import { describe, expect, it } from 'vitest';
import { computeCls, rateWebVital, summarizeRendererReload } from './renderer-trace.mjs';

describe('renderer trace summary', () => {
  it('adds web.dev reference ratings without turning them into gates', () => {
    expect(rateWebVital('lcp', 2_500)).toBe('good');
    expect(rateWebVital('lcp', 2_501)).toBe('needs-improvement');
    expect(rateWebVital('cls', 0.1)).toBe('good');
    expect(rateWebVital('cls', 0.251)).toBe('poor');
  });

  it('uses the maximum CLS session window', () => {
    expect(computeCls([
      { startTime: 100, value: 0.05 },
      { startTime: 800, value: 0.04 },
      { startTime: 2_200, value: 0.2 },
    ])).toBe(0.2);
  });

  it('maps reload vitals, blocking time, and CDP duration deltas', () => {
    const summary = summarizeRendererReload({
      vitals: {
        lcp: { startTime: 140, size: 20 },
        shifts: [{ startTime: 100, value: 0.03 }],
        longTasks: [
          { startTime: 10, duration: 70 },
          { startTime: 100, duration: 80 },
        ],
        paint: { 'first-contentful-paint': 20 },
        settledAt: 200,
      },
      marks: { 'canvas:first-render': 120 },
      beforeMetrics: { metrics: [
        { name: 'TaskDuration', value: 1.8 },
        { name: 'ScriptDuration', value: 1.2 },
        { name: 'LayoutDuration', value: 0.2 },
        { name: 'RecalcStyleDuration', value: 0.3 },
        { name: 'LayoutCount', value: 10 },
        { name: 'RecalcStyleCount', value: 15 },
      ] },
      afterMetrics: { metrics: [
        { name: 'TaskDuration', value: 2 },
        { name: 'ScriptDuration', value: 1.3 },
        { name: 'LayoutDuration', value: 0.25 },
        { name: 'RecalcStyleDuration', value: 0.32 },
        { name: 'LayoutCount', value: 12 },
        { name: 'RecalcStyleCount', value: 18 },
        { name: 'Nodes', value: 321 },
      ] },
    });

    expect(summary).toMatchObject({
      vitals: { lcpMs: 140, lcpRating: 'good', cls: 0.03, clsRating: 'good' },
      window: { fcpMs: 20, firstCanvasMs: 120, settledAtMs: 200 },
      blocking: {
        timeToCanvasMs: 20,
        timeCanvasToLcpMs: 0,
        longTaskCount: 2,
        longTaskMaxMs: 80,
      },
      cpu: {
        taskMs: 200,
        scriptMs: 100,
        recalcStyleMs: 20,
        layoutMs: 50,
        layoutCount: 2,
        recalcStyleCount: 3,
        domNodes: 321,
      },
    });
  });

  it('intersects each task blocking interval with the FCP, canvas, and LCP windows', () => {
    const summary = summarizeRendererReload({
      vitals: {
        lcp: { startTime: 300 },
        longTasks: [
          // Blocking interval [50, 170] contributes [100, 170] before canvas.
          { startTime: 0, duration: 170 },
          // Blocking interval [210, 260] contributes only after canvas.
          { startTime: 160, duration: 100 },
          // Blocking interval [100, 150] sits wholly inside the first window.
          { startTime: 50, duration: 100 },
        ],
        paint: { 'first-contentful-paint': 100 },
        settledAt: 400,
      },
      marks: { 'canvas:first-render': 180 },
      beforeMetrics: { metrics: [] },
      afterMetrics: { metrics: [] },
    });

    expect(summary.blocking).toMatchObject({
      timeToCanvasMs: 120,
      timeCanvasToLcpMs: 50,
    });
  });

  it('reports layout shift count and the five largest shifts', () => {
    const summary = summarizeRendererReload({
      vitals: {
        lcp: { startTime: 300 },
        shifts: [
          { startTime: 10, value: 0.01 },
          { startTime: 20, value: 0.5 },
          { startTime: 30, value: 0.3 },
          { startTime: 40, value: 0.4 },
          { startTime: 50, value: 0.2 },
          { startTime: 60, value: 0.1 },
        ],
        paint: {},
        settledAt: 400,
      },
      marks: {},
      beforeMetrics: { metrics: [] },
      afterMetrics: { metrics: [] },
    });

    expect(summary.vitals.layoutShiftCount).toBe(6);
    expect(summary.vitals.topLayoutShifts).toEqual([
      { startTime: 20, value: 0.5 },
      { startTime: 40, value: 0.4 },
      { startTime: 30, value: 0.3 },
      { startTime: 50, value: 0.2 },
      { startTime: 60, value: 0.1 },
    ]);
  });

  it('handles CDP counters that reset during navigation', () => {
    const summary = summarizeRendererReload({
      vitals: { paint: {}, settledAt: 1 },
      marks: {},
      beforeMetrics: { metrics: [{ name: 'TaskDuration', value: 2 }] },
      afterMetrics: { metrics: [{ name: 'TaskDuration', value: 0.4 }] },
    });

    expect(summary.cpu.taskMs).toBe(400);
  });

  it('keeps unsupported long-task and missing CDP counters unavailable instead of zero', () => {
    const summary = summarizeRendererReload({
      vitals: {
        supported: [],
        lcp: { startTime: 140 },
        longTasks: [],
        paint: { 'first-contentful-paint': 20 },
        settledAt: 200,
      },
      marks: { 'canvas:first-render': 120 },
      beforeMetrics: { metrics: [] },
      afterMetrics: { metrics: [] },
    });

    expect(summary.blocking).toMatchObject({
      timeToCanvasMs: null,
      timeCanvasToLcpMs: null,
      longTaskCount: null,
      longTaskTotalMs: null,
      longTaskMaxMs: null,
    });
    expect(summary.cpu).toMatchObject({
      taskMs: null,
      scriptMs: null,
      recalcStyleMs: null,
      layoutMs: null,
      layoutCount: null,
      recalcStyleCount: null,
      domNodes: null,
    });
  });
});
