import { describe, expect, it, vi } from 'vitest';
import {
  BLANK_CANVAS_BLOCKED_SELECTOR,
  RUNTIME_FIXTURE_VERSION,
  assertCanvasTransformRestored,
  assertDisposableFixtureSession,
  assertUrlWebviewReadiness,
  assertUrlWebviewStatePreserved,
  assertWebviewLifecycleFixture,
  validateWebviewDiscardRestoreMeasurement,
  closeActiveChatDock,
  coldZoomDeltaForScale,
  createScenarioFixtureMetadata,
  isRenderedFixtureReady,
  mergeStartupWelcomeEvidence,
  planExistingFixtureNormalization,
  planSeededFixture,
  planSeededWebpages,
  selectStatePreservationScenarios,
  selectEvenlySpacedOrdinals,
  validateColdZoomRun,
  validateWebviewLifecycleMeasurement,
  waitForCalmFrames,
} from './run-scenarios.mjs';

const tempProfileBaseNodes = [
  { id: 'node-welcome-note', type: 'file', mode: null },
  { id: 'node-welcome-download', type: 'iframe', mode: 'html' },
  { id: 'node-welcome-detail', type: 'file', mode: null },
];

describe('runtime scenario fixtures', () => {
  it('never treats the transient canvas motion shield as a blank input target', () => {
    expect(BLANK_CANVAS_BLOCKED_SELECTOR).toContain('.canvas-interaction-shield');
  });

  it('fails closed when temporary fixture fitting cannot restore the exact canvas transform', () => {
    expect(assertCanvasTransformRestored({ ok: true, expected: '', actual: '' })).toBe(true);
    expect(() => assertCanvasTransformRestored({
      ok: false,
      expected: 'translate(1px, 2px) scale(0.5)',
      actual: 'translate(0px, 0px) scale(1)',
    })).toThrow(/canvas transform restore failed/);
  });

  it('selects an exact, evenly distributed 40 webpage slots for the 86-node fixture', () => {
    const ordinals = selectEvenlySpacedOrdinals(86, 40);

    expect(ordinals).toHaveLength(40);
    expect(new Set(ordinals).size).toBe(40);
    expect(ordinals[0]).toBe(0);
    expect(ordinals.at(-1)).toBe(85);
    expect(ordinals.every((value, index) => index === 0 || value > ordinals[index - 1])).toBe(true);
  });

  it('plans exactly 40 final webpages after accounting for existing canvas nodes', () => {
    const withoutExistingWebpage = planSeededWebpages({
      initialTotal: 3,
      initialWebpages: 0,
      targetTotal: 86,
      targetWebpages: 40,
    });
    const withExistingWebpage = planSeededWebpages({
      initialTotal: 3,
      initialWebpages: 1,
      targetTotal: 86,
      targetWebpages: 40,
    });

    expect(withoutExistingWebpage.ordinals).toHaveLength(40);
    expect(withoutExistingWebpage.expectedWebpages).toBe(40);
    expect(withExistingWebpage.ordinals).toHaveLength(39);
    expect(withExistingWebpage.expectedWebpages).toBe(40);
  });

  it('keeps the default zero and clamps requests to the available slots', () => {
    expect(selectEvenlySpacedOrdinals(86, 0)).toEqual([]);
    expect(selectEvenlySpacedOrdinals(3, 40)).toEqual([0, 1, 2]);
    expect(() => selectEvenlySpacedOrdinals(86, -1)).toThrow(/non-negative integers/);
  });

  it('plans URL webviews as an exact subset of final webpage nodes', () => {
    const plan = planSeededFixture({
      initialTotal: 3,
      initialWebpages: 0,
      initialUrlWebviews: 0,
      targetTotal: 86,
      targetWebpages: 40,
      targetUrlWebviews: 25,
    });

    expect(plan.additions).toBe(83);
    expect(plan.webpageOrdinals).toHaveLength(40);
    expect(plan.urlWebviewOrdinals).toHaveLength(25);
    expect(plan.urlWebviewOrdinals.every((ordinal) => plan.webpageOrdinals.includes(ordinal))).toBe(true);
    expect(plan).toMatchObject({
      expectedTotal: 86,
      expectedWebpages: 40,
      expectedUrlWebviews: 25,
    });
  });

  it('fails safely when an already-full canvas cannot reach the requested type mix', () => {
    expect(() => planSeededFixture({
      initialTotal: 86,
      initialWebpages: 10,
      initialUrlWebviews: 5,
      targetTotal: 86,
      targetWebpages: 40,
      targetUrlWebviews: 25,
    })).toThrow(/no remaining node capacity/);

    expect(() => planSeededFixture({
      initialTotal: 87,
      initialWebpages: 40,
      initialUrlWebviews: 25,
      targetTotal: 86,
      targetWebpages: 40,
      targetUrlWebviews: 25,
    })).toThrow(/already exceeds target/);
  });

  it('accepts an already-full canvas only when the exact fixture mix exists', () => {
    expect(planSeededFixture({
      initialTotal: 86,
      initialWebpages: 40,
      initialUrlWebviews: 25,
      targetTotal: 86,
      targetWebpages: 40,
      targetUrlWebviews: 25,
    })).toMatchObject({
      additions: 0,
      webpageOrdinals: [],
      urlWebviewOrdinals: [],
      expectedTotal: 86,
      expectedWebpages: 40,
      expectedUrlWebviews: 25,
    });
  });

  it('normalizes the real 3-node/1-webview temp base to an exact 100/0/0 fixture', () => {
    const normalized = planExistingFixtureNormalization({
      nodes: tempProfileBaseNodes,
      targetTotal: 100,
      targetWebpages: 0,
      targetUrlWebviews: 0,
    });
    const plan = planSeededFixture({
      initialTotal: normalized.normalizedTotal,
      initialWebpages: normalized.normalizedWebpages,
      initialUrlWebviews: normalized.normalizedUrlWebviews,
      targetTotal: 100,
      targetWebpages: 0,
      targetUrlWebviews: 0,
    });

    expect(normalized).toMatchObject({
      specs: [{ id: 'node-welcome-download', kind: 'text' }],
      normalizedTotal: 3,
      normalizedWebpages: 0,
      normalizedUrlWebviews: 0,
    });
    expect(plan).toMatchObject({ additions: 97, expectedWebpages: 0, expectedUrlWebviews: 0 });
  });

  it('keeps the real temp-base HTML page in an exact 86/40/25 fixture', () => {
    const normalized = planExistingFixtureNormalization({
      nodes: tempProfileBaseNodes,
      targetTotal: 86,
      targetWebpages: 40,
      targetUrlWebviews: 25,
    });
    const plan = planSeededFixture({
      initialTotal: normalized.normalizedTotal,
      initialWebpages: normalized.normalizedWebpages,
      initialUrlWebviews: normalized.normalizedUrlWebviews,
      targetTotal: 86,
      targetWebpages: 40,
      targetUrlWebviews: 25,
    });

    expect(normalized).toMatchObject({
      specs: [{ id: 'node-welcome-download', kind: 'html' }],
      normalizedTotal: 3,
      normalizedWebpages: 1,
      normalizedUrlWebviews: 0,
    });
    expect(plan).toMatchObject({
      additions: 83,
      expectedWebpages: 40,
      expectedUrlWebviews: 25,
    });
    expect(plan.webpageOrdinals).toHaveLength(39);
    expect(plan.urlWebviewOrdinals).toHaveLength(25);
  });

  it('fails instead of rewriting unknown user webpages that exceed the requested mix', () => {
    expect(() => planExistingFixtureNormalization({
      nodes: [
        { id: 'user-note', type: 'text', mode: null },
        { id: 'user-web', type: 'iframe', mode: 'html' },
      ],
      targetTotal: 10,
      targetWebpages: 0,
      targetUrlWebviews: 0,
    })).toThrow(/unknown webpage count .* exceeds target/);
  });

  it('treats Frame title overlays as duplicate DOM shells, not persisted nodes', () => {
    expect(isRenderedFixtureReady({
      perfReady: true,
      total: 105,
      webpages: 40,
      urlWebviews: 25,
    }, {
      expectedTotal: 86,
      expectedWebpages: 40,
      expectedUrlWebviews: 25,
    })).toBe(true);
  });
});

