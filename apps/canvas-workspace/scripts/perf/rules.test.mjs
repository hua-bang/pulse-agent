import { describe, expect, it } from 'vitest';
import { buildVerdict, evaluateRules } from './rules.mjs';

const dictionary = {
  aspects: [],
  metrics: [{
    id: 'interact.resize.counter.canvas_save_ipc',
    aspect: 'interact',
    label: '调整尺寸 保存 IPC 次数',
    unit: '次',
  }],
};

describe('evaluateRules missing gates', () => {
  it.each([
    [{ missing: true }, '场景未产出计数器值'],
    [{ missingConfig: true }, '门禁阈值配置缺失'],
  ])('reports the concrete failure reason for %o', (flags, evidence) => {
    const snapshot = {
      timestamp: '2026-07-10T00:00:00.000Z',
      env: {},
      metrics: [{
        id: 'interact.resize.counter.canvas_save_ipc',
        value: null,
        runs: 1,
        pass: false,
        limit: flags.missingConfig ? null : 3,
        ...flags,
      }],
    };

    expect(evaluateRules(dictionary, snapshot, []).alerts[0]).toMatchObject({
      severity: 'high',
      evidence,
    });
  });

  it('surfaces an applicable policy Gate whose metric was never produced', () => {
    const snapshot = { timestamp: '2026-07-10T00:00:00.000Z', env: {}, metrics: [] };

    expect(evaluateRules(dictionary, snapshot, [], {
      policiesById: {
        'interact.resize.counter.canvas_save_ipc': {
          gateStatus: 'unavailable', gateLimit: 3, gateOperator: 'max',
        },
      },
    }).alerts[0]).toMatchObject({
      severity: 'high',
      title: '门禁失败:调整尺寸 保存 IPC 次数',
      evidence: '适用 Gate 指标未产出',
    });
  });
});

describe('evaluateRules diagnostic profiles', () => {
  it('does not compare optional trace timings without an identical trace profile', () => {
    const diagnosticDictionary = {
      aspects: [],
      metrics: [{
        id: 'startup.renderer_reload.lcp_ms',
        aspect: 'startup',
        label: 'renderer reload LCP',
        unit: 'ms',
        comparability: '同机',
        coverageClass: 'diagnostic',
      }],
    };
    const snapshot = {
      timestamp: '2026-07-10T00:01:00.000Z',
      env: { seedNodes: 100 },
      metrics: [{ id: 'startup.renderer_reload.lcp_ms', value: 600 }],
    };
    const history = [{
      timestamp: '2026-07-10T00:00:00.000Z',
      env: { seedNodes: 10 },
      metrics: [{ id: 'startup.renderer_reload.lcp_ms', value: 100 }],
    }];

    expect(evaluateRules(diagnosticDictionary, snapshot, history).alerts).toEqual([]);
  });
});

describe('evaluateRules product targets', () => {
  it('reports a missed P0 target without treating it as a Gate failure', () => {
    const targetDictionary = {
      aspects: [],
      metrics: [{
        id: 'bundle.entry_raw_kb', aspect: 'bundle', label: '入口 chunk raw', unit: 'KB',
        displayPriority: 'primary', direction: 'lower', level: 'gate',
      }],
    };
    const targetSnapshot = {
      timestamp: '2026-07-10T00:00:00.000Z',
      env: {},
      metrics: [{
        id: 'bundle.entry_raw_kb', value: 1380,
        policy: { status: 'missed', target: 1300, warning: 1350, headroom: -80 },
      }],
    };

    expect(evaluateRules(targetDictionary, targetSnapshot, []).alerts).toContainEqual(expect.objectContaining({
      severity: 'medium',
      title: '目标未达:入口 chunk raw',
      ref: 'bundle.entry_raw_kb',
    }));
  });

  it('does not duplicate a target alert when the same metric already failed its Gate', () => {
    const targetDictionary = {
      aspects: [],
      metrics: [{
        id: 'bundle.entry_raw_kb', aspect: 'bundle', label: '入口 chunk raw', unit: 'KB',
        displayPriority: 'primary', direction: 'lower', level: 'gate',
      }],
    };
    const targetSnapshot = {
      timestamp: '2026-07-10T00:00:00.000Z', env: {},
      metrics: [{
        id: 'bundle.entry_raw_kb', value: 1500, pass: false, limit: 1395,
        policy: { status: 'missed', target: 1300, warning: 1350, headroom: -200 },
      }],
    };

    const alerts = evaluateRules(targetDictionary, targetSnapshot, []).alerts;
    expect(alerts.filter((alert) => alert.ref === 'bundle.entry_raw_kb')).toHaveLength(1);
    expect(alerts[0].severity).toBe('high');
  });
});

describe('buildVerdict', () => {
  it('summarizes P0 targets separately from Gates', () => {
    const verdictDictionary = {
      metrics: [
        { id: 'a', displayPriority: 'primary' },
        { id: 'b', displayPriority: 'primary' },
        { id: 'c', displayPriority: 'supporting' },
      ],
    };
    const verdictSnapshot = {
      metrics: [
        { id: 'a', policy: { status: 'met' }, pass: true },
        { id: 'b', policy: { status: 'near-warning' } },
        { id: 'c', pass: true },
      ],
    };

    expect(buildVerdict(verdictDictionary, verdictSnapshot, [])).toBe(
      'P0 目标 1/2 达标(1 接近预警,0 未达标) · Gate 2/2 通过;无 high 回归。',
    );
  });

  it('uses the complete policy Gate summary when an unavailable metric has no entry', () => {
    expect(buildVerdict(
      { metrics: [] },
      { metrics: [] },
      [{ severity: 'high' }],
      { gateSummary: { passed: 13, failed: 1, total: 14 } },
    )).toBe('⚠ P0 目标 0/0 达标(0 接近预警,0 未达标) · Gate 13/14 通过;1 项 high 回归需优先处理。');
  });
});
