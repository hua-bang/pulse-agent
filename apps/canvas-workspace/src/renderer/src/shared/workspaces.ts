export interface WorkspaceEntry {
  id: string;
  name: string;
  rootFolder?: string;
  folderId?: string;
}

export interface FolderEntry {
  id: string;
  name: string;
  collapsed?: boolean;
}

export interface WorkspaceDeleteResult {
  ok: boolean;
  error?: string;
  switchedActive?: boolean;
  newActiveId?: string;
  switchedToEmpty?: boolean;
}

export interface WorkspaceImportResult {
  ok: boolean;
  canceled?: boolean;
  workspace?: WorkspaceEntry;
  fileCount?: number;
  error?: string;
}

/**
 * Choose which workspace becomes active after `deletedId` is removed. When the
 * deleted workspace was the active one we move to the entry that now occupies
 * its slot — its next sibling — and fall back to the new last entry when the
 * last workspace was deleted. This mirrors tab-close behaviour instead of
 * always jumping back to the first workspace.
 */
export const selectActiveAfterDeletion = (
  workspaces: WorkspaceEntry[],
  deletedId: string,
  currentActiveId: string,
): { newActiveId: string; switchedActive: boolean } => {
  const remaining = workspaces.filter((w) => w.id !== deletedId);
  if (currentActiveId !== deletedId || remaining.length === 0) {
    return { newActiveId: currentActiveId, switchedActive: false };
  }
  const deletedIndex = workspaces.findIndex((w) => w.id === deletedId);
  const adjacentIndex = Math.min(Math.max(deletedIndex, 0), remaining.length - 1);
  return { newActiveId: remaining[adjacentIndex].id, switchedActive: true };
};