describe('URL webview readiness contract', () => {
  const expected = [
    { id: 'perf-seed-1', url: 'http://127.0.0.1:3210/perf-webview/perf-seed-1' },
    { id: 'perf-seed-2', url: 'http://127.0.0.1:3210/perf-webview/perf-seed-2' },
  ];
  const ready = {
    count: 2,
    items: expected.map((item, index) => ({
      ...item,
      isLoading: false,
      marker: true,
      webContentsId: 101 + index,
      instanceToken: `document-instance-${index + 1}`,
    })),
  };

  it('requires an exact real-webview count plus matching id, URL, load, and marker evidence', () => {
    expect(assertUrlWebviewReadiness(expected, ready)).toEqual(ready.items);
  });

  it('records requested/observed composition and the readiness proof in scenario metadata', () => {
    expect(createScenarioFixtureMetadata({
      seedNodes: 86,
      seedWebpages: 40,
      seedUrlWebviews: 2,
      seeded: { total: 86, webpages: 40, urlWebviews: 2, webviews: ready.items },
    })).toEqual({
      schemaVersion: 'perf-v2',
      sessionProfile: null,
      requested: { nodes: 86, webpages: 40, urlWebviews: 2 },
      observed: { nodes: 86, webpages: 40, urlWebviews: 2, liveUrlWebviews: 2 },
      readinessMarker: '__pulsePerfWebviewReady',
      webviews: ready.items,
      statePreserved: null,
      stateCheckedAfterScenarios: [],
      webviewsAfterInteractions: [],
    });
  });

  it.each([
    [{ ...ready, count: 1 }, /count mismatch/],
    [{ ...ready, items: [{ ...ready.items[0], id: 'wrong' }, ready.items[1]] }, /id mismatch/],
    [{ ...ready, items: [{ ...ready.items[0], url: 'http://wrong' }, ready.items[1]] }, /URL mismatch/],
    [{ ...ready, items: [{ ...ready.items[0], isLoading: true }, ready.items[1]] }, /still loading/],
    [{ ...ready, items: [{ ...ready.items[0], marker: false }, ready.items[1]] }, /readiness marker/],
    [{ ...ready, items: [{ ...ready.items[0], webContentsId: null }, ready.items[1]] }, /WebContents id/],
    [{ ...ready, items: [{ ...ready.items[0], webContentsId: 102 }, ready.items[1]] }, /duplicate WebContents id/],
    [{ ...ready, items: [{ ...ready.items[0], instanceToken: '' }, ready.items[1]] }, /document instance token/],
  ])('rejects incomplete readiness evidence', (observed, message) => {
    expect(() => assertUrlWebviewReadiness(expected, observed)).toThrow(message);
  });

  it('proves the same guest WebContents survive the interaction scenarios', () => {
    expect(assertUrlWebviewStatePreserved(ready.items, structuredClone(ready.items))).toBe(true);
    expect(() => assertUrlWebviewStatePreserved(ready.items, [
      { ...ready.items[0], webContentsId: 999 },
      ready.items[1],
    ])).toThrow(/WebContents changed/);
    expect(() => assertUrlWebviewStatePreserved(ready.items, [
      { ...ready.items[0], instanceToken: 'reloaded-document' },
      ready.items[1],
    ])).toThrow(/document instance changed/);
  });
});

