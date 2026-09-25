// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerWorkspacePersistence } from '../../shared/workspacePersistence';
import type { WorkspaceDeleteResult, WorkspaceEntry } from '../../shared/workspaces';
import { useWorkspaces } from './useWorkspaces';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

interface Manifest {
  workspaces: WorkspaceEntry[];
  folders?: Array<{ id: string; name: string }>;
  activeId: string;
}
interface LoadResult { ok: boolean; data?: unknown; error?: string }
interface ExternalUpdate { workspaceId: string; source: string; kind?: 'create' | 'update' | 'delete'; nodeIds: string[] }
const ws = (id: string): WorkspaceEntry => ({ id, name: id.toUpperCase() });
const gate = <T,>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
};

describe('workspace lifecycle synchronization', () => {
  let host: HTMLDivElement;
  let root: Root;
  let state: ReturnType<typeof useWorkspaces>;
  let manifest: Manifest;
  let onUpdate: (event: ExternalUpdate) => void;
  const disposers: Array<() => void> = [];
  const save = vi.fn(async () => ({ ok: true }));
  const remove = vi.fn(async (_id: string): Promise<{ ok: boolean; error?: string }> => ({ ok: true }));
  const load = vi.fn(async (id: string): Promise<LoadResult> => ({
    ok: true, data: id === '__workspaces__' ? manifest : { nodes: [] },
  }));
  const importWorkspace = vi.fn();
  const unsubscribe = vi.fn();

  const Probe = () => { state = useWorkspaces(); return null; };
  const mount = async () => { await act(async () => root.render(<Probe />)); };
  const emit = async (workspaceId: string, kind: ExternalUpdate['kind'] = 'update', source = 'sqlite') => {
    await act(async () => onUpdate({ workspaceId, kind, source, nodeIds: [] }));
  };

  beforeEach(() => {
    manifest = { workspaces: ['a', 'b', 'c'].map(ws), activeId: 'b' };
    save.mockClear();
    remove.mockReset().mockResolvedValue({ ok: true });
    load.mockReset().mockImplementation(async id => ({ ok: true, data: id === '__workspaces__' ? manifest : { nodes: [] } }));
    importWorkspace.mockReset();
    unsubscribe.mockClear();
    (globalThis as { canvasWorkspace?: unknown }).canvasWorkspace = {
      store: {
        load, save, delete: remove, importWorkspace,
        onExternalUpdate: (listener: typeof onUpdate) => { onUpdate = listener; return unsubscribe; },
      },
    };
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    disposers.splice(0).forEach(dispose => dispose());
    delete (globalThis as { canvasWorkspace?: unknown }).canvasWorkspace;
  });

  it('accepts an authoritative empty manifest without resurrecting the default workspace', async () => {
    manifest = { workspaces: [], activeId: '' };
    await mount();
    expect(state.workspaces).toEqual([]);
    expect(state.activeId).toBe('');
    expect(state.activeIdReady).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });

  it.each([['b', 'c'], ['c', 'b']])('hides externally deleted active %s and selects adjacent %s', async (deleted, adjacent) => {
    manifest.activeId = deleted;
    await mount();
    manifest = { workspaces: manifest.workspaces.filter(workspace => workspace.id !== deleted), activeId: 'a' };
    await emit(deleted, 'delete');
    expect(state.workspaces.map(workspace => workspace.id)).not.toContain(deleted);
    expect(state.activeId).toBe(adjacent);
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps an empty external result empty and clears folders absent from the manifest', async () => {
    manifest.folders = [{ id: 'folder', name: 'Folder' }];
    await mount();
    manifest = { workspaces: [], activeId: '' };
    await emit('b', 'delete');
    expect(state.workspaces).toEqual([]);
    expect(state.folders).toEqual([]);
    expect(state.activeId).toBe('');
  });

  it('adds an explicitly restored unknown id while keeping a valid current selection', async () => {
    await mount();
    manifest = { workspaces: [...manifest.workspaces, ws('restored')], activeId: 'restored' };
    await emit('restored');
    expect(state.workspaces.map(workspace => workspace.id)).toEqual(['a', 'b', 'c', 'restored']);
    expect(state.activeId).toBe('b');
  });

  it('does not reload the manifest for ordinary known-id document saves or non-SQL updates', async () => {
    await mount();
    load.mockClear();
    await emit('b');
    await emit('unknown', 'update', 'file');
    expect(load).not.toHaveBeenCalled();
  });

  it('ignores a late initial response after a newer observer refresh has committed', async () => {
    const initial = gate<LoadResult>();
    load.mockReturnValueOnce(initial.promise);
    await mount();
    expect(state.activeIdReady).toBe(false);
    manifest = { workspaces: [ws('current')], activeId: 'current' };
    await emit('current');
    expect(state.activeId).toBe('current');
    expect(state.activeIdReady).toBe(true);
    await act(async () => initial.resolve({ ok: true, data: { workspaces: [ws('stale')], activeId: 'stale' } }));
    expect(state.workspaces.map(workspace => workspace.id)).toEqual(['current']);
    expect(state.activeId).toBe('current');
  });

  it('flushes the final document draft before calling delete and writing the new list', async () => {
    await mount();
    const draft = gate<void>();
    const events: string[] = [];
    disposers.push(registerWorkspacePersistence('b', async () => {
      events.push('flush started');
      await draft.promise;
      events.push('flush completed');
    }));
    remove.mockImplementationOnce(async () => { events.push('delete'); return { ok: true }; });
    let pending!: Promise<WorkspaceDeleteResult>;
    act(() => { pending = state.deleteWorkspace('b'); });
    expect(remove).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    await act(async () => { draft.resolve(); await pending; });
    expect(events).toEqual(['flush started', 'flush completed', 'delete']);
    expect(state.workspaces.map(workspace => workspace.id)).toEqual(['a', 'c']);
    expect(state.activeId).toBe('c');
    expect(save).toHaveBeenCalledTimes(1);
  });

  it('does not delete or write list state when flushing the final draft fails', async () => {
    await mount();
    disposers.push(registerWorkspacePersistence('b', async () => { throw new Error('draft conflict'); }));
    let result!: WorkspaceDeleteResult;
    await act(async () => { result = await state.deleteWorkspace('b'); });
    expect(result).toEqual({ ok: false, error: 'draft conflict' });
    expect(remove).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
    expect(state.workspaces.map(workspace => workspace.id)).toEqual(['a', 'b', 'c']);
    expect(state.activeId).toBe('b');
  });

  it.each(['result', 'rejection'])('keeps list state untouched on delete %s failure', async failure => {
    await mount();
    if (failure === 'result') remove.mockResolvedValueOnce({ ok: false, error: 'workspace busy' });
    else remove.mockRejectedValueOnce(new Error('workspace busy'));
    let result!: WorkspaceDeleteResult;
    await act(async () => { result = await state.deleteWorkspace('b'); });
    expect(result).toEqual({ ok: false, error: 'workspace busy' });
    expect(save).not.toHaveBeenCalled();
    expect(state.workspaces.map(workspace => workspace.id)).toEqual(['a', 'b', 'c']);
    expect(state.activeId).toBe('b');
  });

  it('preserves the only-workspace guard before flushing or calling delete', async () => {
    manifest = { workspaces: [ws('a')], activeId: 'a' };
    await mount();
    const flush = vi.fn(async () => undefined);
    disposers.push(registerWorkspacePersistence('a', flush));
    const result = await state.deleteWorkspace('a');
    expect(result.ok).toBe(false);
    expect(flush).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('keeps the adjacent selection and concurrent restored entries when observer removal precedes the acknowledgement', async () => {
    await mount();
    const acknowledgement = gate<{ ok: boolean }>();
    remove.mockReturnValueOnce(acknowledgement.promise);
    let pending!: Promise<WorkspaceDeleteResult>;
    await act(async () => { pending = state.deleteWorkspace('b'); });
    manifest = { workspaces: [ws('a'), ws('c')], activeId: 'a' };
    await emit('b', 'delete');
    expect(state.activeId).toBe('c');
    manifest = { workspaces: [ws('a'), ws('c'), ws('restored')], activeId: 'a' };
    await emit('restored');
    let result!: WorkspaceDeleteResult;
    await act(async () => { acknowledgement.resolve({ ok: true }); result = await pending; });
    expect(result).toMatchObject({ ok: true, switchedActive: true, newActiveId: 'c', switchedToEmpty: true });
    expect(state.workspaces.map(workspace => workspace.id)).toEqual(['a', 'c', 'restored']);
    expect(save).toHaveBeenLastCalledWith('__workspaces__', {
      workspaces: [ws('a'), ws('c'), ws('restored')], folders: [], activeId: 'c',
    });
  });

  it('does not attribute a later explicit selection to the pending deletion', async () => {
    await mount();
    const acknowledgement = gate<{ ok: boolean }>();
    remove.mockReturnValueOnce(acknowledgement.promise);
    let pending!: Promise<WorkspaceDeleteResult>;
    await act(async () => { pending = state.deleteWorkspace('b'); });
    manifest = { workspaces: [ws('a'), ws('c')], activeId: 'a' };
    await emit('b', 'delete');
    act(() => state.selectWorkspace('a'));
    let result!: WorkspaceDeleteResult;
    await act(async () => { acknowledgement.resolve({ ok: true }); result = await pending; });
    expect(state.activeId).toBe('a');
    expect(result).toMatchObject({ switchedActive: false, newActiveId: 'a', switchedToEmpty: false });
  });

  it('does not duplicate an import that an observer refresh already loaded from the manifest', async () => {
    await mount();
    const acknowledgement = gate<{ ok: boolean; workspaceId: string; workspaceName: string; fileCount: number }>();
    importWorkspace.mockReturnValueOnce(acknowledgement.promise);
    let pending!: ReturnType<typeof state.importWorkspace>;
    await act(async () => { pending = state.importWorkspace(); });
    manifest = { workspaces: [ws('a'), ws('b'), ws('c'), ws('imported')], activeId: 'b' };
    await emit('imported');
    await act(async () => {
      acknowledgement.resolve({ ok: true, workspaceId: 'imported', workspaceName: 'IMPORTED', fileCount: 0 });
      await pending;
    });
    expect(state.workspaces.map(workspace => workspace.id)).toEqual(['a', 'b', 'c', 'imported']);
    expect(state.activeId).toBe('imported');
    expect(save).toHaveBeenLastCalledWith('__workspaces__', {
      workspaces: [ws('a'), ws('b'), ws('c'), ws('imported')], folders: [], activeId: 'imported',
    });
  });

  it('appends an import whose manifest refresh has not arrived yet', async () => {
    await mount();
    importWorkspace.mockResolvedValueOnce({ ok: true, workspaceId: 'imported', workspaceName: 'IMPORTED', fileCount: 0 });
    await act(async () => { await state.importWorkspace(); });
    expect(state.workspaces.map(workspace => workspace.id)).toEqual(['a', 'b', 'c', 'imported']);
    expect(state.activeId).toBe('imported');
  });
});
