import type { DirEntry } from '../../../shared/files';

export type * from '../../../shared/files';

export interface FileApi {
  createNote: (
    workspaceId?: string,
    name?: string,
  ) => Promise<{ ok: boolean; filePath?: string; fileName?: string; error?: string }>;
  read: (
    filePath: string,
  ) => Promise<{ ok: boolean; content?: string; error?: string }>;
  write: (
    filePath: string,
    content: string,
  ) => Promise<{ ok: boolean; error?: string }>;
  listDir: (
    dirPath: string,
    maxDepth?: number,
  ) => Promise<{ ok: boolean; entries?: DirEntry[]; error?: string }>;
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
