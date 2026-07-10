import { describe, expect, it } from 'vitest';
import { renderDashboardHtml } from './dashboard-html.mjs';

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

const snapshot = (supportingPass = true) => ({
  commit: 'abc1234',
  timestamp: '2026-07-10T12:00:00.000Z',
  machineId: 'machine',
  env: { cores: 8, os: 'darwin', seedNodes: 100 },
  metrics: [
    { id: 'interact.primary', value: 10, runs: 3, detail: 'primary sample evidence' },
    { id: 'interact.supporting', value: 2, pass: supportingPass, limit: 3, detail: 'support detail' },
  ],
});

const previous = {
  timestamp: '2026-07-09T12:00:00.000Z',
  metrics: [{ id: 'interact.primary', value: 9 }],
};

const render = (supportingPass = true) => renderDashboardHtml(
  dictionary,
  snapshot(supportingPass),
  null,
  { alerts: [], previous },
  '测试结论',
  [],
);

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

    const supportingOpening = html.match(/<details class="metric-dimension metric-dimension-supporting"[\s\S]*?>/)?.[0];
    const diagnosticOpening = html.match(/<details class="metric-dimension metric-dimension-diagnostic"[\s\S]*?>/)?.[0];
    expect(supportingOpening).not.toContain(' open');
    expect(diagnosticOpening).not.toContain(' open');
  });

  it('opens the affected dimension automatically when a gate fails', () => {
    const html = render(false);
    const supportingOpening = html.match(/<details class="metric-dimension metric-dimension-supporting"[\s\S]*?>/)?.[0];

    expect(supportingOpening).toContain(' open');
    expect(html).toContain('1 项失败');
    expect(html).toContain('✗ FAIL ≤ 3');
  });
});
