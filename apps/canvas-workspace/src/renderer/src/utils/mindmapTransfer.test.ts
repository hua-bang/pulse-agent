import { describe, expect, it } from 'vitest';
import type { CanvasNode, MindmapNodeData, MindmapTopic } from '../types';
import {
  getSelectionAfterMindmapMerge,
  mergeMindmapTopic,
  splitMindmapTopic,
} from './mindmapTransfer';

const topic = (
  id: string,
  text: string,
  children: MindmapTopic[] = [],
): MindmapTopic => ({ id, text, children });

const mindmap = (
  id: string,
  root: MindmapTopic,
  x = 0,
  y = 0,
): CanvasNode => ({
  id,
  type: 'mindmap',
  title: root.text,
  x,
  y,
  width: 320,
  height: 180,
  data: { root, layout: 'right', rev: 0 } satisfies MindmapNodeData,
  updatedAt: 1,
});

const rootOf = (node: CanvasNode): MindmapTopic =>
  (node.data as MindmapNodeData).root;

describe('mindmap transfers', () => {
  it('moves a branch into another mindmap and rekeys the full subtree', () => {
    const source = mindmap('source', topic('source-root', 'Source', [
      {
        id: 'collision',
        text: 'Moved branch',
        color: '#ef4444',
        collapsed: true,
        children: [topic('nested', 'Nested')],
      },
      topic('stays', 'Stays'),
    ]));
    const target = mindmap('target', topic('target-root', 'Target', [
      topic('collision', 'Existing'),
    ]));
    let nextId = 0;

    const result = mergeMindmapTopic([source, target], {
      sourceNodeId: 'source',
      sourceTopicId: 'collision',
      targetNodeId: 'target',
      target: { kind: 'child', parentId: 'target-root' },
      createTopicId: () => `moved-${++nextId}`,
    });

    expect(result).not.toBeNull();
    expect(rootOf(result!.nodes[0]).children.map((child) => child.id))
      .toEqual(['stays']);
    expect(rootOf(result!.nodes[1]).children).toEqual([
      topic('collision', 'Existing'),
      {
        id: 'moved-1',
        text: 'Moved branch',
        color: '#ef4444',
        collapsed: true,
        children: [topic('moved-2', 'Nested')],
      },
    ]);
    expect(result!.insertedTopicId).toBe('moved-1');
    expect(result!.removedNodeId).toBeUndefined();
  });

  it('merges a whole mindmap by attaching its root and removing its canvas node', () => {
    const source = mindmap('source', topic('source-root', 'Source', [
      topic('source-child', 'Child'),
    ]));
    const target = mindmap('target', topic('target-root', 'Target'));
    let nextId = 0;

    const result = mergeMindmapTopic([source, target], {
      sourceNodeId: 'source',
      sourceTopicId: 'source-root',
      targetNodeId: 'target',
      target: { kind: 'child', parentId: 'target-root' },
      createTopicId: () => `merged-${++nextId}`,
    });

    expect(result?.nodes.map((node) => node.id)).toEqual(['target']);
    expect(rootOf(result!.nodes[0]).children).toEqual([
      topic('merged-1', 'Source', [topic('merged-2', 'Child')]),
    ]);
    expect(result?.removedNodeId).toBe('source');
  });

  it('detaches a non-root branch into a new mindmap at the drop position', () => {
    const source = mindmap('source', topic('source-root', 'Source', [
      topic('branch', 'Branch', [topic('leaf', 'Leaf')]),
    ]));

    const result = splitMindmapTopic([source], {
      sourceNodeId: 'source',
      sourceTopicId: 'branch',
      x: 640,
      y: 360,
      createNodeId: () => 'new-map',
    });

    expect(result).not.toBeNull();
    expect(rootOf(result!.nodes[0]).children).toEqual([]);
    expect(result!.nodes[1]).toMatchObject({
      id: 'new-map',
      type: 'mindmap',
      title: 'Branch',
      x: 640,
      y: 360,
    });
    expect(rootOf(result!.nodes[1])).toEqual(
      topic('branch', 'Branch', [topic('leaf', 'Leaf')]),
    );
  });

  it('does not split the root away from its existing canvas node', () => {
    const source = mindmap('source', topic('source-root', 'Source'));

    expect(splitMindmapTopic([source], {
      sourceNodeId: 'source',
      sourceTopicId: 'source-root',
      x: 100,
      y: 100,
      createNodeId: () => 'new-map',
    })).toBeNull();
  });

  it('selects the target only when a whole source map is removed', () => {
    const source = mindmap('source', topic('source-root', 'Source', [
      topic('branch', 'Branch'),
    ]));
    const target = mindmap('target', topic('target-root', 'Target'));
    const base = {
      sourceNodeId: 'source',
      targetNodeId: 'target',
      target: { kind: 'child', parentId: 'target-root' } as const,
    };

    expect(getSelectionAfterMindmapMerge([source, target], {
      ...base,
      sourceTopicId: 'source-root',
    })).toEqual(['target']);
    expect(getSelectionAfterMindmapMerge([source, target], {
      ...base,
      sourceTopicId: 'branch',
    })).toBeNull();
  });
});
