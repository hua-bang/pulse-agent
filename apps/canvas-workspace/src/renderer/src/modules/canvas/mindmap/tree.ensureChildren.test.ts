import { describe, expect, it } from 'vitest';
import type { MindmapTopic } from '../../../types';
import { ensureTopicChildren } from './tree';
import { layoutMindmap } from './layout';

describe('ensureTopicChildren', () => {
  it('returns a well-formed tree untouched', () => {
    const root: MindmapTopic = { id: 'r', text: 'root', children: [{ id: 'a', text: 'a', children: [] }] };
    expect(ensureTopicChildren(root)).toBe(root);
  });

  it('repairs nested topics missing children so layout does not throw', () => {
    const broken = {
      id: 'r',
      text: 'root',
      children: [{ id: 'a', text: 'a', children: [{ id: 'b', text: 'b' }] }],
    } as unknown as MindmapTopic;
    expect(() => layoutMindmap(broken)).toThrow();
    const fixed = ensureTopicChildren(broken);
    expect(fixed.children[0].children[0].children).toEqual([]);
    expect(() => layoutMindmap(fixed)).not.toThrow();
  });
});
