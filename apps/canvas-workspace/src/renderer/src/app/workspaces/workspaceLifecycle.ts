import type { WorkspaceEntry, WorkspaceDeleteResult, WorkspaceImportResult } from '../../shared/workspaces';
import { selectActiveAfterDeletion } from '../../shared/workspaces';
import { flushWorkspacePersistence } from '../../shared/workspacePersistence';

interface WorkspaceLifecycleState {
  workspacesRef: { current: WorkspaceEntry[] };
  activeIdRef: { current: string };
  activeIntentRef: { current: number };
  setWorkspaces: (value: WorkspaceEntry[] | ((previous: WorkspaceEntry[]) => WorkspaceEntry[])) => void;
  setActiveId: (value: string) => void;
  saveManifest: (workspaces: WorkspaceEntry[], activeId?: string) => void;
}

/** These explicit user actions do not belong in the startup dependency graph. */
export async function deleteWorkspace(id: string, state: WorkspaceLifecycleState): Promise<WorkspaceDeleteResult> {
  const { workspacesRef, activeIdRef, activeIntentRef, setWorkspaces, setActiveId, saveManifest } = state;
  const api = window.canvasWorkspace?.store;
  const current = workspacesRef.current;
  const requestedActiveId = activeIdRef.current;
  const activeIntent = activeIntentRef.current;
  if (current.length <= 1) {
    return { ok: false, error: 'Cannot delete the only workspace.' };
  }

  if (api) {
    try {
      await flushWorkspacePersistence(id);
      const result = await api.delete(id);
      if (!result.ok) return { ok: false, error: result.error };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  const latest = workspacesRef.current;
  const next = latest.filter((w) => w.id !== id);
  const selection = selectActiveAfterDeletion(
    latest,
    id,
    activeIdRef.current,
  );
  const { newActiveId } = selection;
  const switchedActive = selection.switchedActive || (requestedActiveId === id
    && activeIntentRef.current === activeIntent && newActiveId !== id);

  workspacesRef.current = next;
  activeIdRef.current = newActiveId;
  setWorkspaces(next);
  saveManifest(next, newActiveId);
  if (switchedActive) setActiveId(newActiveId);

  // When the workspace we switched to has no saved nodes the canvas would
  // only show the empty welcome hint, so report it back and let the caller
  // route to AI chat instead of stranding the user on a blank canvas.
  let switchedToEmpty = false;
  if (switchedActive && api && newActiveId) {
    try {
      const snapshot = await api.load(newActiveId);
      const nodes = snapshot.ok ? snapshot.data?.nodes : undefined;
      switchedToEmpty = snapshot.ok && !(Array.isArray(nodes) && nodes.length > 0);
    } catch {
      // The workspace was deleted successfully; an optional routing read
      // must not turn that committed deletion into a reported failure.
    }
  }

  return { ok: true, switchedActive, newActiveId, switchedToEmpty };
}

export async function importWorkspace(state: WorkspaceLifecycleState): Promise<WorkspaceImportResult> {
  const { activeIdRef, activeIntentRef, setWorkspaces, setActiveId, saveManifest } = state;
  const api = window.canvasWorkspace?.store;
  if (!api) return { ok: false, error: 'Canvas store API is unavailable.' };

  const result = await api.importWorkspace();
  if (!result.ok) {
    return { ok: false, canceled: result.canceled, error: result.error };
  }
  if (!result.workspaceId || !result.workspaceName) {
    return { ok: false, error: 'Import completed without workspace metadata.' };
  }

  const entry: WorkspaceEntry = {
    id: result.workspaceId,
    name: result.workspaceName,
  };
  activeIntentRef.current += 1;
  activeIdRef.current = entry.id;
  setWorkspaces((prev) => {
    const next = [...prev, entry];
    saveManifest(next, entry.id);
    return next;
  });
  setActiveId(entry.id);
  return { ok: true, workspace: entry, fileCount: result.fileCount };
}
