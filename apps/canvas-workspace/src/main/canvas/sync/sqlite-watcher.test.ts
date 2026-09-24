import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSqliteStorage } from '@pulse-coder/storage/sqlite';
import { observeSqliteChanges } from './sqlite-watcher';
import type { PulseStorage } from '@pulse-coder/storage';

const stores: PulseStorage[] = [];
const stops: Array<() => void> = [];
afterEach(async () => {
  stops.splice(0).forEach(stop => stop());
  for (const store of stores.splice(0)) await store.close();
});

async function fixture(onChange = vi.fn(), changeRetention?: number) {
  const store = await openSqliteStorage({ path: ':memory:', changeRetention });
  stores.push(store);
  const observer = await observeSqliteChanges(store, onChange, 60000);
  stops.push(() => observer.stop());
  return { store, observer, onChange };
}

describe('SQLite committed-change observer', () => {
  it('forwards renderer and CLI-equivalent commits once to every listening window', async () => {
    const { store, observer, onChange } = await fixture();
    const created = await store.canvas.commit({ workspaceId: 'ws', expectedRevision: null });
    const external = await store.canvas.commit({
      workspaceId: 'ws', expectedRevision: created.revision,
      nodes: { put: [{ id: 'n', data: { content: 'external' } }] },
    });
    await observer.poll();
    await observer.poll();
    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls[1][0]).toMatchObject({ revision: external.revision, changedIds: ['n'] });
  });

  it('retries failed delivery without losing the committed change', async () => {
    const onChange = vi.fn().mockRejectedValueOnce(new Error('renderer unavailable')).mockResolvedValue(undefined);
    const { store, observer } = await fixture(onChange);
    await store.canvas.commit({ workspaceId: 'ws', expectedRevision: null });
    await expect(observer.poll()).rejects.toThrow('renderer unavailable');
    await observer.poll();
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('does not deliver conversation changes as canvas updates', async () => {
    const { store, observer, onChange } = await fixture();
    await store.conversations.commit({ scopeId: 'ws', sessionId: 's', expectedRevision: null });
    await store.canvas.commit({ workspaceId: 'ws', expectedRevision: null });
    await observer.poll();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ domain: 'canvas' });
  });

  it('resumes from the latest change after its cursor falls out of the retained log', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const { store, observer, onChange } = await fixture(vi.fn(), 2);
    let revision: number | null = null;
    for (let index = 0; index < 4; index += 1) {
      revision = (await store.canvas.commit({ workspaceId: 'ws', expectedRevision: revision })).revision;
    }
    await observer.poll();
    expect(onChange).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    const next = await store.canvas.commit({ workspaceId: 'ws', expectedRevision: revision });
    await observer.poll();
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toMatchObject({ revision: next.revision });
    warn.mockRestore();
  });
});
