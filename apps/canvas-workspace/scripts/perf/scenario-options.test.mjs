import { describe, expect, it } from 'vitest';
import {
  DEFAULT_SCENARIOS,
  DIAGNOSTIC_SCENARIOS,
  buildScenarioRunnerArgs,
  parseReportCliArgs,
  parseScenarioCliArgs,
} from './scenario-options.mjs';

describe('performance scenario CLI options', () => {
  it('runs image-memory only after scale-sensitive interactions and renderer trace', () => {
    const imageIndex = DEFAULT_SCENARIOS.indexOf('image-memory');
    expect(imageIndex).toBeGreaterThan(DEFAULT_SCENARIOS.indexOf('typing'));
    expect(imageIndex).toBeGreaterThan(DEFAULT_SCENARIOS.indexOf('zoom-cold'));
    expect(imageIndex).toBeGreaterThan(DEFAULT_SCENARIOS.indexOf('panzoom'));
    expect(imageIndex).toBeGreaterThan(DEFAULT_SCENARIOS.indexOf('renderer-trace'));
    expect(DEFAULT_SCENARIOS.at(-1)).toBe('ws-cycle');
  });

  it('parses a real URL-webview subset and preserves explicit scenarios', () => {
    expect(parseScenarioCliArgs([
      '--seed-nodes', '86',
      '--seed-webpages', '40',
      '--seed-url-webviews', '25',
      '--repeat', '3',
      '--scenario', 'startup,panzoom',
    ])).toEqual({
      seedNodes: 86,
      seedWebpages: 40,
      seedUrlWebviews: 25,
      repeat: 3,
      scenarios: ['startup', 'panzoom'],
    });
  });

  it('keeps settle coverage in the default workload and allows heavier diagnostics explicitly', () => {
    expect(parseScenarioCliArgs(['--scenario', 'panzoom-trace,zoom-settle,webview-lifecycle,webview-discard-restore']).scenarios)
      .toEqual(['panzoom-trace', 'zoom-settle', 'webview-lifecycle', 'webview-discard-restore']);
    expect(DIAGNOSTIC_SCENARIOS).toEqual([
      'panzoom-trace',
      'webview-lifecycle',
      'webview-discard-restore',
    ]);
    expect(DEFAULT_SCENARIOS).not.toContain('panzoom-trace');
    expect(DEFAULT_SCENARIOS).toContain('zoom-settle');
    expect(DEFAULT_SCENARIOS).not.toContain('webview-lifecycle');
    expect(DEFAULT_SCENARIOS).not.toContain('webview-discard-restore');
  });

  it.each([
    [['--seed-nodes', 'NaN'], /non-negative integer/],
    [['--seed-nodes', '9007199254740992'], /safe non-negative integer/],
    [['--seed-webpages', '1.5'], /non-negative integer/],
    [['--seed-url-webviews', '-1'], /non-negative integer/],
    [['--repeat', '0'], /positive integer/],
    [['--seed-nodes'], /requires a value/],
    [['--seed-nodes', '86', '--seed-nodes', '100'], /specified more than once/],
    [['--unknown', '1'], /unknown option/],
    [['--scenario', 'startup,missing'], /unknown scenario/],
    [['--seed-nodes', '10', '--seed-webpages', '11'], /cannot exceed --seed-nodes/],
    [[
      '--seed-nodes', '10', '--seed-webpages', '5', '--seed-url-webviews', '6',
    ], /cannot exceed --seed-webpages/],
  ])('rejects invalid arguments: %j', (args, message) => {
    expect(() => parseScenarioCliArgs(args)).toThrow(message);
  });
});

describe('performance report scenario forwarding', () => {
  it('uses report defaults and forwards URL-webview fixtures to run-scenarios', () => {
    const options = parseReportCliArgs([
      '--no-build',
      '--seed-nodes', '86',
      '--seed-webpages', '40',
      '--seed-url-webviews', '25',
      '--repeat', '2',
    ]);

    expect(options).toMatchObject({
      bundleOnly: false,
      noBuild: true,
      seedNodes: 86,
      seedWebpages: 40,
      seedUrlWebviews: 25,
      repeat: 2,
    });
    expect(buildScenarioRunnerArgs(options)).toEqual([
      '--seed-nodes', '86',
      '--seed-webpages', '40',
      '--seed-url-webviews', '25',
      '--repeat', '2',
    ]);
    expect(parseReportCliArgs([])).toMatchObject({
      seedNodes: 100,
      seedWebpages: 0,
      seedUrlWebviews: 0,
      repeat: 3,
    });
  });
});
