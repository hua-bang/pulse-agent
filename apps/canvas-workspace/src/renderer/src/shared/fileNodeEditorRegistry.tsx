import { createContext, useCallback, useContext, useMemo, useRef } from 'react';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Editor = any;

/**
 * Registry that lets the canvas-level Ctrl+F find bar talk to the
 * Tiptap editors living inside individual file nodes.
 *
 * Why a registry instead of prop drilling:
 *  - File nodes mount/unmount with the canvas viewport; they manage
 *    their own Tiptap instance via `useFileNodeEditor`. Lifting that
 *    instance up to the Canvas component would tangle ownership.
 *  - A `Map<nodeId, editor>` is the lightest contract — file nodes
 *    self-register on mount, the find bar pulls the editor when it
 *    wants to highlight a content match inline.
 *
 * The bar uses the existing `NoteSearchExtension` decoration plugin
 * (already shipped for per-note Ctrl+F inside the toolbar). Pushing
 * the query into that plugin draws inline `<mark>`-style spans and
 * marks the active hit — no second highlight system needed.
 */
interface EditorRegistryApi {
  register: (nodeId: string, editor: Editor) => void;
  unregister: (nodeId: string) => void;
  get: (nodeId: string) => Editor | null;
  /** Stable snapshot of currently-registered ids. Mostly useful for
   *  the find bar to clear stale highlights on close. */
  getAll: () => Map<string, Editor>;
}

const FileNodeEditorRegistryContext = createContext<EditorRegistryApi | null>(null);

/**
 * Mount once at the canvas root. Children can call
 * `useFileNodeEditorRegistry()` to grab the API.
 */
export const FileNodeEditorRegistryProvider = ({ children }: { children: React.ReactNode }) => {
  // We deliberately use a ref-backed map (not state) — registrations
  // happen during render-effect cycles and we don't want them to
  // trigger re-renders. The find bar reads on-demand via `get()`.
  const mapRef = useRef<Map<string, Editor>>(new Map());

  const register = useCallback((nodeId: string, editor: Editor) => {
    mapRef.current.set(nodeId, editor);
  }, []);

  const unregister = useCallback((nodeId: string) => {
    mapRef.current.delete(nodeId);
  }, []);

  const get = useCallback((nodeId: string) => {
    return mapRef.current.get(nodeId) ?? null;
  }, []);

  const getAll = useCallback(() => mapRef.current, []);

  const api = useMemo<EditorRegistryApi>(
    () => ({ register, unregister, get, getAll }),
    [register, unregister, get, getAll],
  );

  return (
    <FileNodeEditorRegistryContext.Provider value={api}>
      {children}
    </FileNodeEditorRegistryContext.Provider>
  );
};

export const useFileNodeEditorRegistry = (): EditorRegistryApi | null => {
  return useContext(FileNodeEditorRegistryContext);
};
