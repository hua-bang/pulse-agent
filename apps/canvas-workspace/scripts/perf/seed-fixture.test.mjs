import { describe, expect, it } from 'vitest';
import {
  PERF_SEED_NOTE_ID,
  PERF_SEED_TRANSFORM,
  buildPerfImageFixture,
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

describe('image-memory fixture', () => {
  const filePaths = Array.from({ length: 10 }, (_, i) => `/tmp/perf-image-${i}.png`);

  it.each([
    { width: 960, height: 772 },
    { width: 480, height: 772 },
    { width: 320, height: 600 },
    { width: 480, height: 200 },
  ])('keeps every lazy image visible in a $width×$height canvas', (viewport) => {
    const { nodes, transform } = buildPerfImageFixture({ filePaths, viewport, now: 123 });

    expect(nodes).toHaveLength(10);
    expect(new Set(nodes.map(node => node.id)).size).toBe(10);
    expect(nodes.map(node => node.data.filePath)).toEqual(filePaths);
    expect(transform.scale).toBeGreaterThan(0);
    expect(transform.scale).toBeLessThanOrEqual(0.5);
    for (const node of nodes) {
      const left = transform.x + node.x * transform.scale;
      const top = transform.y + node.y * transform.scale;
      expect(left).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(top).toBeGreaterThanOrEqual(24 - 1e-6);
      expect(left + node.width * transform.scale).toBeLessThanOrEqual(viewport.width - 24 + 1e-6);
      expect(top + node.height * transform.scale).toBeLessThanOrEqual(viewport.height - 24 + 1e-6);
    }
  });

  it('keeps the seeded note header on screen when it fits beside the grid', () => {
    for (const viewport of [{ width: 448, height: 733 }, { width: 900, height: 733 }]) {
      const { transform } = buildPerfImageFixture({ filePaths, viewport, now: 123 });
      expect(transform.y + 80 * transform.scale).toBeGreaterThanOrEqual(24 - 1e-6);
    }
  });

  it('rejects a missing or collapsed viewport instead of producing an empty measurement', () => {
    for (const viewport of [undefined, { width: 0, height: 772 }, { width: 480, height: 48 }]) {
      expect(() => buildPerfImageFixture({ filePaths, viewport, now: 123 }))
        .toThrow('visible canvas viewport');
    }
    expect(() => buildPerfImageFixture({ filePaths: [], viewport: { width: 480, height: 772 }, now: 123 }))
      .toThrow('requires images');
  });

  it('wraps the grid before shrinking the zoom used by later gesture scenarios', () => {
    for (const viewport of [{ width: 480, height: 772 }, { width: 320, height: 600 }]) {
      const { transform } = buildPerfImageFixture({ filePaths, viewport, now: 123 });
      // The resize scenario needs a 16px corner to remain at least 8px wide.
      expect(transform.scale).toBe(0.5);
    }
  });
});
