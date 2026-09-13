// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../../i18n';
import type { ReferenceEntry } from '../../../../shared/reference/types';
import type { WorkspaceNodeRecord } from '../../../../types';
import { useLibraryDetail } from './useLibraryDetail';
import type { LibraryItem } from './libraryModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const live = () => undefined;
const references: ReferenceEntry[] = [];
const item = (id: string): LibraryItem => ({ id: `ws:${id}`, entry: { kind: 'node', workspaceId: 'ws', nodeId: id }, title: id, summary: '', workspaceId: 'ws', kind: 'note' });
const record = (id: string): WorkspaceNodeRecord => ({ schemaVersion: 1, id, type: 'text', title: id, data: { content: id } });
let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let model: ReturnType<typeof useLibraryDetail>;
let previous: PropertyDescriptor | undefined;
afterEach(() => {
  if (root) act(() => root.unmount()); host?.remove();
  if (previous) Object.defineProperty(window, 'canvasWorkspace', previous);
  else Reflect.deleteProperty(window, 'canvasWorkspace');
});
const mount = (read: (_workspaceId: string, nodeId: string) => Promise<unknown>) => {
  previous = Object.getOwnPropertyDescriptor(window, 'canvasWorkspace');
  Object.defineProperty(window, 'canvasWorkspace', { configurable: true, value: { workspaceNodes: { read, onChange: () => () => undefined } } });
  host = document.createElement('div'); document.body.append(host); root = createRoot(host);
  const Probe = () => { model = useLibraryDetail('ws', undefined, live, references); return null; };
  act(() => root.render(<I18nProvider><Probe /></I18nProvider>));
};
describe('Library lazy detail navigation', () => {
  it('does not read content while browsing and rejects a late response from the previous item', async () => {
    const resolves = new Map<string, (value: { ok: boolean; node: WorkspaceNodeRecord }) => void>();
    const read = vi.fn((_ws: string, id: string) => new Promise(resolve => resolves.set(id, resolve)));
    mount(read); expect(read).not.toHaveBeenCalled();
    act(() => model.open(item('a'), [item('a'), item('b')]));
    act(() => model.open(item('b')));
    await act(async () => { resolves.get('b')!({ ok: true, node: record('b') }); });
    await act(async () => { resolves.get('a')!({ ok: true, node: record('a') }); });
    expect(model.node?.id).toBe('b'); expect(model.activeId).toBe('ws:b');
    expect(model.trail).toHaveLength(2);
    act(() => model.setDetail(false));
    expect(model.visited).toHaveLength(2); expect(model.activeId).toBe('ws:b');
    expect(read).toHaveBeenCalledTimes(2);
  });
  it('allows retry after a read failure without losing the browsing trail', async () => {
    const read = vi.fn().mockRejectedValueOnce(new Error('read failed')).mockResolvedValueOnce({ ok: true, node: record('a') });
    mount(read);
    await act(async () => { model.open(item('a'), [item('a')]); });
    expect(model.error).toContain('read failed');
    await act(async () => { model.retry(); });
    expect(model.node?.id).toBe('a'); expect(model.error).toBeNull(); expect(model.trail).toHaveLength(1);
  });
});
