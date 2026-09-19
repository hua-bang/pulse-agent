import { BrowserWindow, dialog } from 'electron';
import { promises as fs } from 'node:fs';
import { isAbsolute, relative, sep } from 'node:path';
import { getWorkspaceDir, MANIFEST_ID } from './persistence/paths';
import type { ImportedWorkspace } from './workspace-import';

/** Dialog and archive coordination is loaded only for an explicit import/export action. */
const PORTABLE_WORKSPACE_URL_PREFIX = 'pulsecanvas://workspace/';

const sanitizeFileName = (name: string): string => {
  const safe = name.replace(/[^a-zA-Z0-9_\- .]/g, '').trim();
  return safe || 'workspace';
};

const toPortableRelativePath = (filePath: string, workspaceDir: string): string | null => {
  const rel = relative(workspaceDir, filePath);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) return null;
  return rel.split(sep).join('/');
};

const portableUrlForRelativePath = (relativePath: string): string =>
  `${PORTABLE_WORKSPACE_URL_PREFIX}${encodeURI(relativePath)}`;

export async function exportWorkspaceWithDialog(
  root: string,
  payload: { id: string; name: string },
  readLegacyCanvas: () => Promise<unknown>,
) {
  try {
    if (!payload.id || payload.id === MANIFEST_ID) {
      return { ok: false, error: 'Invalid workspace id.' };
    }

    const [archive, externalFiles, sqliteWorkspace] = await Promise.all([
      import('./workspace-export-archive'),
      import('./workspace-export-external-files'),
      import('./persistence/sqlite-workspace'),
    ]);
    const workspaceDir = getWorkspaceDir(payload.id, root);
    const { canvas, files } = await sqliteWorkspace.readWorkspaceExportSource(
      root, payload.id, readLegacyCanvas,
    );

    const win = BrowserWindow.getFocusedWindow();
    const externalFilePaths = externalFiles.collectExternalFilePaths(
      await sqliteWorkspace.workspaceExportPathContext(canvas, files), workspaceDir,
    );
    let externalFilePathMap = new Map<string, string>();
    let skippedExternalFileCount = 0;
    if (externalFilePaths.length > 0) {
      const mode = await externalFiles.chooseExternalFilesExportMode(externalFilePaths.length, win);
      if (mode === 'cancel') {
        return { ok: false, canceled: true };
      }
      if (mode === 'copy') {
        const externalBundle = await externalFiles.collectExternalWorkspaceFiles(
          externalFilePaths,
          files.map((file) => file.relativePath),
        );
        files.push(...externalBundle.files);
        externalFilePathMap = externalBundle.pathMap;
        skippedExternalFileCount = externalBundle.skipped.length;
        if (skippedExternalFileCount > 0 && !(await externalFiles.confirmSkippedExternalFilesExport(skippedExternalFileCount, win))) {
          return { ok: false, canceled: true };
        }
      }
    }

    const toPortablePath = (filePath: string) => {
      const relativePath = toPortableRelativePath(filePath, workspaceDir) ?? externalFilePathMap.get(filePath);
      return relativePath ? portableUrlForRelativePath(relativePath) : filePath;
    };
    const portableCanvas = sqliteWorkspace.rewriteCanvasFilePaths(canvas, toPortablePath);
    const result = win
      ? await dialog.showSaveDialog(win, {
        title: 'Export Workspace',
        defaultPath: `${sanitizeFileName(payload.name)}.pulsecanvas.zip`,
        filters: [
          { name: 'Pulse Canvas Workspace Archive', extensions: ['pulsecanvas.zip', 'zip'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      })
      : await dialog.showSaveDialog({
        title: 'Export Workspace',
        defaultPath: `${sanitizeFileName(payload.name)}.pulsecanvas.zip`,
        filters: [
          { name: 'Pulse Canvas Workspace Archive', extensions: ['pulsecanvas.zip', 'zip'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true };
    }

    const exportPayload = archive.createWorkspaceExportPayload({
      exportedAt: new Date().toISOString(),
      workspace: { id: payload.id, name: payload.name },
      canvas: portableCanvas,
      files: await sqliteWorkspace.rewriteWorkspaceArchiveFiles(files, toPortablePath),
    });
    await fs.writeFile(result.filePath, archive.createWorkspaceExportArchive(exportPayload));
    return {
      ok: true,
      filePath: result.filePath,
      fileCount: files.length,
      externalFileCount: externalFilePathMap.size,
      skippedExternalFileCount,
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

export async function importWorkspaceWithDialog(
  importWorkspaceFromPath: (path: string) => Promise<ImportedWorkspace>,
) {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const result = win
      ? await dialog.showOpenDialog(win, {
        title: 'Import Workspace',
        filters: [
          { name: 'Pulse Canvas Workspace Archive', extensions: ['pulsecanvas.zip', 'zip'] },
          { name: 'Legacy Pulse Canvas Workspace JSON', extensions: ['pulsecanvas.json', 'json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      })
      : await dialog.showOpenDialog({
        title: 'Import Workspace',
        filters: [
          { name: 'Pulse Canvas Workspace Archive', extensions: ['pulsecanvas.zip', 'zip'] },
          { name: 'Legacy Pulse Canvas Workspace JSON', extensions: ['pulsecanvas.json', 'json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });
    if (result.canceled || result.filePaths.length === 0) {
      return { ok: false, canceled: true };
    }

    const { canvas: _canvas, ...imported } = await importWorkspaceFromPath(result.filePaths[0]);
    return { ok: true, ...imported };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
