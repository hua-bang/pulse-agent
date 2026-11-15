import { describe, expect, it } from 'vitest';
import type { CanvasEdge } from '../../../types';
import { cloneEdgesForPaste, internalEdges } from './pasteEdges';

const edge = (id: string, source: string | null, target: string | null): CanvasEdge => ({
  id,
  source: source ? { kind: 'node', nodeId: source } : { kind: 'point', x: 0, y: 0 },
  target: target ? { kind: 'node', nodeId: target } : { kind: 'point', x: 10, y: 10 },
  label: id,
});

describe('internalEdges', () => {
  it('keeps only edges with both ends on selected nodes', () => {
    const edges = [edge('in', 'a', 'b'), edge('out', 'a', 'z'), edge('free', 'a', null)];
    expect(internalEdges(edges, new Set(['a', 'b'])).map((e) => e.id)).toEqual(['in']);
  });
});

describe('cloneEdgesForPaste', () => {
  it('gives copies new ids and moves their ends to the pasted nodes', () => {
    const idMap = new Map([['a', 'a2'], ['b', 'b2']]);
    const [copy] = cloneEdgesForPaste([edge('in', 'a', 'b'), edge('out', 'a', 'z')], idMap, 5);
    expect(copy.id).not.toBe('in');
    expect(copy.source).toEqual({ kind: 'node', nodeId: 'a2' });
    expect(copy.target).toEqual({ kind: 'node', nodeId: 'b2' });
    expect(copy.label).toBe('in');
    expect(copy.updatedAt).toBe(5);
  });

  it('copies nothing when no edge is internal', () => {
    expect(cloneEdgesForPaste([edge('out', 'a', 'z')], new Map([['a', 'a2']]))).toEqual([]);
  });
});
