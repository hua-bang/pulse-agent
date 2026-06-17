import { BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'fs';
import { basename, isAbsolute, relative } from 'path';
import { isSafeRelativePath, type WorkspaceExportFile } from './workspace-export-archive';

export interface ExternalWorkspaceFileBundle {
  files: WorkspaceExportFile[];
  pathMap: Map<string, string>;
  skipped: string[];
}

const EXTERNAL_FILES_DIR = '__external_files__';

const isOutsideWorkspace = (filePath: string, workspaceDir: string): boolean => {
  if (!isAbsolute(filePath)) return false;
  const rel = relative(workspaceDir, filePath);
  return rel.startsWith('..') || isAbsolute(rel);
};

const collectFilePathValues = (value: unknown, workspaceDir: string, out: Set<string>): void => {
  if (Array.isArray(value)) {
    for (const item of value) collectFilePathValues(item, workspaceDir, out);
    return;
  }
  if (!value || typeof value !== 'object') return;

  for (const [key, item] of Object.entries(value)) {
    if (key === 'filePath' && typeof item === 'string' && isOutsideWorkspace(item, workspaceDir)) {
      out.add(item);
      continue;
    }
    collectFilePathValues(item, workspaceDir, out);
  }
};

export const collectExternalFilePaths = (canvas: unknown, workspaceDir: string): string[] => {
  const paths = new Set<string>();
  collectFilePathValues(canvas, workspaceDir, paths);
  return [...paths].sort((a, b) => a.localeCompare(b));
};

export const chooseExternalFilesExportMode = async (
  count: number,
  win: BrowserWindow | null,
): Promise<'copy' | 'keep' | 'cancel'> => {
  const result = await (win ? dialog.showMessageBox(win, {
    type: 'question',
    buttons: ['Copy files into archive', 'Keep absolute paths', 'Cancel Export'],
    defaultId: 0,
    cancelId: 2,
    title: 'External Files',
    message: `This workspace references ${count} file${count === 1 ? '' : 's'} outside its workspace folder.`,
    detail: 'Copying them into the archive makes the export portable. Keeping absolute paths may break after import on another machine.',
  }) : dialog.showMessageBox({
    type: 'question',
    buttons: ['Copy files into archive', 'Keep absolute paths', 'Cancel Export'],
    defaultId: 0,
    cancelId: 2,
    title: 'External Files',
    message: `This workspace references ${count} file${count === 1 ? '' : 's'} outside its workspace folder.`,
    detail: 'Copying them into the archive makes the export portable. Keeping absolute paths may break after import on another machine.',
  }));
  if (result.response === 0) return 'copy';
  if (result.response === 1) return 'keep';
  return 'cancel';
};

export const confirmSkippedExternalFilesExport = async (
  count: number,
  win: BrowserWindow | null,
): Promise<boolean> => {
  const options = {
    type: 'warning' as const,
    buttons: ['Continue Export', 'Cancel Export'],
    defaultId: 0,
    cancelId: 1,
    title: 'External Files',
    message: `${count} external file${count === 1 ? '' : 's'} could not be copied.`,
    detail: 'Unreadable or missing files will remain as absolute paths in the exported workspace.',
  };
  const result = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  return result.response === 0;
};

const sanitizeArchiveFileName = (filePath: string): string => {
  const safe = basename(filePath)
    .replace(/[<>:"|?*\x00-\x1F]/g, '')
    .trim();
  return safe || 'external-file';
};

const uniqueExternalRelativePath = (
  filePath: string,
  index: number,
  usedRelativePaths: Set<string>,
): string => {
  const fileName = sanitizeArchiveFileName(filePath);
  let relativePath = `${EXTERNAL_FILES_DIR}/${String(index + 1).padStart(3, '0')}-${fileName}`;
  let suffix = 2;
  while (usedRelativePaths.has(relativePath) || !isSafeRelativePath(relativePath)) {
    relativePath = `${EXTERNAL_FILES_DIR}/${String(index + 1).padStart(3, '0')}-${suffix}-${fileName}`;
    suffix += 1;
  }
  usedRelativePaths.add(relativePath);
  return relativePath;
};

export const collectExternalWorkspaceFiles = async (
  filePaths: string[],
  existingRelativePaths: Iterable<string>,
): Promise<ExternalWorkspaceFileBundle> => {
  const usedRelativePaths = new Set(existingRelativePaths);
  const files: WorkspaceExportFile[] = [];
  const pathMap = new Map<string, string>();
  const skipped: string[] = [];

  for (const filePath of filePaths) {
    try {
      const stat = await fs.stat(filePath);
      if (!stat.isFile()) {
        skipped.push(filePath);
        continue;
      }
      const relativePath = uniqueExternalRelativePath(filePath, files.length, usedRelativePaths);
      const content = await fs.readFile(filePath);
      files.push({ relativePath, encoding: 'base64', content: content.toString('base64') });
      pathMap.set(filePath, relativePath);
    } catch {
      skipped.push(filePath);
    }
  }

  return { files, pathMap, skipped };
};
