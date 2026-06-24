import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../types';
import { detectMention, filterMentionCandidates } from './noteMention';

const node = (id: string, title: string): CanvasNode =>
  ({ id, type: 'file', title, x: 0, y: 0, width: 1, height: 1, data: {} } as unknown as CanvasNode);

describe('detectMention', () => {
  it('detects a bare @ at the start', () => {
    expect(detectMention('@')).toEqual({ query: '', atIndex: 0 });
  });

  it('detects @query after whitespace', () => {
    expect(detectMention('hello @foo')).toEqual({ query: 'foo', atIndex: 6 });
  });

  it('reports the @ offset so the trigger range can be deleted', () => {
    const t = detectMention('a b @plan');
    expect(t).not.toBeNull();
    expect('a b @plan'.slice(t!.atIndex)).toBe('@plan');
  });

  it('does not fire inside a word (e.g. emails)', () => {
    expect(detectMention('mail me at a@b')).toBeNull();
  });

  it('stops at whitespace after the query', () => {
    expect(detectMention('@foo bar')).toBeNull();
  });
});

describe('filterMentionCandidates', () => {
  const nodes = [node('1', 'Roadmap'), node('2', 'Design Notes'), node('3', 'roadside')];

  it('returns all (capped) for an empty query', () => {
    expect(filterMentionCandidates(nodes, '').map((n) => n.id)).toEqual(['1', '2', '3']);
  });

  it('matches title case-insensitively', () => {
    expect(filterMentionCandidates(nodes, 'road').map((n) => n.id)).toEqual(['1', '3']);
  });

  it('returns nothing when no title matches', () => {
    expect(filterMentionCandidates(nodes, 'zzz')).toEqual([]);
  });
});
