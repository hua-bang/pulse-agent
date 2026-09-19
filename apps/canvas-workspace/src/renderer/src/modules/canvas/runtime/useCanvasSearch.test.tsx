// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../types';
import { FileNodeEditorRegistryProvider, useFileNodeEditorRegistry } from '../../../shared/fileNodeEditorRegistry';

const noteSearch = vi.hoisted(() => {
  let ready!: () => void;
  let started!: () => void;
  return {
    gate: new Promise<void>((resolve) => { ready = resolve; }),
    started: new Promise<void>((resolve) => { started = resolve; }),
    ready: () => ready(),
    signalStarted: () => started(),
    load: vi.fn(),
    set: vi.fn((view: { state: { query: string } }, query: string) => { view.state.query = query; }),
    clear: vi.fn((view: { state: { query: string } }) => { view.state.query = ''; }),
  };
});

vi.mock('../../note-editor/runtime/noteSearchExtension', () => ({
  noteSearchPluginKey: { getState: (state: { query: string }) => state },
  setNoteSearch: noteSearch.set,
  clearNoteSearch: noteSearch.clear,
}));
vi.mock('../../note-editor', async () => {
  noteSearch.load();
  noteSearch.signalStarted();
  await noteSearch.gate;
  return await import('../../note-editor/runtime/canvasSearchHighlights');
});

import { useCanvasSearch } from './useCanvasSearch';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const fileNode = (id: string, content = 'alpha beta'): CanvasNode => ({
  id, type: 'file', title: 'Heading', x: 0, y: 0, width: 200, height: 100,
  data: { content, filePath: `/tmp/${id}.md` },
});
const textNode: CanvasNode = {
  id: 'text', type: 'text', title: 'Text', x: 0, y: 100, width: 200, height: 100,
  data: { content: 'alpha beta', textColor: '', backgroundColor: '' },
};
const makeEditor = () => ({
  isDestroyed: false,
  view: { state: { query: '' }, focus: vi.fn() },
  commands: { focus: vi.fn() },
});

describe('Canvas search with passive file editors', () => {
  let host: HTMLDivElement;
  let root: Root;
  let nodes: CanvasNode[];
  let search: ReturnType<typeof useCanvasSearch>;
  let registry: NonNullable<ReturnType<typeof useFileNodeEditorRegistry>>;

  const Probe = () => {
    registry = useFileNodeEditorRegistry()!;
    search = useCanvasSearch({ nodes });
    return <input aria-label="Canvas search" />;
  };
  const render = () => root.render(<FileNodeEditorRegistryProvider><Probe /></FileNodeEditorRegistryProvider>);
  const find = async (query: string) => {
    await act(async () => {
      search.openBar();
      search.setQuery(query);
    });
  };

  beforeEach(async () => {
    vi.clearAllMocks();
    nodes = [fileNode('note'), textNode];
    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    await act(async () => render());
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('stays idle for title/path matches and cancels a late search-module load on close', async () => {
    const activate = vi.fn();
    const activateText = vi.fn();
    registry.registerActivator('note', activate);
    registry.registerActivator('text', activateText);
    expect(activate).not.toHaveBeenCalled();
    expect(noteSearch.load).not.toHaveBeenCalled();
    await find('Heading');
    await act(async () => search.setQuery('/tmp/note'));
    expect(activate).not.toHaveBeenCalled();
    expect(noteSearch.load).not.toHaveBeenCalled();
    await act(async () => search.setQuery('alpha'));
    expect(activate).toHaveBeenCalledOnce();
    expect(activateText).not.toHaveBeenCalled();
    await noteSearch.started;
    expect(noteSearch.load).toHaveBeenCalledOnce();

    const editor = makeEditor();
    await act(async () => registry.register('note', editor));
    await noteSearch.started;
    await act(async () => {
      search.closeBar();
      noteSearch.ready();
      await vi.dynamicImportSettled();
    });
    expect(noteSearch.set).not.toHaveBeenCalled();
    expect(editor.view.state.query).toBe('');
  });

  it('applies the latest query on actual editor readiness without stealing focus', async () => {
    const activate = vi.fn();
    registry.registerActivator('note', activate);
    await find('alpha');
    const input = host.querySelector('input')!;
    input.focus();
    await act(async () => search.setQuery('beta'));
    const editor = makeEditor();
    await act(async () => registry.register('note', editor));

    expect(activate).toHaveBeenCalledOnce();
    expect(noteSearch.set).toHaveBeenCalledTimes(1);
    expect(noteSearch.set).toHaveBeenLastCalledWith(editor.view, 'beta');
    expect(document.activeElement).toBe(input);
    expect(editor.view.focus).not.toHaveBeenCalled();
    expect(editor.commands.focus).not.toHaveBeenCalled();
  });

  it('activates a matching file that becomes mounted while the search is open', async () => {
    await find('alpha');
    const activate = vi.fn();
    registry.registerActivator('note', activate);
    expect(activate).toHaveBeenCalledOnce();
    const editor = makeEditor();
    registry.register('note', editor);
    expect(editor.view.state.query).toBe('alpha');
  });

  it('does not apply stale highlights after cancellation or an unmatched query', async () => {
    registry.registerActivator('note', vi.fn());
    await find('alpha');
    await act(async () => search.closeBar());
    const lateEditor = makeEditor();
    registry.register('note', lateEditor);
    expect(lateEditor.view.state.query).toBe('');
    await find('alpha');
    expect(lateEditor.view.state.query).toBe('alpha');
    await act(async () => search.setQuery('not found'));
    expect(lateEditor.view.state.query).toBe('');
    const replacement = makeEditor();
    registry.register('note', replacement);
    expect(replacement.view.state.query).toBe('');
  });

  it('clears the previously applied query when its node leaves the result set', async () => {
    const editor = makeEditor();
    registry.register('note', editor);
    await find('alpha');
    expect(editor.view.state.query).toBe('alpha');
    nodes = [fileNode('note', 'other text'), textNode];
    await act(async () => render());
    expect(editor.view.state.query).toBe('');
  });

  it('preserves a newer per-note search when canvas search closes', async () => {
    const editor = makeEditor();
    registry.register('note', editor);
    await find('alpha');
    editor.view.state.query = 'local note search';
    await act(async () => search.closeBar());
    expect(editor.view.state.query).toBe('local note search');
    expect(noteSearch.clear).not.toHaveBeenCalled();
  });

  it('highlights a replacement editor and clears only owned highlights on unmount', async () => {
    const first = makeEditor();
    registry.register('note', first);
    await find('alpha');
    const replacement = makeEditor();
    registry.register('note', replacement);
    expect(replacement.view.state.query).toBe('alpha');
    await act(async () => root.render(<FileNodeEditorRegistryProvider>{null}</FileNodeEditorRegistryProvider>));
    expect(replacement.view.state.query).toBe('');
  });
});
