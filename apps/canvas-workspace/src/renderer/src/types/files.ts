import type {
  DirEntry,
  FileCreateEntryRequest,
  FileEntryOperationResult,
  FilePreviewResult,
  FileReadResult,
  FileRenameEntryRequest,
  FileSaveRequest,
  FileSaveResult,
  FileTrashEntryRequest,
  FileWriteResult,
} from '../../../shared/files';

export type * from '../../../shared/files';

export interface FileApi {
  savePreview: (request: FileSaveRequest) => Promise<FileSaveResult>;
  preview: (filePath: string) => Promise<FilePreviewResult>;
  createNote: (
    workspaceId?: string,
    name?: string,
  ) => Promise<{ ok: boolean; filePath?: string; fileName?: string; error?: string }>;
  read: (
    filePath: string,
  ) => Promise<FileReadResult>;
  write: (
    filePath: string,
    content: string,
    expectedVersion?: string,
  ) => Promise<FileWriteResult>;
  listDir: (
    dirPath: string,
    maxDepth?: number,
    includeHidden?: boolean,
  ) => Promise<{ ok: boolean; entries?: DirEntry[]; error?: string }>;
  createEntry: (request: FileCreateEntryRequest) => Promise<FileEntryOperationResult>;
  renameEntry: (request: FileRenameEntryRequest) => Promise<FileEntryOperationResult>;
  trashEntry: (request: FileTrashEntryRequest) => Promise<FileEntryOperationResult>;
  openInVSCode: (
    filePath: string,
  ) => Promise<{ ok: boolean; filePath?: string; command?: string; error?: string }>;
  openPath: (
    filePath: string,
  ) => Promise<{ ok: boolean; filePath?: string; error?: string }>;
  openDialog: () => Promise<{
    ok: boolean;
    canceled?: boolean;
    filePath?: string;
    fileName?: string;
    content?: string;
    error?: string;
  }>;
  saveAsDialog: (
    defaultName: string,
    content: string,
  ) => Promise<{
    ok: boolean;
    canceled?: boolean;
    filePath?: string;
    fileName?: string;
    error?: string;
  }>;
  saveImage: (
    workspaceId: string | undefined,
    data: string,
    ext?: string,
  ) => Promise<{ ok: boolean; filePath?: string; fileName?: string; error?: string }>;
  deleteSavedImage: (
    workspaceId: string | undefined,
    filePath: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  getImagePreview: (
    filePath: string,
    maxDimension?: number,
  ) => Promise<{
    ok: boolean;
    preview?: {
      path: string;
      generated: boolean;
      width: number;
      height: number;
      originalWidth: number;
      originalHeight: number;
    };
    error?: string;
  }>;
  exportImage: (
    defaultName: string,
    data: string,
    ext?: string,
  ) => Promise<{ ok: boolean; canceled?: boolean; filePath?: string; fileName?: string; error?: string }>;
  copyImage: (
    filePath: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  onChanged: (callback: (filePath: string, content: string) => void) => () => void;
}

export interface DialogApi {
  openFolder: () => Promise<{ ok: boolean; canceled?: boolean; folderPath?: string; error?: string }>;
}
