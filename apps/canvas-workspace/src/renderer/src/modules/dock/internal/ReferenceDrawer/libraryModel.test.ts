import { describe, expect, it } from 'vitest';
import type { CanvasNode, WorkspaceNodeListItem } from '../../../../types';
import { buildLibraryItems, filterLibraryItems, libraryWindow } from './libraryModel';

const metadata = (id: string, workspaceId: string): WorkspaceNodeListItem => ({
  id, workspaceId, type: 'file', title: id, summary: 'Readable summary', tags: [], hasData: true, linkCount: 0,
});
describe('Library catalog', () => {
  it('browses unpinned sources and deduplicates saved references against live nodes', () => {
    const node: CanvasNode = { id: 'note', type: 'file', title: 'Updated title', x: 0, y: 0, width: 100, height: 100,
      data: { filePath: '', content: '# Actual content', saved: true, modified: false } };
    const items = buildLibraryItems([metadata('note', 'current'), metadata('external', 'other')], [node],
      [{ kind: 'node', workspaceId: 'current', nodeId: 'note', titleSnapshot: 'Old title' }], [], 'current');
    expect(items).toHaveLength(2);
    expect(items.find(item => item.id === 'current:note')).toMatchObject({ title: 'Updated title', summary: 'Actual content' });
    expect(items.find(item => item.id === 'other:external')).toBeDefined();
  });
  it('filters source independently of type, including global artifacts and current URL entries', () => {
    const items = buildLibraryItems([metadata('one', 'current'), metadata('two', 'other')], [],
      [{ kind: 'url', id: 'url:link', title: 'Web reference', url: 'https://example.com' },
        { kind: 'artifact', workspaceId: '__global_chat__', artifactId: 'a', titleSnapshot: 'Report' }], [], 'current');
    expect(filterLibraryItems(items, 'current', 'link', 'web').map(i => i.id)).toEqual(['url:link']);
    expect(filterLibraryItems(items, 'other', 'note', '').map(i => i.id)).toEqual(['other:two']);
    expect(filterLibraryItems(items, null, 'artifact', '').map(i => i.id)).toEqual(['artifact:__global_chat__:a']);
  });
  it('bounds mounted cards independently of catalog size, including near the end', () => {
    for (const top of [0, 6000, 2000000]) {
      const range = libraryWindow(10000, top, 650);
      expect(range.end - range.start).toBeLessThanOrEqual(10);
      expect(range.before + range.after + (range.end - range.start) * 232).toBe(10000 * 232);
    }
    expect(libraryWindow(0, 0, 650)).toEqual({ start: 0, end: 0, before: 0, after: 0 });
  });
});
