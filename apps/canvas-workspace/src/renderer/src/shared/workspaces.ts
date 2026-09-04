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