describe('calm-frame readiness', () => {
  it('fails closed with the last observed frame delta when the renderer stays busy', async () => {
    const cdp = {
      send: async () => ({ result: { value: 88.5 } }),
    };

    await expect(waitForCalmFrames(cdp, 5)).rejects.toThrow(/last delta 88.5ms/);
  });
});

describe('runtime scenario UI isolation', () => {
  it('collapses the active chat dock and waits for layout to settle', async () => {
    vi.useFakeTimers();
    try {
      const send = vi.fn()
        .mockResolvedValueOnce({ result: { value: true } })
        .mockResolvedValueOnce({ result: { value: true } })
        .mockResolvedValueOnce({ result: { value: 16.7 } });

      const closing = closeActiveChatDock({ send });
      await vi.advanceTimersByTimeAsync(320);

      await expect(closing).resolves.toBe(true);
      expect(send).toHaveBeenCalledTimes(3);
      expect(send.mock.calls[0][1].expression).toContain(".chat-floating-button--active");
      expect(send.mock.calls[0][1].expression).toContain('toggle.click()');
      expect(send.mock.calls[1][1].expression).toContain("data-expanded");
    } finally {
      vi.useRealTimers();
    }
  });

  it('does nothing when chat is already collapsed', async () => {
    const send = vi.fn().mockResolvedValue({ result: { value: false } });

    await expect(closeActiveChatDock({ send })).resolves.toBe(false);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('runtime fixture isolation', () => {
  it('uses a new fixture version and restricts real URL webviews to disposable temp profiles', () => {
    expect(RUNTIME_FIXTURE_VERSION).toBe('perf-v2');
    expect(assertDisposableFixtureSession({ profile: 'temp' }, 25)).toBe(true);
    expect(assertDisposableFixtureSession({ profile: 'real' }, 0)).toBe(true);
    expect(() => assertDisposableFixtureSession({ profile: 'real' }, 1)).toThrow(/profile=temp/);
    expect(() => assertDisposableFixtureSession({ profile: 'clone' }, 1)).toThrow(/profile=temp/);
  });

  it('requires a real loopback guest only when webview-lifecycle is selected explicitly', () => {
    expect(assertWebviewLifecycleFixture(['panzoom'], 0)).toBe(true);
    expect(assertWebviewLifecycleFixture(['webview-lifecycle'], 1)).toBe(true);
    expect(() => assertWebviewLifecycleFixture(['webview-lifecycle'], 0)).toThrow(/loopback guest/);
    expect(assertWebviewLifecycleFixture(['webview-discard-restore'], 17)).toBe(true);
    expect(() => assertWebviewLifecycleFixture(['webview-discard-restore'], 16)).toThrow(/at least 17/);
  });
});

describe('URL webview state-check scope', () => {
  it('keeps state preservation unchecked for startup/trace-only and non-scale runs', () => {
    expect(selectStatePreservationScenarios(['startup', 'renderer-trace'])).toEqual([]);
    expect(selectStatePreservationScenarios(['typing'])).toEqual([]);
  });

  it('records the interactions actually completed when zoom or pan makes the check meaningful', () => {
    expect(selectStatePreservationScenarios(['typing', 'panzoom'])).toEqual([
      'typing',
      'panzoom',
    ]);
    expect(selectStatePreservationScenarios(['panzoom', 'zoom-cold'])).toEqual([
      'zoom-cold',
      'panzoom',
    ]);
    expect(selectStatePreservationScenarios(['zoom-settle', 'panzoom-trace'])).toEqual([
      'panzoom-trace',
      'zoom-settle',
    ]);
    expect(selectStatePreservationScenarios(['webview-lifecycle'])).toEqual(['webview-lifecycle']);
    expect(selectStatePreservationScenarios(['webview-discard-restore'])).toEqual([]);
  });
});

describe('webview-discard-restore diagnostic contract', () => {
  it('requires a hard guest cap and a new document generation with restored state', () => {
    const measurement = {
      liveCap: 16,
      before: { domGuests: 29, targetGuests: 29 },
      afterDiscard: { discarded: 13, domGuests: 16, live: 16, targetGuests: 16 },
      restore: {
        after: { instanceToken: 'new', scrollY: 420, url: 'https://example.com/restored', webContentsId: 202 },
        before: { instanceToken: 'old', scrollY: 420, url: 'https://example.com/restored', webContentsId: 101 },
        readyMs: 180,
      },
    };

    expect(validateWebviewDiscardRestoreMeasurement(measurement)).toBe(measurement);
    expect(() => validateWebviewDiscardRestoreMeasurement({
      ...measurement,
      afterDiscard: { ...measurement.afterDiscard, targetGuests: 17 },
    })).toThrow(/target guest cap/);
    expect(() => validateWebviewDiscardRestoreMeasurement({
      ...measurement,
      restore: {
        ...measurement.restore,
        after: { ...measurement.restore.after, webContentsId: 101 },
      },
    })).toThrow(/WebContents generation/);
  });
});

describe('webview-lifecycle diagnostic contract', () => {
  const target = {
    id: 'perf-seed-1',
    url: 'http://127.0.0.1:3210/perf-webview/perf-seed-1',
    webContentsId: 101,
    instanceToken: 'document-instance-1',
  };
  const other = {
    id: 'perf-seed-2',
    url: 'http://127.0.0.1:3210/perf-webview/perf-seed-2',
    webContentsId: 102,
    instanceToken: 'document-instance-2',
  };
  const surface = ({ targetVisibility = 'visible', targetIntersects = false }) => ({
    total: 2,
    expected: 2,
    offscreen: targetIntersects ? 0 : 1,
    cssHidden: targetVisibility === 'hidden' ? 1 : 0,
    intersecting: targetIntersects ? 2 : 1,
    items: [
      {
        ...target,
        mounted: true,
        visibility: targetVisibility,
        intersectsViewport: targetIntersects,
      },
      {
        ...other,
        mounted: true,
        visibility: 'visible',
        intersectsViewport: true,
      },
    ],
  });
  const stateToken = `webview-lifecycle-state:${target.instanceToken}`;
  const envelope = (value, overrides = {}) => ({
    ok: true,
    url: target.url,
    webContentsId: target.webContentsId,
    visibility: 'visible',
    value: {
      marker: true,
      instanceToken: target.instanceToken,
      stateToken,
      ...value,
    },
    ...overrides,
  });
  const valid = () => ({
    expectedGuests: 2,
    surfaceBefore: surface({}),
    surfaceAfterOffscreen: surface({}),
    surfaceVisible: surface({
      targetIntersects: true,
    }),
    surfaceRestored: surface({}),
    baseline: target,
    installed: envelope({ installed: true }),
    offscreenStart: envelope({ raf: 0, interval: 0, elapsedMs: 0 }),
    offscreenEnd: envelope({ raf: 1, interval: 2, elapsedMs: 1_000 }),
    visibleStart: envelope(
      { raf: 2, interval: 3, elapsedMs: 1_100 },
    ),
    visibleEnd: envelope(
      { raf: 62, interval: 103, elapsedMs: 2_100 },
    ),
    cleanup: envelope({ cleaned: true }),
    relocation: { ok: true },
    restore: {
      ok: true,
      intersectsViewport: false,
      translateRestored: true,
      zIndexRestored: true,
    },
    measurementWindowMs: 1_000,
  });

  it('reports native offscreen/visible deltas and continuity for the same guest', () => {
    expect(validateWebviewLifecycleMeasurement(valid())).toEqual({
      schemaVersion: 1,
      status: 'measured',
      measurementWindowMs: 1_000,
      guests: { total: 2, offscreen: 1, cssHidden: 0, intersecting: 1 },
      target,
      offscreen: { raf: 1, interval: 2, elapsedMs: 1_000 },
      visible: { raf: 60, interval: 100, elapsedMs: 1_000 },
      phaseContrast: {
        rafReductionPct: 98.3,
        intervalReductionPct: 98,
        attribution: 'native-geometric-offscreen-vs-visible-relocate',
        cssIncrementalBenefitMeasured: false,
      },
      lifecycle: {
        offscreenBefore: true,
        relocatedIntoViewport: true,
        geometryRestored: true,
        offscreenRestored: true,
      },
      continuity: {
        webContentsIdPreserved: true,
        documentInstancePreserved: true,
        readinessMarkerPreserved: true,
        domStatePreserved: true,
      },
      cleanup: { guestProbeRemoved: true },
    });
  });

  it('fails instead of fabricating zeros for missing offscreen or visible samples', () => {
    const noOffscreenGuest = valid();
    noOffscreenGuest.surfaceBefore = surface({ targetIntersects: true });
    expect(() => validateWebviewLifecycleMeasurement(noOffscreenGuest)).toThrow(/no geometrically offscreen guest/);

    const noVisibleActivity = valid();
    noVisibleActivity.visibleEnd = envelope(
      { raf: 2, interval: 3, elapsedMs: 2_100 },
    );
    expect(() => validateWebviewLifecycleMeasurement(noVisibleActivity)).toThrow(/visible sample is insufficient/);
  });

  it('rejects guest replacement, DOM-state loss, and incomplete cleanup', () => {
    const replaced = valid();
    replaced.visibleEnd = { ...replaced.visibleEnd, webContentsId: 999 };
    expect(() => validateWebviewLifecycleMeasurement(replaced)).toThrow(/WebContents changed/);

    const stateLost = valid();
    stateLost.visibleEnd = {
      ...stateLost.visibleEnd,
      value: { ...stateLost.visibleEnd.value, stateToken: 'lost' },
    };
    expect(() => validateWebviewLifecycleMeasurement(stateLost)).toThrow(/DOM state changed/);

    const leaked = valid();
    leaked.cleanup = envelope({ cleaned: false, reason: 'timer still installed' });
    expect(() => validateWebviewLifecycleMeasurement(leaked)).toThrow(/cleanup failed/);

    const geometryLeaked = valid();
    geometryLeaked.restore = { ...geometryLeaked.restore, translateRestored: false };
    expect(() => validateWebviewLifecycleMeasurement(geometryLeaked)).toThrow(/geometry was restored/);
  });
});

describe('startup welcome evidence across exact seeding', () => {
  it('narrowly falls back to the pre-seed welcome mark without replacing N-node marks', () => {
    expect(mergeStartupWelcomeEvidence({
      startup: {
        rendererMarks: { 'canvas:first-render': 412 },
        welcomeLocalContentMs: undefined,
      },
      initialWelcomeLocalContentMs: 138,
    })).toEqual({
      rendererMarks: { 'canvas:first-render': 412 },
      welcomeLocalContentMs: 138,
      welcomeLocalContentSource: 'initial-pre-seed',
    });
  });

  it('keeps the seeded-reload welcome mark when that fixture still has one', () => {
    expect(mergeStartupWelcomeEvidence({
      startup: { welcomeLocalContentMs: 155 },
      initialWelcomeLocalContentMs: 138,
    })).toEqual({
      welcomeLocalContentMs: 155,
      welcomeLocalContentSource: 'seeded-reload',
    });
  });
});

describe('cold zoom run contract', () => {
  const valid = {
    restBefore: { canvasMoving: false, transformMoving: false },
    wheelToNextFrame: { count: 1, p95: 12.4, max: 12.4 },
    wheelToPresentedFrame: {
      count: 1,
      p95: 29.1,
      max: 29.1,
      transformObservedP95: 12.8,
      transformChanged: true,
      framesUntilTransform: 1,
      framesAfterTransform: 1,
    },
    transformBefore: 'matrix(1, 0, 0, 1, 0, 0)',
    transformAfter: 'matrix(0.9, 0, 0, 0.9, 10, 10)',
  };

  it('chooses a delta away from either scale clamp', () => {
    expect(coldZoomDeltaForScale(0.1)).toBe(-20);
    expect(coldZoomDeltaForScale(1)).toBe(20);
    expect(coldZoomDeltaForScale(4)).toBe(20);
    expect(() => coldZoomDeltaForScale(0)).toThrow(/positive/);
  });

  it('accepts only one transform-changing wheel from a verified rest state', () => {
    expect(validateColdZoomRun(valid)).toEqual({
      coldStartVerified: true,
      transformChanged: true,
    });
  });

  it('rejects a warmed canvas, multiple wheels, or a no-op transform', () => {
    expect(() => validateColdZoomRun({
      ...valid,
      restBefore: { canvasMoving: true, transformMoving: true },
    })).toThrow(/verified idle canvas/);
    expect(() => validateColdZoomRun({
      ...valid,
      wheelToNextFrame: { count: 2, p95: 12.4, max: 12.4 },
    })).toThrow(/exactly one measured wheel/);
    expect(() => validateColdZoomRun({
      ...valid,
      transformAfter: valid.transformBefore,
    })).toThrow(/did not change/);
  });

  it('rejects a presented-frame sample without transform or later-frame proof', () => {
    expect(() => validateColdZoomRun({
      ...valid,
      wheelToPresentedFrame: {
        ...valid.wheelToPresentedFrame,
        framesAfterTransform: 0,
      },
    })).toThrow(/post-transform frame evidence/);
    expect(() => validateColdZoomRun({
      ...valid,
      wheelToPresentedFrame: {
        ...valid.wheelToPresentedFrame,
        transformChanged: false,
      },
    })).toThrow(/transform and post-transform frame evidence/);
  });

  it('rejects impossible presented-frame timing order', () => {
    expect(() => validateColdZoomRun({
      ...valid,
      wheelToPresentedFrame: {
        ...valid.wheelToPresentedFrame,
        p95: 12.7,
        transformObservedP95: 12.8,
      },
    })).toThrow(/before the transform observation/);
    expect(() => validateColdZoomRun({
      ...valid,
      wheelToPresentedFrame: {
        ...valid.wheelToPresentedFrame,
        p95: 12.3,
        transformObservedP95: 12.2,
      },
    })).toThrow(/before the legacy next-frame probe/);
  });
});
