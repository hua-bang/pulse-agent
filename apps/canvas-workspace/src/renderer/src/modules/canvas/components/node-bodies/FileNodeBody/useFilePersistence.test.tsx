// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFilePersistence } from './useFilePersistence';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
let state: ReturnType<typeof useFilePersistence>;
let options: Parameters<typeof useFilePersistence>[0];
let read: ReturnType<typeof vi.fn>;
let write: ReturnType<typeof vi.fn>;
let changed: (filePath: string, content: string) => void;
let originalApi: typeof window.canvasWorkspace;

const Probe = () => { state = useFilePersistence(options); return null; };
async function render() { await act(async () => { root.render(<Probe />); }); }

beforeEach(async () => {
  read = vi.fn().mockResolvedValue({ ok: true, content: 'base', version: 'v1' });
  write = vi.fn().mockResolvedValue({ ok: true, version: 'v2' });
  options = {
    nodeId: 'note', data: { filePath: '/tmp/note.md', content: 'base' }, readOnly: false,
    onUpdate: vi.fn(), onReload: vi.fn(), setModified: vi.fn(), onStatus: vi.fn(),
  };
  originalApi = window.canvasWorkspace;
  Object.defineProperty(window, 'canvasWorkspace', {
    configurable: true,
    value: { file: { read, write, onChanged: (callback: typeof changed) => { changed = callback; return vi.fn(); } } },
  });
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  await render();
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Object.defineProperty(window, 'canvasWorkspace', { configurable: true, value: originalApi });
});

