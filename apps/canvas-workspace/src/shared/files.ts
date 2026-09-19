export type FilePreviewResult =
  | { ok: true; kind: 'text'; content: string; version: string }
  | { ok: true; kind: 'unsupported' | 'too-large' }
  | { ok: false; error: string };

export interface DirEntry {
  name: string;
  type: 'file' | 'dir';
  children?: DirEntry[];
}

export interface FileWriteRequest { filePath: string; content: string; expectedVersion?: string }
export interface FileSaveRequest extends FileWriteRequest { expectedVersion: string }
export type FileSaveResult = { ok: true; version: string } | { ok: false; error: string; conflict?: boolean };
export interface FileReadResult { ok: boolean; content?: string; version?: string; error?: string }
export interface FileWriteResult { ok: boolean; version?: string; error?: string; conflict?: boolean }

export interface FileCreateEntryRequest {
  rootPath: string;
  parentPath: string;
  name: string;
  kind: 'file' | 'directory';
}

export interface FileRenameEntryRequest {
  rootPath: string;
  entryPath: string;
  newName: string;
}

export interface FileTrashEntryRequest {
  rootPath: string;
  entryPath: string;
}

export type FileEntryOperationResult =
  | { ok: true; path: string }
  | { ok: false; error: string };
