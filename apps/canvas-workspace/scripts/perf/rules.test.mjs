import { describe, expect, it } from 'vitest';
import { evaluateRules } from './rules.mjs';

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
