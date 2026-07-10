import { describe, expect, it } from 'vitest';
import { compareCounterGates } from './runtime-gates.mjs';

const baselines = {
  runtime: {
    drag: { counters: { 'nodes-array-replace': { max: 10 } } },
    resize: {
      counters: {
        'nodes-array-replace': { max: 10 },
        'canvas-save-ipc': { max: 3 },
      },
    },
  },
};

const dictionary = {
  metrics: [
    { id: 'interact.resize.counter.nodes_array_replace', level: 'gate' },
    { id: 'interact.resize.counter.canvas_save_ipc', level: 'gate' },
  ],
};

describe('compareCounterGates', () => {
  it('uses policy Gate values as the SSOT when runtimeCounter metadata is present', () => {
    const policyBaselines = {
      policies: {
        'chat.stream.md_render_count': {
          gate: { kind: 'max', value: 80, scope: 'runtime' },
        },
        'chat.stream.commit_count': {
          gate: { kind: 'max', value: 80, scope: 'runtime' },
        },
      },
    };
    const policyDictionary = {
      metrics: [
        {
          id: 'chat.stream.md_render_count', level: 'gate',
          runtimeCounter: { scenario: 'chat-stream', counter: 'chat-md-stream-render' },
        },
        {
          id: 'chat.stream.commit_count', level: 'gate',
          runtimeCounter: { scenario: 'chat-stream', counter: 'chat-stream-commit' },
        },
      ],
    };

    expect(compareCounterGates(policyBaselines, {
      'chat-stream': {
        report: { counters: { 'chat-md-stream-render': 64, 'chat-stream-commit': 65 } },
      },
    }, ['chat-stream'], policyDictionary)).toEqual([
      { scenario: 'chat-stream', counter: 'chat-md-stream-render', max: 80, value: 64, pass: true },
      { scenario: 'chat-stream', counter: 'chat-stream-commit', max: 80, value: 65, pass: true },
    ]);
  });

  it('passes selected resize counters within their deterministic budgets', () => {
    expect(compareCounterGates(baselines, {
      resize: { report: { counters: { 'nodes-array-replace': 2, 'canvas-save-ipc': 1 } } },
    }, ['resize'])).toEqual([
      { scenario: 'resize', counter: 'nodes-array-replace', max: 10, value: 2, pass: true },
      { scenario: 'resize', counter: 'canvas-save-ipc', max: 3, value: 1, pass: true },
    ]);
  });

  it('fails a counter that exceeds its budget', () => {
    const [gate] = compareCounterGates(baselines, {
      resize: { report: { counters: { 'nodes-array-replace': 11, 'canvas-save-ipc': 1 } } },
    }, ['resize']);

    expect(gate).toEqual({
      scenario: 'resize', counter: 'nodes-array-replace', max: 10, value: 11, pass: false,
    });
  });

  it('fails closed when a selected scenario or counter did not produce data', () => {
    expect(compareCounterGates(baselines, {}, ['resize'])).toEqual([
      { scenario: 'resize', counter: 'nodes-array-replace', max: 10, value: null, pass: false, missing: true },
      { scenario: 'resize', counter: 'canvas-save-ipc', max: 3, value: null, pass: false, missing: true },
    ]);

    const gates = compareCounterGates(baselines, {
      resize: { report: { counters: { 'nodes-array-replace': 2 } } },
    }, ['resize']);
    expect(gates[1]).toEqual({
      scenario: 'resize', counter: 'canvas-save-ipc', max: 3, value: null, pass: false, missing: true,
    });
  });

  it('does not require an intentionally unselected scenario', () => {
    expect(compareCounterGates(baselines, {}, ['typing'])).toEqual([]);
  });

  it('fails closed when a selected gated scenario has no baseline configuration', () => {
    expect(compareCounterGates({ runtime: {} }, {
      resize: { report: { counters: { 'nodes-array-replace': 2, 'canvas-save-ipc': 1 } } },
    }, ['resize'], dictionary)).toEqual([
      {
        scenario: 'resize', counter: 'nodes-array-replace', max: null,
        value: 2, pass: false, missingConfig: true,
      },
      {
        scenario: 'resize', counter: 'canvas-save-ipc', max: null,
        value: 1, pass: false, missingConfig: true,
      },
    ]);
  });

  it('fails closed when one required counter is missing from a configured scenario', () => {
    const incomplete = {
      runtime: {
        resize: { counters: { 'nodes-array-replace': { max: 10 } } },
      },
    };

    expect(compareCounterGates(incomplete, {
      resize: { report: { counters: { 'nodes-array-replace': 2, 'canvas-save-ipc': 1 } } },
    }, ['resize'], dictionary)).toEqual([
      { scenario: 'resize', counter: 'nodes-array-replace', max: 10, value: 2, pass: true },
      {
        scenario: 'resize', counter: 'canvas-save-ipc', max: null,
        value: 1, pass: false, missingConfig: true,
      },
    ]);
  });
});
