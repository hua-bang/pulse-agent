// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode, CanvasSaveData } from '../../../../types';
import { useCanvasDocument } from '../..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useCanvasDocument text resize commit', () => {
  let root: Root;
  let host: HTMLElement;
  let hook: ReturnType<typeof useCanvasDocument>;
  let save: ReturnType<typeof vi.fn>;
  let load: ReturnType<typeof vi.fn>;
  let saveError: ReturnType<typeof vi.fn>;
  let externalUpdate: (event: { workspaceId: string; nodeIds: string[]; source: string; revision?: number }) => Promise<void>;
  let selectedCanvas: string;
  let originalCanvasWorkspace: typeof window.canvasWorkspace;

  const node = {
    id: 'text-1',
    type: 'text',
    title: 'Text',
    x: 10,
    y: 20,
    width: 240,
    height: 100,
    data: { content: 'hello', autoSize: true },
    updatedAt: 1,
  } as CanvasNode;

  const Probe = () => {
    hook = useCanvasDocument(selectedCanvas, undefined, undefined, saveError);
    return null;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    save = vi.fn().mockResolvedValue({ ok: true });
    saveError = vi.fn();
    selectedCanvas = 'canvas-1';
    load = vi.fn().mockResolvedValue({
      ok: true,
      data: {
        revision: 5,
        nodes: [node],
        edges: [],
        transform: { x: 91, y: -37, scale: 0.75 },
      },
    });
    originalCanvasWorkspace = window.canvasWorkspace;
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        store: {
          load,
          save,
          onExternalUpdate: vi.fn((callback: typeof externalUpdate) => {
            externalUpdate = callback;
            return vi.fn();
          }),
        },
      },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.loaded).toBe(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: originalCanvasWorkspace,
    });
  });

  it('commits text geometry and auto-size mode in the same undo step', () => {
    act(() => {
      hook.resizeNode('text-1', 320, 140, 10, 20, { disableTextAutoSize: true });
      hook.commitHistory();
    });

    expect(hook.nodes[0]).toMatchObject({
      width: 320,
      height: 140,
      data: { content: 'hello', autoSize: false },
    });

    act(() => {
      expect(hook.undo()).toBe(true);
    });
    expect(hook.nodes[0]).toMatchObject({
      width: 240,
      height: 100,
      data: { content: 'hello', autoSize: true },
    });
  });

  // Terminal/agent scrollback+cwd autosave fires every 2s per live terminal
  // (perf findings B1/A5): routed through the default updateNode path it
  // filled the undo stack with background saves, so Ctrl+Z reverted a
  // scrollback snapshot instead of the user's last action. history:false
  // must keep the data change while leaving the undo stack untouched.
  it('updateNode with history:false applies the patch without occupying an undo slot', () => {
    act(() => {
      hook.updateNode('text-1', {
        data: { content: 'user edit', autoSize: true } as CanvasNode['data'],
      });
    });

    act(() => {
      hook.updateNode(
        'text-1',
        { data: { content: 'user edit', autoSize: true, scrollback: 'tick' } as CanvasNode['data'] },
        { history: false },
      );
    });
    expect(
      (hook.nodes[0].data as { scrollback?: string }).scrollback,
    ).toBe('tick');

    // One undo reverts the USER edit (not the silent autosave tick).
    act(() => {
      expect(hook.undo()).toBe(true);
    });
    expect((hook.nodes[0].data as { content?: string }).content).toBe('hello');
  });

  it('preserves the loaded viewport when an embedded editor saves only node changes', async () => {
    act(() => {
      hook.updateNode('text-1', { title: 'Edited in AI Chat' });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(save).toHaveBeenCalled();
    expect(save.mock.calls.at(-1)?.[1]).toMatchObject({
      transform: { x: 91, y: -37, scale: 0.75 },
    });
  });

  const remote = (patch: Partial<CanvasNode>, revision = 6): CanvasSaveData => ({
    revision, nodes: [{ ...node, ...patch }], edges: [],
    transform: { x: 91, y: -37, scale: 0.75 }, savedAt: '',
  });

  async function deliverExternal(data: CanvasSaveData) {
    load.mockResolvedValueOnce({ ok: true, data });
    await act(async () => {
      await externalUpdate({ workspaceId: selectedCanvas, nodeIds: ['text-1'], source: 'cli' });
    });
  }

  it('saves against the loaded revision and advances only after acknowledgement', async () => {
    save.mockResolvedValueOnce({ ok: true, revision: 6 }).mockResolvedValueOnce({ ok: true, revision: 7 });
    act(() => hook.updateNode('text-1', { title: 'First' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save.mock.calls[0][1].revision).toBe(5);
    act(() => hook.updateNode('text-1', { title: 'Second' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save.mock.calls[1][1].revision).toBe(6);
  });

  it('serializes saves and retains edits made while the first save is in flight', async () => {
    let finish!: (value: { ok: boolean; revision: number }) => void;
    save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ ok: true, revision: 7 });
    act(() => hook.updateNode('text-1', { title: 'First' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    act(() => {
      hook.updateNode('text-1', { title: 'Second' });
      hook.flushSave();
      hook.flushSave();
    });
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ ok: true, revision: 6 }); });
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1]).toMatchObject({ revision: 6, nodes: [{ title: 'Second' }] });
    expect(hook.nodes[0].title).toBe('Second');
    await act(async () => { await vi.advanceTimersByTimeAsync(1600); });
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('merges unsaved local fields with external edits before adopting their revision', async () => {
    act(() => hook.updateNode('text-1', { title: 'Local' }));
    await deliverExternal(remote({ x: 80, data: { ...node.data, content: 'External' }, updatedAt: Date.now() + 20 }));
    expect(hook.nodes[0]).toMatchObject({ title: 'Local', x: 80, data: { content: 'External' } });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save.mock.calls[0][1]).toMatchObject({ revision: 6, nodes: [{ title: 'Local', x: 80 }] });
    expect(saveError).not.toHaveBeenCalled();
  });

  it('accepts metadata-only SQL reordering while retaining an independent local edit', async () => {
    selectedCanvas = 'ordered';
    const initial = { ...remote({}, 5), nodes: [node, { ...node, id: 'text-2', title: 'Second' }] };
    load.mockResolvedValueOnce({ ok: true, data: initial });
    await act(async () => { root.render(<Probe />); });
    act(() => hook.updateNode('text-1', { title: 'Local title' }));
    load.mockResolvedValueOnce({ ok: true, data: { ...initial, revision: 6, nodes: [...initial.nodes].reverse() } });
    await act(async () => {
      await externalUpdate({ workspaceId: 'ordered', nodeIds: [], source: 'sqlite', revision: 6 });
    });
    expect(hook.nodes.map(item => item.id)).toEqual(['text-2', 'text-1']);
    expect(hook.nodes[1].title).toBe('Local title');
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save.mock.calls.at(-1)?.[1]).toMatchObject({ revision: 6, nodes: [{ id: 'text-2' }, { id: 'text-1', title: 'Local title' }] });
    expect(saveError).not.toHaveBeenCalled();
  });

  it('preserves a conflicting local draft without writing it under the external revision', async () => {
    act(() => hook.updateNode('text-1', { title: 'Local draft' }));
    await deliverExternal(remote({ title: 'Remote title' }));
    expect(hook.nodes[0].title).toBe('Local draft');
    expect(saveError).toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(save).not.toHaveBeenCalled();
    // Explicitly aligning the conflicting field lets the retained merge finish.
    act(() => {
      hook.updateNode('text-1', { title: 'Remote title' });
      hook.flushSave();
    });
    await act(async () => { await Promise.resolve(); });
    expect(save.mock.calls[0][1].revision).toBe(6);
  });

  it('defers external snapshots arriving before an in-flight save acknowledgement', async () => {
    let finish!: (value: { ok: boolean; revision: number }) => void;
    save.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValue({ ok: true, revision: 8 });
    act(() => hook.updateNode('text-1', { title: 'Saved local' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    act(() => hook.updateNode('text-1', { x: 200 }));
    await deliverExternal(remote({ title: 'Saved local', data: { ...node.data, content: 'External after save' } }, 7));
    expect(save).toHaveBeenCalledTimes(1);
    await act(async () => { finish({ ok: true, revision: 6 }); });
    expect(save.mock.calls[1][1]).toMatchObject({
      revision: 7, nodes: [{ title: 'Saved local', x: 200, data: { content: 'External after save' } }],
    });
  });

  it('merges a rejected save with fresh data and retries once with the actual revision', async () => {
    save.mockResolvedValueOnce({ ok: false, code: 'revision_conflict', data: remote({ x: 90 }) })
      .mockResolvedValueOnce({ ok: true, revision: 7 });
    act(() => hook.updateNode('text-1', { title: 'Local' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save.mock.calls.map(([, payload]) => payload.revision)).toEqual([5, 6]);
    expect(hook.nodes[0]).toMatchObject({ title: 'Local', x: 90 });
    expect(saveError).not.toHaveBeenCalled();
  });

  it('keeps the draft when a save rejects a same-field conflict', async () => {
    save.mockResolvedValueOnce({ ok: false, code: 'revision_conflict', data: remote({ title: 'Remote' }) });
    act(() => hook.updateNode('text-1', { title: 'Local' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(5000); });
    expect(save).toHaveBeenCalledTimes(1);
    expect(saveError).toHaveBeenCalledTimes(1);
    expect(hook.nodes[0].title).toBe('Local');
  });

  it('ignores a late external load from the previously selected workspace', async () => {
    let finish!: (value: { ok: boolean; data: CanvasSaveData }) => void;
    load.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = externalUpdate({ workspaceId: 'canvas-1', nodeIds: ['text-1'], source: 'cli' }); });
    selectedCanvas = 'canvas-2';
    load.mockResolvedValueOnce({ ok: true, data: remote({ id: 'workspace-2', title: 'Second workspace' }, 2) });
    await act(async () => { root.render(<Probe />); });
    await act(async () => {
      finish({ ok: true, data: remote({ title: 'Stale workspace' }, 9) });
      await pending;
    });
    expect(hook.nodes[0]).toMatchObject({ id: 'workspace-2', title: 'Second workspace' });
  });

  it('ignores older external snapshots that resolve after a newer snapshot', async () => {
    let finishOld!: (value: { ok: boolean; data: CanvasSaveData }) => void;
    load.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = externalUpdate({ workspaceId: 'canvas-1', nodeIds: ['text-1'], source: 'cli' }); });
    await deliverExternal(remote({ title: 'Newest' }, 7));
    await act(async () => {
      finishOld({ ok: true, data: remote({ title: 'Older' }, 6) });
      await pending;
    });
    expect(hook.nodes[0].title).toBe('Newest');
    act(() => hook.updateNode('text-1', { x: 90 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save.mock.calls[0][1].revision).toBe(7);
  });

  it('does not carry an old workspace save acknowledgement into the new baseline', async () => {
    let finishOld!: (value: { ok: boolean; revision: number }) => void;
    save.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValueOnce({ ok: true, revision: 101 })
      .mockResolvedValueOnce({ ok: true, revision: 102 });
    act(() => hook.updateNode('text-1', { title: 'First workspace edit' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    selectedCanvas = 'canvas-2';
    load.mockResolvedValueOnce({ ok: true, data: remote({ title: 'Second workspace' }, 100) });
    await act(async () => { root.render(<Probe />); });
    act(() => hook.updateNode('text-1', { title: 'Second workspace edit' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    await act(async () => { finishOld({ ok: true, revision: 6 }); });
    act(() => hook.updateNode('text-1', { x: 90 }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save.mock.calls.at(-1)).toMatchObject(['canvas-2', { revision: 101 }]);
    expect(hook.nodes[0].title).toBe('Second workspace edit');
  });

  it('keeps legacy saves working without a revision in load or acknowledgement', async () => {
    selectedCanvas = 'legacy';
    const data = remote({});
    delete data.revision;
    load.mockResolvedValueOnce({ ok: true, data });
    await act(async () => { root.render(<Probe />); });
    act(() => hook.updateNode('text-1', { title: 'Legacy edit' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save.mock.calls[0][1].revision).toBeUndefined();
    expect(saveError).not.toHaveBeenCalled();
  });

  it('preserves unsaved legacy creations while accepting external deletion of persisted nodes', async () => {
    selectedCanvas = 'legacy';
    const data = remote({});
    delete data.revision;
    delete data.edges;
    load.mockResolvedValueOnce({ ok: true, data });
    await act(async () => { root.render(<Probe />); });
    let local!: CanvasNode;
    act(() => { local = hook.addNode('text', 200, 200); });
    load.mockResolvedValueOnce({ ok: true, data: { ...data, nodes: [] } });
    await act(async () => {
      await externalUpdate({ workspaceId: 'legacy', nodeIds: ['text-1', local.id], source: 'cli' });
    });
    expect(hook.nodes.map(item => item.id)).toEqual([local.id]);
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save.mock.calls[0][1]).toMatchObject({ nodes: [{ id: local.id }], transform: data.transform });
    expect(save.mock.calls[0][1].revision).toBeUndefined();
  });

  it('never saves an empty replacement when an existing workspace cannot be loaded', async () => {
    selectedCanvas = 'unreadable';
    load.mockResolvedValueOnce({ ok: false, error: 'Old workspace could not be read' });
    await act(async () => { root.render(<Probe />); });
    expect(hook.loaded).toBe(false);
    act(() => hook.flushSave());
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save).not.toHaveBeenCalled();
    expect(saveError).toHaveBeenCalledTimes(1);
  });

  it('carries the generation from a first-create acknowledgement into subsequent saves', async () => {
    selectedCanvas = 'new-workspace';
    const empty = { ...remote({}), nodes: [], revision: undefined };
    load.mockResolvedValueOnce({ ok: true, data: empty });
    save.mockResolvedValueOnce({ ok: true, revision: 1, storageGeneration: 'created-generation' })
      .mockResolvedValueOnce({ ok: true, revision: 2, storageGeneration: 'created-generation' });
    await act(async () => { root.render(<Probe />); });
    let created!: CanvasNode;
    act(() => { created = hook.addNode('text', 10, 20); });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save.mock.calls[0][1].storageGeneration).toBeUndefined();
    act(() => hook.updateNode(created.id, { title: 'Second save' }));
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save.mock.calls[1][1]).toMatchObject({ revision: 1, storageGeneration: 'created-generation' });
  });

  it('reloads and merges a generation change instead of ignoring an equal legacy revision', async () => {
    selectedCanvas = 'migrating-workspace';
    load.mockResolvedValueOnce({ ok: true, data: remote({}, 1) });
    await act(async () => { root.render(<Probe />); });
    act(() => hook.updateNode('text-1', { title: 'Local upgrade draft' }));
    const migrated = { ...remote({ x: 80 }, 1), storageGeneration: 'migrated-generation' };
    load.mockResolvedValueOnce({ ok: true, data: migrated })
      .mockResolvedValueOnce({ ok: true, data: { ...migrated, nodes: [{ ...migrated.nodes[0], x: 90 }] } });
    await act(async () => {
      await externalUpdate({ workspaceId: selectedCanvas, nodeIds: ['text-1'], source: 'cli' });
    });
    expect(hook.nodes[0]).toMatchObject({ title: 'Local upgrade draft', x: 90 });
    await act(async () => { await vi.advanceTimersByTimeAsync(800); });
    expect(save.mock.calls[0][1]).toMatchObject({
      revision: 1, storageGeneration: 'migrated-generation', nodes: [{ title: 'Local upgrade draft', x: 90 }],
    });
  });
});
