import { describe, expect, it } from 'vitest';
import { createDefaultEdge } from './edgeFactory';

describe('createDefaultEdge', () => {
  it('stores the canonical high-contrast edge stroke', () => {
    const edge = createDefaultEdge(
      { kind: 'point', x: 0, y: 0 },
      { kind: 'point', x: 100, y: 0 },
    );

    expect(edge.stroke).toEqual({
      color: '#2e2e2e',
      width: 4,
      style: 'solid',
    });
  });
});
