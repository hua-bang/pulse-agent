import { describe, expect, it, vi } from 'vitest';
import {
  DOCK_TAB_ARCHIVE_STORAGE_KEY,
  DockTabArchive,
  createDockTabArchivePersistence,
  type DockArchivedTab,
} from '../links/dock-tab-archive';

const entry = (id: string, workspaceId = 'ws1', closedAt = 1): DockArchivedTab => ({
  tab: { id, kind: 'link', title: id, url: `https://${id}.example` },
  index: 0,
  workspaceId,
  closedAt,
  reason: 'manual',
});

const memoryStorage = () => {
  const values = new Map<string, string>();
  return {
    values,
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
};

describe('DockTabArchive', () => {
  it('pops most-recent-first within a workspace', () => {
    const archive = new DockTabArchive();
    archive.push(entry('a'));
    archive.push(entry('b'));

    expect(archive.list('ws1').map((item) => item.tab.id)).toEqual(['b', 'a']);
    expect(archive.pop('ws1')?.tab.id).toBe('b');
    expect(archive.pop('ws1')?.tab.id).toBe('a');
    expect(archive.pop('ws1')).toBeUndefined();
  });

  it('never hands a tab to a different workspace', () => {
    const archive = new DockTabArchive();
    archive.push(entry('a'));

    expect(archive.has('ws2')).toBe(false);
    expect(archive.pop('ws2')).toBeUndefined();
    // ws1's entry is untouched by the miss.
    expect(archive.pop('ws1')?.tab.id).toBe('a');
  });

  it('drops the oldest entry of a workspace past the limit, not other workspaces', () => {
    const archive = new DockTabArchive(undefined, 2);
    archive.push(entry('other', 'ws2'));
    archive.push(entry('a'));
    archive.push(entry('b'));
    archive.push(entry('c'));

    expect(archive.list('ws1').map((item) => item.tab.id)).toEqual(['c', 'b']);
    expect(archive.list('ws2').map((item) => item.tab.id)).toEqual(['other']);
  });

  it('removes one entry by offset and clears one workspace', () => {
    const archive = new DockTabArchive();
    archive.push(entry('a'));
    archive.push(entry('b'));
    archive.push(entry('other', 'ws2'));

    archive.remove('ws1', 1);
    expect(archive.list('ws1').map((item) => item.tab.id)).toEqual(['b']);
    archive.clear('ws1');
    expect(archive.has('ws1')).toBe(false);
    expect(archive.has('ws2')).toBe(true);
  });

  it('reports each change with a new revision', () => {
    const archive = new DockTabArchive();
    const listener = vi.fn();
    archive.subscribe(listener);
    const before = archive.getRevision();

    archive.push(entry('a'));
    archive.clear('ws1');
    archive.clear('ws1');

    expect(listener).toHaveBeenCalledTimes(2);
    expect(archive.getRevision()).toBe(before + 2);
  });

  it('keeps a reveal request until a switcher takes it', () => {
    const archive = new DockTabArchive();
    const listener = vi.fn();
    archive.requestReveal();
    archive.subscribeReveal(listener);

    expect(archive.takeReveal()).toBe(true);
    expect(archive.takeReveal()).toBe(false);
    archive.requestReveal();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('createDockTabArchivePersistence', () => {
  it('restores saved entries across launches', () => {
    const storage = memoryStorage();
    const first = new DockTabArchive(createDockTabArchivePersistence(storage));
    first.push({ ...entry('a', 'ws1', 42), index: 3, reason: 'idle' });

    const restored = new DockTabArchive(createDockTabArchivePersistence(storage));

    expect(restored.list('ws1')).toEqual([{ ...entry('a', 'ws1', 42), index: 3, reason: 'idle' }]);
  });

  it('drops malformed entries and unknown versions', () => {
    const storage = memoryStorage();
    storage.setItem(DOCK_TAB_ARCHIVE_STORAGE_KEY, JSON.stringify({
      version: 1,
      entries: [entry('ok'), { ...entry('bad'), reason: 'other' }, { ...entry('bad'), tab: { kind: 'canvas' } }, null],
    }));
    expect(createDockTabArchivePersistence(storage).load().map((item) => item.tab.id)).toEqual(['ok']);

    storage.setItem(DOCK_TAB_ARCHIVE_STORAGE_KEY, JSON.stringify({ version: 2, entries: [entry('ok')] }));
    expect(createDockTabArchivePersistence(storage).load()).toEqual([]);
    storage.setItem(DOCK_TAB_ARCHIVE_STORAGE_KEY, '{');
    expect(createDockTabArchivePersistence(storage).load()).toEqual([]);
  });
});
