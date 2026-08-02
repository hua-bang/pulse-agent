import { describe, expect, it } from 'vitest';
import {
  PERF_SEED_NOTE_ID,
  PERF_SEED_TRANSFORM,
  buildPerfSeedNodes,
} from './seed-fixture.mjs';

describe('performance seed fixture', () => {
  it('provides an editable, visible note without depending on welcome content', () => {
    const nodes = buildPerfSeedNodes({
      existingNodes: [],
      count: 100,
      webpageCount: 0,
      webpageHtml: '<p>perf</p>',
      noteFilePath: '/tmp/perf-benchmark.md',
      noteFileName: 'perf-benchmark.md',
      noteId: PERF_SEED_NOTE_ID,
      now: 123,
    });

    expect(nodes).toHaveLength(100);
    expect(nodes[0]).toMatchObject({
      id: PERF_SEED_NOTE_ID,
      type: 'file',
      title: 'perf-benchmark',
      x: 80,
      y: 80,
      data: {
        filePath: '/tmp/perf-benchmark.md',
        saved: true,
        modified: false,
      },
    });
    expect(PERF_SEED_TRANSFORM).toEqual({ x: 0, y: 0, scale: 0.8 });
  });

  it('preserves existing nodes and keeps the requested webpage mix', () => {
    const existing = [{ id: 'existing', type: 'text', data: {}, x: 0, y: 0 }];
    const nodes = buildPerfSeedNodes({
      existingNodes: existing,
      count: 10,
      webpageCount: 3,
      webpageHtml: '<p>perf</p>',
      noteFilePath: '/tmp/perf-benchmark.md',
      noteFileName: 'perf-benchmark.md',
      noteId: PERF_SEED_NOTE_ID,
      now: 123,
    });

    expect(nodes).toHaveLength(10);
    expect(nodes).toContain(existing[0]);
    expect(nodes.filter((node) => node.type === 'iframe')).toHaveLength(3);
  });
});
