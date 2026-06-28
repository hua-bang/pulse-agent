import type { CanvasNode } from '../types';

/**
 * Deterministic fixtures for performance benchmarks. Inputs MUST be identical
 * across runs for before/after comparisons to mean anything, so these use a
 * seeded PRNG (mulberry32) rather than Math.random().
 */

export const makeRng = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export interface MakeNodesOptions {
  /** Fraction of nodes that are frame/group containers. */
  containerRatio?: number;
  seed?: number;
  /** Square canvas extent the nodes are scattered across. */
  extent?: number;
}

/**
 * Build a canvas node array with a mix of large container nodes (frame/group)
 * and regular nodes scattered so many fall spatially inside a container. This
 * exercises the O(nodes x containers) parent-resolution hot path.
 */
export const makeNodes = (n: number, opts: MakeNodesOptions = {}): CanvasNode[] => {
  const { containerRatio = 0.15, seed = 1, extent = 20000 } = opts;
  const rng = makeRng(seed);
  const nodes: CanvasNode[] = [];
  const containerCount = Math.floor(n * containerRatio);

  for (let i = 0; i < containerCount; i++) {
    const size = 800 + rng() * 2400;
    nodes.push({
      id: `c${i}`,
      type: rng() < 0.5 ? 'frame' : 'group',
      title: `c${i}`,
      x: rng() * extent,
      y: rng() * extent,
      width: size,
      height: size,
      data: {} as CanvasNode['data'],
    });
  }

  for (let i = 0; i < n - containerCount; i++) {
    nodes.push({
      id: `n${i}`,
      type: 'text',
      title: `n${i}`,
      x: rng() * extent,
      y: rng() * extent,
      width: 200 + rng() * 200,
      height: 120 + rng() * 120,
      data: {} as CanvasNode['data'],
    });
  }

  return nodes;
};
