import type { useFileNodeEditorRegistry } from '../../../shared/fileNodeEditorRegistry';
import { clearNoteSearch, noteSearchPluginKey, setNoteSearch } from './noteSearchExtension';

type Registry = NonNullable<ReturnType<typeof useFileNodeEditorRegistry>>;
interface OwnedHighlight {
  view: Parameters<typeof setNoteSearch>[0];
  query: string;
}

/** Search-only coordination stays in the existing lazy editor runtime. */
export function createCanvasSearchHighlights(registry: Registry) {
  const owned = new Map<string, OwnedHighlight>();
  let query = '';
  let ids = new Set<string>();
  let isCurrent = () => true;
  let disposed = false;

  const clear = () => {
    for (const [id, highlight] of owned) {
      const editor = registry.get(id);
      if (!editor || editor.isDestroyed || editor.view !== highlight.view) continue;
      if (noteSearchPluginKey.getState(highlight.view.state)?.query === highlight.query) {
        clearNoteSearch(highlight.view);
      }
    }
    owned.clear();
    query = '';
    ids.clear();
  };

  const refresh = () => {
    if (disposed || !isCurrent()) return;
    for (const id of ids) registry.requestActivation(id);
    for (const [id, highlight] of owned) {
      const editor = registry.get(id);
      const view = editor && !editor.isDestroyed ? editor.view : null;
      if (ids.has(id) && view === highlight.view) continue;
      if (view === highlight.view && noteSearchPluginKey.getState(view.state)?.query === highlight.query) {
        clearNoteSearch(view);
      }
      owned.delete(id);
    }
    for (const id of ids) {
      const editor = registry.get(id);
      if (!editor || editor.isDestroyed || !editor.view) continue;
      const view = editor.view;
      if (noteSearchPluginKey.getState(view.state)?.query === query) continue;
      setNoteSearch(view, query);
      owned.set(id, { view, query });
    }
  };
  const unsubscribe = registry.subscribe(refresh);

  return {
    update(nextQuery: string, nodeIds: Iterable<string>, current: () => boolean) {
      query = nextQuery;
      ids = new Set(nodeIds);
      isCurrent = current;
      refresh();
    },
    clear,
    dispose() {
      clear();
      disposed = true;
      unsubscribe();
    },
  };
}
