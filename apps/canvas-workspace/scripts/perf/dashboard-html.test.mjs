import { describe, expect, it } from 'vitest';
import { renderChunkBars, renderDashboardHtml } from './dashboard-html.mjs';

const dictionary = {
  aspects: [{
    id: 'interact',
    name: '交互',
    question: '多久可用？',
    findings: '测试维度',
    northStar: 'interact.primary',
    next: '继续观察',
    dimensions: [
      { id: 'phase', name: '应用 <就绪>', description: '进程与窗口' },
      { id: 'trace', name: '深入诊断', description: '排障证据' },
    ],
  }],
  metrics: [
    {
      id: 'interact.primary', aspect: 'interact', dimension: 'phase', displayPriority: 'primary',
      label: '关键结果', unit: 'ms', comparability: '同机', level: 'warn', instrumented: true,
      direction: 'lower', measurementProfile: 'local-test',
    },
    {
      id: 'interact.supporting', aspect: 'interact', dimension: 'phase', displayPriority: 'supporting',
      label: '分项观测', unit: '次', comparability: '全局', level: 'gate', instrumented: true,
    },
    {
      id: 'interact.trace', aspect: 'interact', dimension: 'trace', displayPriority: 'diagnostic',
      label: '诊断指标', unit: 'ms', comparability: '同机', level: 'record', instrumented: true,
      coverageClass: 'diagnostic',
    },
  ],
};

const snapshot = (supportingPass = true, primaryStatus = 'met') => ({
  commit: 'abc1234',
  timestamp: '2026-07-10T12:00:00.000Z',
  machineId: 'machine',
  env: { cores: 8, os: 'darwin', seedNodes: 100 },
  metrics: [
    {
      id: 'interact.primary', value: 10, runs: 3, detail: 'primary sample evidence',
      policy: {
        target: 12, warning: 20, status: primaryStatus,
        headroom: primaryStatus === 'met' ? 2 : -2,
        applicable: true, confidence: 'medium', profile: 'local-test', gateStatus: 'not-configured',
      },
    },
    {
      id: 'interact.supporting', value: 2, pass: supportingPass, limit: 3,
      gateOperator: 'max', detail: 'support detail',
    },
  ],
});

const previous = {
  timestamp: '2026-07-09T12:00:00.000Z',
  metrics: [{ id: 'interact.primary', value: 9 }],
};

const render = (supportingPass = true, primaryStatus = 'met') => renderDashboardHtml(
  dictionary,
  snapshot(supportingPass, primaryStatus),
  null,
  { alerts: [], previous },
  '测试结论',
  [],
);

const bundleReport = {
  metrics: { totalJsKB: 2_000, chunkCount: 4 },
  topChunks: [
    { name: 'index-entry.js', rawKB: 600 },
    { name: 'index-lazy.js', rawKB: 280 },
    { name: 'feature.js', rawKB: 120 },
  ],
  entryChunkFileName: 'index-entry.js',
  entryDepAttribution: { chunkFileName: 'index-entry.js', appOwnKB: 100, deps: [] },
};

describe('performance dashboard metric hierarchy', () => {
  it('renders primary summaries and collapsed dimension groups without hiding coverage gaps', () => {
    const html = render();

    expect(html).toContain('data-role="metric-summary"');
    expect(html.match(/data-summary-metric="interact\.primary"/g)).toHaveLength(1);
    expect(html.match(/data-metric-id="interact\.supporting"/g)).toHaveLength(1);
    expect(html.match(/data-metric-id="interact\.trace"/g)).toHaveLength(1);
    expect(html).toContain('P0');
    expect(html).toContain('P1');
    expect(html).toContain('P2');
    expect(html).toContain('应用 &lt;就绪&gt;');
    expect(html).toContain('已埋待采');
    expect(html).toContain('上次 9');
    expect(html).toContain('support detail');
    expect(html).toContain('primary sample evidence');
    expect(html).toContain('repeat 3');
    expect(html).toContain('核心 2/2 · CDP trace 诊断 0/1');
    expect(html).toContain('dot dot-good');
    expect(html).toContain('目标 / 余量');
    expect(html).toContain('目标状态');
    expect(html).toContain('Gate');
    expect(html).toContain('≤ 12');
    expect(html).toContain('余量 2 ms');
    expect(html).toContain('✓ 达标');

    const supportingOpening = html.match(/<details class="metric-dimension metric-dimension-supporting"[\s\S]*?>/)?.[0];
    const diagnosticOpening = html.match(/<details class="metric-dimension metric-dimension-diagnostic"[\s\S]*?>/)?.[0];
    expect(supportingOpening).not.toContain(' open');
    expect(diagnosticOpening).not.toContain(' open');
  });

  it('opens the affected dimension automatically when a gate fails', () => {
    const html = render(false);
    const supportingOpening = html.match(/<details class="metric-dimension metric-dimension-supporting"[\s\S]*?>/)?.[0];

    expect(supportingOpening).toContain(' open');
    expect(html).toContain('1 项 Gate 失败');
    expect(html).toContain('✗ FAIL ≤ 3');
    expect(html).toContain('dot dot-good');
  });

  it('marks only the measured entry chunk and scales the aggregated lazy row', () => {
    const html = renderChunkBars(bundleReport);

    expect(html.match(/<span class="tag">entry<\/span>/g)).toHaveLength(1);
    expect(html).toContain('其余 1 个(懒加载)');
    expect(html).toContain('style="width:100%"');
    expect(html).not.toContain('width:417%');
  });

  it.each([
    ['near-warning', 'warn', '△ 接近预警'],
    ['missed', 'critical', '✗ 未达标'],
  ])('derives aspect health from the P0 target status %s', (status, health, label) => {
    const html = render(true, status);

    expect(html).toContain(`<span class="dot dot-${health}"></span>交互`);
    expect(html).toContain(`data-target-status="${status}"`);
    expect(html).toContain(label);
  });

  it('shows an applicable but unmeasured policy Gate as missing data', () => {
    const missingGateSnapshot = snapshot();
    missingGateSnapshot.metrics = missingGateSnapshot.metrics.filter(
      (metric) => metric.id !== 'interact.supporting',
    );
    const html = renderDashboardHtml(
      dictionary,
      missingGateSnapshot,
      null,
      { alerts: [], previous },
      '测试结论',
      [],
      {
        policiesById: {
          'interact.supporting': {
            target: 3, warning: 4, status: 'pending', headroom: null,
            gateStatus: 'unavailable', gateLimit: 3, gateOperator: 'max',
          },
        },
      },
    );

    expect(html).toContain('data-gate-status="unavailable"');
    expect(html).toContain('✗ 缺测');
  });
});