describe('file editor byte-version persistence', () => {
  it('carries the acknowledged version through serialized saves without clearing a newer draft', async () => {
    let finish!: (result: { ok: boolean; version: string }) => void;
    write.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }))
      .mockResolvedValueOnce({ ok: true, version: 'v3' });
    let first!: Promise<void>;
    let second!: Promise<void>;
    act(() => {
      first = state.persistToFile('older', '/tmp/note.md');
      state.markDirty();
      second = state.persistToFile('newer', '/tmp/note.md');
    });
    await act(async () => { await Promise.resolve(); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenNthCalledWith(1, '/tmp/note.md', 'older', 'v1');
    await act(async () => { finish({ ok: true, version: 'v2' }); await Promise.all([first, second]); });
    expect(write).toHaveBeenNthCalledWith(2, '/tmp/note.md', 'newer', 'v2');
    expect(options.onUpdate).toHaveBeenCalledTimes(1);
    expect(options.onUpdate).toHaveBeenCalledWith('note', { data: expect.objectContaining({ content: 'newer', modified: false }) });
  });

  it('never takes a fresh version to overwrite a conflicting draft on Retry', async () => {
    write.mockResolvedValueOnce({ ok: false, conflict: true, error: 'external edit' });
    await act(async () => { await state.persistToFile('my draft', '/tmp/note.md'); });
    expect(state.conflicted).toBe(true);
    read.mockResolvedValue({ ok: true, content: 'external body', version: 'external-v2' });
    await act(async () => { await state.persistToFile('my draft', '/tmp/note.md'); });
    expect(write).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledTimes(1);
    expect(options.onReload).not.toHaveBeenCalled();
    await act(async () => { await state.discardAndReload(); });
    expect(options.onReload).toHaveBeenCalledWith('external body');
    expect(state.conflicted).toBe(false);
    await act(async () => { await state.persistToFile('resolved edit', '/tmp/note.md'); });
    expect(write).toHaveBeenLastCalledWith('/tmp/note.md', 'resolved edit', 'external-v2');
  });

  it('keeps a draft if the explicit discard reload cannot read the file', async () => {
    write.mockResolvedValueOnce({ ok: false, conflict: true });
    await act(async () => { await state.persistToFile('my draft', '/tmp/note.md'); });
    read.mockResolvedValueOnce({ ok: false, error: 'temporarily unavailable' });
    await act(async () => { await state.discardAndReload(); });
    expect(state.conflicted).toBe(true);
    expect(options.onUpdate).not.toHaveBeenCalled();
    expect(options.onReload).not.toHaveBeenCalled();
  });

  it('refreshes clean editors on file events and window focus', async () => {
    read.mockResolvedValueOnce({ ok: true, content: 'external', version: 'v2' });
    await act(async () => { changed('/tmp/note.md', 'external'); });
    expect(options.onReload).toHaveBeenCalledWith('external');
    options = { ...options, data: { ...options.data, content: 'external' } };
    await render();
    read.mockResolvedValueOnce({ ok: true, content: 'focused update', version: 'v3' });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(options.onReload).toHaveBeenLastCalledWith('focused update');
  });

  it('protects keystrokes not yet committed to node data when a focus refresh sees external changes', async () => {
    act(() => state.markDirty());
    read.mockResolvedValueOnce({ ok: true, content: 'external', version: 'v2' });
    await act(async () => { window.dispatchEvent(new Event('focus')); });
    expect(state.conflicted).toBe(true);
    expect(options.onReload).not.toHaveBeenCalled();
    expect(options.onUpdate).not.toHaveBeenCalled();
    await act(async () => { await state.persistToFile('uncommitted draft', '/tmp/note.md'); });
    expect(write).not.toHaveBeenCalled();
  });

  it('isolates acknowledgements from a previous file/node lifetime', async () => {
    let finish!: (result: { ok: boolean; version: string }) => void;
    write.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = state.persistToFile('old node edit', '/tmp/note.md'); });
    await act(async () => { await Promise.resolve(); });
    options = { ...options, nodeId: 'next', data: { filePath: '/tmp/next.md', content: 'next' } };
    read.mockResolvedValueOnce({ ok: true, content: 'next', version: 'next-v1' });
    await render();
    await act(async () => { finish({ ok: true, version: 'old-v2' }); await pending; });
    expect(options.onUpdate).not.toHaveBeenCalled();
    await act(async () => { await state.persistToFile('next edit', '/tmp/next.md'); });
    expect(write).toHaveBeenLastCalledWith('/tmp/next.md', 'next edit', 'next-v1');
  });

  it('does not pair a restored unsaved cache body with the current disk version', async () => {
    options = { ...options, nodeId: 'restored', data: { filePath: '/tmp/restored.md', content: 'restored draft', modified: true } };
    read.mockResolvedValueOnce({ ok: true, content: 'external body', version: 'current-version' });
    await render();
    expect(state.conflicted).toBe(true);
    await act(async () => { await state.persistToFile('restored draft', '/tmp/restored.md'); });
    expect(write).not.toHaveBeenCalled();
    expect(options.onReload).not.toHaveBeenCalled();
  });

  it('refreshes the byte baseline when clean node data is updated through SQL reconciliation', async () => {
    options = { ...options, data: { ...options.data, content: 'external body' } };
    read.mockResolvedValueOnce({ ok: true, content: 'external body', version: 'external-v2' });
    await render();
    await act(async () => { await state.persistToFile('edit based on external body', '/tmp/note.md'); });
    expect(write).toHaveBeenLastCalledWith('/tmp/note.md', 'edit based on external body', 'external-v2');
  });

  it('ignores a stale focus read that completes after a successful local write', async () => {
    let finishRead!: (value: { ok: boolean; content: string; version: string }) => void;
    read.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    let pending!: Promise<boolean>;
    act(() => { pending = state.refresh(); });
    await act(async () => { await state.persistToFile('new local body', '/tmp/note.md'); });
    expect(options.onReload).toHaveBeenLastCalledWith('new local body');
    await act(async () => { finishRead({ ok: true, content: 'base', version: 'v1' }); await pending; });
    expect(options.onReload).toHaveBeenCalledTimes(1);
    await act(async () => { await state.persistToFile('another edit', '/tmp/note.md'); });
    expect(write).toHaveBeenLastCalledWith('/tmp/note.md', 'another edit', 'v2');
  });

  it('coalesces manager and filesystem notifications without replaying the same saved content', async () => {
    let finish!: (value: { ok: boolean; version: string }) => void;
    write.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    let pending!: Promise<void>;
    act(() => { pending = state.persistToFile('saved body', '/tmp/note.md'); });
    await act(async () => { await Promise.resolve(); });
    act(() => {
      changed('/tmp/note.md', 'saved body');
      changed('/tmp/note.md', 'saved body');
    });
    expect(read).toHaveBeenCalledTimes(1);
    options = { ...options, data: { ...options.data, content: 'saved body', modified: false } };
    await render();
    read.mockResolvedValue({ ok: true, content: 'saved body', version: 'v2' });
    await act(async () => { finish({ ok: true, version: 'v2' }); await pending; });
    await act(async () => {
      changed('/tmp/note.md', 'saved body');
      changed('/tmp/note.md', 'saved body');
    });
    expect(write).toHaveBeenCalledTimes(1);
    expect(options.onUpdate).toHaveBeenCalledTimes(1);
    expect(options.onReload).toHaveBeenCalledTimes(1);
    expect(state.conflicted).toBe(false);
  });

  it('carries an uncommitted draft across asynchronous creation of its backing file', async () => {
    options = { ...options, nodeId: 'new-note', data: { filePath: '', content: 'base' } };
    await render();
    act(() => state.markDirty());
    read.mockResolvedValueOnce({ ok: true, content: 'changed externally', version: 'external' });
    options = { ...options, data: { filePath: '/tmp/new-note.md', content: 'base' } };
    await render();
    expect(state.conflicted).toBe(true);
    expect(options.onReload).not.toHaveBeenCalled();
    await act(async () => { await state.persistToFile('draft typed while creating', '/tmp/new-note.md'); });
    expect(write).not.toHaveBeenCalled();
  });

  it('protects imported pending-intent content before the SQL index repairs its stale flags', async () => {
    options = {
      ...options, nodeId: 'imported',
      data: {
        filePath: '/tmp/imported.md', content: 'pending draft', modified: false,
        fileWriteIntentId: 'missing-from-import', fileWriteStatus: 'pending',
      },
    };
    read.mockResolvedValueOnce({ ok: true, content: 'disk content', version: 'disk-sha' });
    await render();
    expect(state.conflicted).toBe(true);
    expect(options.onReload).not.toHaveBeenCalled();
    expect(options.onUpdate).not.toHaveBeenCalled();
    await act(async () => { await state.persistToFile('pending draft', '/tmp/imported.md'); });
    expect(write).not.toHaveBeenCalled();
  });
});
