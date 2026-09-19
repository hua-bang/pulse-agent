import { useCallback, useEffect, useRef, useState } from 'react';
import { selectActiveAfterDeletion } from '../../shared/workspaces';
import type {
  FolderEntry,
  WorkspaceDeleteResult,
  WorkspaceEntry,
  WorkspaceImportResult,
} from '../../shared/workspaces';

interface WorkspaceManifest {
  workspaces: WorkspaceEntry[];
  folders?: FolderEntry[];
}

const MANIFEST_ID = '__workspaces__';
const DEFAULT_WORKSPACE: WorkspaceEntry = { id: 'default', name: 'Workspace' };

export { selectActiveAfterDeletion } from '../../shared/workspaces';

export const useWorkspaces = () => {
  const [workspaces, setWorkspaces] = useState<WorkspaceEntry[]>([DEFAULT_WORKSPACE]);
  const [folders, setFolders] = useState<FolderEntry[]>([]);
  const [activeId, setActiveId] = useState('default');
  // `activeId` starts as a placeholder until the persisted manifest load
  // below settles — consumers that must not act on the placeholder (e.g.
  // draining deep-link URLs into the right workspace) gate on this instead
  // of assuming the mount-time value is final.
  const [activeIdReady, setActiveIdReady] = useState(false);
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const activeIntentRef = useRef(0);
  const workspacesRef = useRef(workspaces);
  workspacesRef.current = workspaces;
  const foldersRef = useRef(folders);
  foldersRef.current = folders;

  useEffect(() => {
    const api = window.canvasWorkspace?.store;
    if (!api) {
      setActiveIdReady(true);
      return;
    }
    let mounted = true;
    let sequence = 0;
    const refresh = async (initial = false) => {
      const request = ++sequence;
      try {
        const result = await api.load(MANIFEST_ID);
        if (!mounted || request !== sequence || !result.ok || !result.data) return;
        const manifest = result.data as unknown as WorkspaceManifest & { activeId?: string };
        if (!Array.isArray(manifest.workspaces)) return;
        const next = manifest.workspaces;
        const preferred = (initial ? manifest.activeId : activeIdRef.current) ?? '';
        const visibleIds = new Set(next.map(workspace => workspace.id));
        const previous = workspacesRef.current.filter(workspace => workspace.id === preferred || visibleIds.has(workspace.id));
        const adjacent = selectActiveAfterDeletion(previous, preferred, preferred).newActiveId;
        const active = visibleIds.has(preferred) ? preferred : visibleIds.has(adjacent) ? adjacent : next[0]?.id ?? '';
        workspacesRef.current = next;
        activeIdRef.current = active;
        setWorkspaces(next);
        setActiveId(active);
        const nextFolders = Array.isArray(manifest.folders) ? manifest.folders : [];
        foldersRef.current = nextFolders;
        setFolders(nextFolders);
      } finally {
        if (mounted && request === sequence) setActiveIdReady(true);
      }
    };
    void refresh(true).catch(() => undefined);
    const unsubscribe = api.onExternalUpdate?.((event) => {
      if (event.source !== 'sqlite') return;
      // Existing canvas events also carry workspace trash/restore. Ordinary
      // document updates must not overwrite local list edits on every save.
      if (event.kind === 'delete' || !workspacesRef.current.some(workspace => workspace.id === event.workspaceId)) {
        void refresh().catch(() => undefined);
      }
    });
    return () => { mounted = false; unsubscribe?.(); };
  }, []);

  const saveManifest = useCallback(
    (ws: WorkspaceEntry[], newActiveId?: string, newFolders?: FolderEntry[]) => {
      const api = window.canvasWorkspace?.store;
      if (!api) return;
      void api.save(MANIFEST_ID, {
        workspaces: ws,
        folders: newFolders ?? foldersRef.current,
        activeId: newActiveId ?? activeIdRef.current,
      });
    },
    []
  );

  const selectWorkspace = useCallback(
    (id: string) => {
      activeIntentRef.current += 1;
      activeIdRef.current = id;
      setActiveId(id);
      setWorkspaces((prev) => {
        saveManifest(prev, id);
        return prev;
      });
    },
    [saveManifest]
  );

  const createWorkspace = useCallback(
    (name: string, folderId?: string) => {
      const id = `ws-${Date.now()}`;
      const entry: WorkspaceEntry = {
        id,
        name: name.trim() || 'Untitled',
        ...(folderId ? { folderId } : {}),
      };
      activeIntentRef.current += 1;
      activeIdRef.current = id;
      setWorkspaces((prev) => {
        const next = [...prev, entry];
        saveManifest(next, id);
        return next;
      });
      setActiveId(id);
      return id;
    },
    [saveManifest]
  );

  const renameWorkspace = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setWorkspaces((prev) => {
        const next = prev.map((w) => (w.id === id ? { ...w, name: trimmed } : w));
        saveManifest(next);
        return next;
      });
    },
    [saveManifest]
  );

  const deleteWorkspace = useCallback(async (id: string): Promise<WorkspaceDeleteResult> => {
    const actions = await import('./workspaceLifecycle');
    return actions.deleteWorkspace(id, { workspacesRef, activeIdRef, activeIntentRef, setWorkspaces, setActiveId, saveManifest });
  }, [saveManifest]);

  const setRootFolder = useCallback(
    (id: string, folderPath: string) => {
      setWorkspaces((prev) => {
        const next = prev.map((w) => (w.id === id ? { ...w, rootFolder: folderPath } : w));
        saveManifest(next);
        return next;
      });
    },
    [saveManifest]
  );

  /* ---- Folder CRUD ---- */

  const createFolder = useCallback(
    (name: string) => {
      const id = `folder-${Date.now()}`;
      const entry: FolderEntry = { id, name: name.trim() || 'Untitled Folder' };
      setFolders((prev) => {
        const next = [...prev, entry];
        saveManifest(workspaces, undefined, next);
        return next;
      });
      return id;
    },
    [saveManifest, workspaces]
  );

  const renameFolder = useCallback(
    (id: string, name: string) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      setFolders((prev) => {
        const next = prev.map((f) => (f.id === id ? { ...f, name: trimmed } : f));
        saveManifest(workspaces, undefined, next);
        return next;
      });
    },
    [saveManifest, workspaces]
  );

  const deleteFolder = useCallback(
    (id: string) => {
      setFolders((prev) => {
        const next = prev.filter((f) => f.id !== id);
        // Un-folder workspaces that were in this folder
        setWorkspaces((wsPrev) => {
          const wsNext = wsPrev.map((w) =>
            w.folderId === id ? { ...w, folderId: undefined } : w
          );
          saveManifest(wsNext, undefined, next);
          return wsNext;
        });
        return next;
      });
    },
    [saveManifest]
  );

  const toggleFolder = useCallback(
    (id: string) => {
      setFolders((prev) => {
        const next = prev.map((f) =>
          f.id === id ? { ...f, collapsed: !f.collapsed } : f
        );
        saveManifest(workspaces, undefined, next);
        return next;
      });
    },
    [saveManifest, workspaces]
  );


  const importWorkspace = useCallback(async (): Promise<WorkspaceImportResult> => {
    const actions = await import('./workspaceLifecycle');
    return actions.importWorkspace({ workspacesRef, activeIdRef, activeIntentRef, setWorkspaces, setActiveId, saveManifest });
  }, [saveManifest]);

  /** Move a workspace into a folder (or to root if folderId is undefined) */
  const moveWorkspace = useCallback(
    (workspaceId: string, folderId: string | undefined) => {
      setWorkspaces((prev) => {
        const next = prev.map((w) =>
          w.id === workspaceId ? { ...w, folderId } : w
        );
        saveManifest(next);
        return next;
      });
    },
    [saveManifest]
  );

  /**
   * Reorder a workspace by moving it before another workspace (or to end of the target container).
   * `folderId` is the target container — `undefined` means root, a string means inside that folder.
   */
  const reorderWorkspace = useCallback(
    (
      workspaceId: string,
      beforeWorkspaceId: string | null,
      folderId: string | undefined,
    ) => {
      setWorkspaces((prev) => {
        const moving = prev.find((w) => w.id === workspaceId);
        if (!moving) return prev;
        const updatedMoving: WorkspaceEntry = { ...moving, folderId };
        const without = prev.filter((w) => w.id !== workspaceId);
        let next: WorkspaceEntry[];
        if (beforeWorkspaceId === null) {
          next = [...without, updatedMoving];
        } else {
          const idx = without.findIndex((w) => w.id === beforeWorkspaceId);
          if (idx === -1) return prev;
          next = [...without.slice(0, idx), updatedMoving, ...without.slice(idx)];
        }
        saveManifest(next);
        return next;
      });
    },
    [saveManifest],
  );

  /** Reorder a folder by moving it before another folder (or to end) */
  const reorderFolder = useCallback(
    (folderId: string, beforeFolderId: string | null) => {
      setFolders((prev) => {
        const moving = prev.find((f) => f.id === folderId);
        if (!moving) return prev;
        const without = prev.filter((f) => f.id !== folderId);
        if (beforeFolderId === null) {
          const next = [...without, moving];
          saveManifest(workspaces, undefined, next);
          return next;
        }
        const idx = without.findIndex((f) => f.id === beforeFolderId);
        if (idx === -1) return prev;
        const next = [...without.slice(0, idx), moving, ...without.slice(idx)];
        saveManifest(workspaces, undefined, next);
        return next;
      });
    },
    [saveManifest, workspaces]
  );

  return {
    workspaces,
    folders,
    activeId,
    activeIdReady,
    selectWorkspace,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setRootFolder,
    importWorkspace,
    createFolder,
    renameFolder,
    deleteFolder,
    toggleFolder,
    moveWorkspace,
    reorderWorkspace,
    reorderFolder,
  };
};
