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
  /** Register a passive node's focus-free transition to its real editor. */
  registerActivator: (nodeId: string, activate: () => void) => () => void;
  /** Request that transition once; false means the node is not mounted. */
  requestActivation: (nodeId: string) => boolean;
  /** Editor readiness and passive-node changes; no provider rerender. */
  subscribe: (listener: (nodeId: string) => void) => () => void;
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
  const activatorsRef = useRef(new Map<string, { activate: () => void; requested: boolean }>());
  const listenersRef = useRef(new Set<(nodeId: string) => void>());

  const notify = useCallback((nodeId: string) => {
    for (const listener of listenersRef.current) listener(nodeId);
  }, []);

  const register = useCallback((nodeId: string, editor: Editor) => {
    if (mapRef.current.get(nodeId) === editor) return;
    mapRef.current.set(nodeId, editor);
    notify(nodeId);
  }, [notify]);

  const unregister = useCallback((nodeId: string) => {
    if (mapRef.current.delete(nodeId)) notify(nodeId);
  }, [notify]);

  const get = useCallback((nodeId: string) => {
    return mapRef.current.get(nodeId) ?? null;
  }, []);

  const getAll = useCallback(() => mapRef.current, []);

  const registerActivator = useCallback((nodeId: string, activate: () => void) => {
    const registration = { activate, requested: false };
    activatorsRef.current.set(nodeId, registration);
    notify(nodeId);
    return () => {
      if (activatorsRef.current.get(nodeId) !== registration) return;
      activatorsRef.current.delete(nodeId);
      notify(nodeId);
    };
  }, [notify]);

  const requestActivation = useCallback((nodeId: string) => {
    if (mapRef.current.has(nodeId)) return true;
    const registration = activatorsRef.current.get(nodeId);
    if (!registration) return false;
    if (!registration.requested) {
      registration.requested = true;
      registration.activate();
    }
    return true;
  }, []);

  const subscribe = useCallback((listener: (nodeId: string) => void) => {
    listenersRef.current.add(listener);
    return () => { listenersRef.current.delete(listener); };
  }, []);

  const api = useMemo<EditorRegistryApi>(
    () => ({ register, unregister, get, getAll, registerActivator, requestActivation, subscribe }),
    [register, unregister, get, getAll, registerActivator, requestActivation, subscribe],
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
