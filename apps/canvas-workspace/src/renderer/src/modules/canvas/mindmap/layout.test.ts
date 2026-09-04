import { describe, expect, it } from 'vitest';
import type { MindmapTopic } from '../../../types';
import { layoutMindmap } from '..';

const topic = (id: string, text: string, children: MindmapTopic[] = []): MindmapTopic => ({
  id,
  text,
  children,
});

describe('Canvas mindmap layout', () => {
  it('allocates wrapped topic height without overlapping the next sibling', () => {
    const layout = layoutMindmap(topic('root', 'Root', [
      topic('long', 'This topic is intentionally long enough to wrap across multiple lines in its pill'),
      topic('next', 'Next'),
    ]), { topicWidth: 100, vGap: 14 });
    const long = layout.topics.find((item) => item.id === 'long')!;
    const next = layout.topics.find((item) => item.id === 'next')!;
    expect(long.height).toBeGreaterThan(34);
    expect(next.y).toBeGreaterThanOrEqual(long.y + long.height + 14);
  });

  it('keeps a collapsed topic visible while excluding its descendants', () => {
    const collapsed = { ...topic('branch', 'Branch', [topic('hidden', 'Hidden')]), collapsed: true };
    expect(layoutMindmap(topic('root', 'Root', [collapsed])).topics.map((item) => item.id))
      .toEqual(['root', 'branch']);
  });
});
