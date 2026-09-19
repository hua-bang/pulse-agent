import { describe, expect, it, vi } from 'vitest';
import type { CanvasSaveData } from '../../../../types';
import { CanvasDocumentPersistence } from '../CanvasDocumentPersistence';

const initial = (): CanvasSaveData => ({
  revision: 5, nodes: [], edges: [], transform: { x: 0, y: 0, scale: 1 }, savedAt: '',
});

describe('workspace save serialization', () => {
  it('serializes different mounted editors for the same workspace', async () => {
    let release!: (value: { ok: boolean; revision: number }) => void;
    const save = vi.fn()
      .mockImplementationOnce(() => new Promise(resolve => { release = resolve; }))
      .mockResolvedValue({ ok: true, revision: 7 });
    const create = () => new CanvasDocumentPersistence({
      workspaceId: 'shared-editor', save, load: vi.fn(), publish: vi.fn(), persisted: vi.fn(), failed: vi.fn(),
    });
    const first = create();
    const second = create();
    first.initialize(initial());
    second.initialize(initial());
    const firstSave = first.requestSave();
    const secondSave = second.requestSave();
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
    expect(save).toHaveBeenCalledTimes(1);
    release({ ok: true, revision: 6 });
    await Promise.all([firstSave, secondSave]);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('limits conflict retries even if another writer keeps advancing the revision', async () => {
    const save = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: 'revision_conflict', data: { ...initial(), revision: 6 } })
      .mockResolvedValueOnce({ ok: false, code: 'revision_conflict', data: { ...initial(), revision: 7 } });
    const failed = vi.fn();
    const persistence = new CanvasDocumentPersistence({
      workspaceId: 'bounded-retry', save, load: vi.fn(), publish: vi.fn(), persisted: vi.fn(), failed,
    });
    persistence.initialize(initial());
    persistence.setDraft({ ...initial(), transform: { x: 1, y: 0, scale: 1 } });
    await persistence.requestSave();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls.map(([payload]) => payload.revision)).toEqual([5, 6]);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(persistence.hasChanges).toBe(true);
  });

  it('confirms a backend switch and rebases even when it reuses the numeric revision', async () => {
    const legacy = { ...initial(), revision: 1 };
    const staleEvent = { ...legacy, storageGeneration: 'sql-generation', transform: { x: 0, y: 10, scale: 1 } };
    const fresh = { ...staleEvent, transform: { x: 0, y: 20, scale: 1 } };
    const save = vi.fn()
      .mockResolvedValueOnce({ ok: false, code: 'revision_conflict', data: staleEvent })
      .mockResolvedValueOnce({ ok: true, revision: 2, storageGeneration: 'sql-generation' });
    const load = vi.fn().mockResolvedValue(fresh);
    const failed = vi.fn();
    const persistence = new CanvasDocumentPersistence({
      workspaceId: 'migrated', save, load, publish: vi.fn(), persisted: vi.fn(), failed,
    });
    persistence.initialize(legacy);
    persistence.setDraft({ ...legacy, transform: { x: 30, y: 0, scale: 1 } });
    await persistence.requestSave();
    expect(load).toHaveBeenCalledTimes(1);
    expect(save.mock.calls[0][0]).toMatchObject({ revision: 1 });
    expect(save.mock.calls[0][0].storageGeneration).toBeUndefined();
    expect(save.mock.calls[1][0]).toMatchObject({
      revision: 1, storageGeneration: 'sql-generation', transform: { x: 30, y: 20, scale: 1 },
    });
    expect(failed).not.toHaveBeenCalled();
  });

  it('stops a backend-switch rebase when the confirmed backend conflicts with the draft', async () => {
    const base = { ...initial(), storageGeneration: 'original-db' };
    const replacement = { ...base, storageGeneration: 'replacement-db', transform: { x: 40, y: 0, scale: 1 } };
    const save = vi.fn().mockResolvedValue({ ok: false, code: 'revision_conflict', data: replacement });
    const load = vi.fn().mockResolvedValue(replacement);
    const failed = vi.fn();
    const publish = vi.fn();
    const persistence = new CanvasDocumentPersistence({
      workspaceId: 'replacement', save, load, publish, persisted: vi.fn(), failed,
    });
    persistence.initialize(base);
    persistence.setDraft({ ...base, transform: { x: 30, y: 0, scale: 1 } });
    await persistence.requestSave();
    expect(save).toHaveBeenCalledTimes(1);
    expect(load).toHaveBeenCalledTimes(1);
    expect(failed).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    expect(persistence.storageGeneration).toBe('original-db');
    expect(persistence.hasChanges).toBe(true);
  });

  it('does not adopt a superseded backend while generation confirmation is in flight', async () => {
    let finish!: (data: CanvasSaveData) => void;
    const load = vi.fn().mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const failed = vi.fn();
    const publish = vi.fn();
    const persistence = new CanvasDocumentPersistence({
      workspaceId: 'multiple-replacements', save: vi.fn(), load, publish, persisted: vi.fn(), failed,
    });
    persistence.initialize({ ...initial(), storageGeneration: 'original' });
    const first = persistence.receiveExternal({ ...initial(), storageGeneration: 'replacement-one' });
    const second = persistence.receiveExternal({ ...initial(), storageGeneration: 'replacement-two' });
    finish({ ...initial(), storageGeneration: 'replacement-one' });
    await Promise.all([first, second]);
    expect(load).toHaveBeenCalledTimes(1);
    expect(publish).not.toHaveBeenCalled();
    expect(failed).toHaveBeenCalledTimes(1);
    expect(persistence.storageGeneration).toBe('original');
  });
});
