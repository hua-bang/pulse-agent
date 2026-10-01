import { describe, expect, it } from 'vitest';
import type { CanvasNode } from '../../../types';
import { applyLocalPatch, mergeUpdateOperations, toUpdateOperation } from './nodePatch';
import { describeNodeForModel } from './modelContext';

const TEXT_FIELDS = ['content', 'textColor', 'backgroundColor', 'fontSize', 'autoSize'];
const MINDMAP_FIELDS = ['root', 'layout', 'rev'];

const mindmap = {
  id: 'm', type: 'mindmap', title: 'Plan', x: 0, y: 0, width: 400, height: 300, updatedAt: 1,
  data: { root: { id: 'r', text: 'Root', children: [] }, layout: 'right', rev: 1 },
} as unknown as CanvasNode;

const text = {
  id: 't', type: 'text', title: 'Idea', x: 0, y: 0, width: 200, height: 40, updatedAt: 1,
  data: { content: '<p>Hello</p>', textColor: '', backgroundColor: '' },
} as unknown as CanvasNode;

describe('toUpdateOperation', () => {
  it('keeps only changed writable data fields and size', () => {
    const root = { id: 'r', text: 'Root', children: [{ id: 'k', text: 'Kid', children: [] }] };
    expect(toUpdateOperation(mindmap, {
      data: { ...mindmap.data, root, rev: 2 } as CanvasNode['data'],
      width: 420.6,
    }, MINDMAP_FIELDS)).toEqual({ action: 'update', id: 'm', width: 421, data: { root, rev: 2 } });
  });

  it('ignores fields the server does not list as writable and no-op patches', () => {
    expect(toUpdateOperation(text, { data: { ...text.data, sessionId: 'x' } as CanvasNode['data'] }, TEXT_FIELDS)).toBeNull();
    expect(toUpdateOperation(text, { width: 200, height: 40 }, TEXT_FIELDS)).toBeNull();
    expect(toUpdateOperation(text, { data: { content: 'x' } as CanvasNode['data'] }, [])).toBeNull();
  });
});

describe('mergeUpdateOperations', () => {
  it('folds queued updates per node, later fields winning', () => {
    expect(mergeUpdateOperations([
      { action: 'update', id: 't', data: { content: 'a' } },
      { action: 'update', id: 't', width: 300 },
      { action: 'update', id: 't', data: { content: 'b', textColor: '#111' } },
    ])).toEqual([{ action: 'update', id: 't', width: 300, data: { content: 'b', textColor: '#111' } }]);
  });
});

describe('applyLocalPatch', () => {
  it('merges data and size without mutating the original node', () => {
    const next = applyLocalPatch(text, { data: { content: '<p>Bye</p>' } as CanvasNode['data'], height: 60 });
    expect(next).toMatchObject({ height: 60, data: { content: '<p>Bye</p>', textColor: '' } });
    expect((text.data as { content: string }).content).toBe('<p>Hello</p>');
  });
});

describe('describeNodeForModel', () => {
  it('describes a mindmap as an outline with ids', () => {
    const node = applyLocalPatch(mindmap, {
      data: { root: { id: 'r', text: 'Root', children: [{ id: 'k', text: 'Kid', children: [] }] } } as CanvasNode['data'],
    });
    expect(describeNodeForModel(node, { id: 'ws', name: 'Research' })).toBe(
      'The user is viewing the Pulse Canvas mindmap node "Plan" (nodeId: m, workspaceId: ws, workspace "Research").\n' +
      'Current content:\n- Root\n  - Kid',
    );
  });

  it('reduces text HTML to plain text', () => {
    const node = applyLocalPatch(text, { data: { content: '<p>A &amp; B</p><p>C<br>D</p>' } as CanvasNode['data'] });
    expect(describeNodeForModel(node, { id: 'ws' })).toContain('Current content:\nA & B\nC\nD');
  });
});
