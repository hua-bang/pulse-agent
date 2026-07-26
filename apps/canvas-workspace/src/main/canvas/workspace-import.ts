import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import {
  isSafeRelativePath,
  parseWorkspaceExportFile,
} from './workspace-export-archive';
import { atomicWriteJson, readJsonWithRecovery } from './storage';

const PORTABLE_WORKSPACE_URL_PREFIX = 'pulsecanvas://workspace/';

export const relativePathFromPortableUrl = (value: string): string | null => {
  if (!value.startsWith(PORTABLE_WORKSPACE_URL_PREFIX)) return null;
  return decodeURI(value.slice(PORTABLE_WORKSPACE_URL_PREFIX.length));
};

export const rewriteCanvasFilePaths = (
  value: unknown,
  mapper: (filePath: string) => string,
): unknown => {
  if (Array.isArray(value)) return value.map((item) => rewriteCanvasFilePaths(item, mapper));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    key === 'filePath' && typeof item === 'string'
      ? mapper(item)
      : rewriteCanvasFilePaths(item, mapper),
  ]));
};

export interface WorkspaceImportOptions {
  sourcePath: string;
  storeDir: string;
  workspaceId: string;
  agentsTemplate: string;
}

export interface ImportedWorkspace {
  workspaceId: string;
  workspaceName: string;
  fileCount: number;
  canvas: unknown;
}

export const importWorkspaceArchiveToStore = async ({
  sourcePath,
  storeDir,
  workspaceId,
  agentsTemplate,
}: WorkspaceImportOptions): Promise<ImportedWorkspace> => {
  const imported = parseWorkspaceExportFile(await fs.readFile(sourcePath));
  const finalDir = join(storeDir, workspaceId);
  const stagingDir = join(
    storeDir,
    `.import-${workspaceId}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );

  await fs.mkdir(storeDir, { recursive: true });
  await fs.mkdir(stagingDir);
  try {
    for (const file of imported.files) {
      const targetPath = resolve(stagingDir, file.relativePath);
      const rel = relative(stagingDir, targetPath);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`Workspace export contains an unsafe file path: ${file.relativePath}`);
      }
      await fs.mkdir(dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, Buffer.from(file.content, 'base64'));
    }

    const restoredCanvas = rewriteCanvasFilePaths(imported.canvas, (filePath) => {
      const relativePath = relativePathFromPortableUrl(filePath);
      if (!relativePath || !isSafeRelativePath(relativePath)) return filePath;
      return join(finalDir, ...relativePath.split('/').filter(Boolean));
    });
    await fs.writeFile(join(stagingDir, 'canvas.json'), JSON.stringify(restoredCanvas, null, 2));
    const agentsPath = join(stagingDir, 'AGENTS.md');
    try {
      await fs.access(agentsPath);
    } catch {
      await fs.writeFile(agentsPath, agentsTemplate, 'utf8');
    }
    await fs.rename(stagingDir, finalDir);

    const result = {
      workspaceId,
      workspaceName: imported.workspace.name.trim() || 'Imported Workspace',
      fileCount: imported.files.length,
      canvas: restoredCanvas,
    };
    const manifestPath = join(storeDir, '__workspaces__.json');
    const manifestRead = await readJsonWithRecovery(manifestPath);
    if (manifestRead.kind === 'unrecoverable') throw manifestRead.err;
    const manifest = manifestRead.kind === 'ok' && manifestRead.data && typeof manifestRead.data === 'object'
      ? manifestRead.data as {
        workspaces?: Array<{ id: string; name: string }>;
        folders?: unknown[];
        activeId?: string;
      }
      : {};
    const workspaces = Array.isArray(manifest.workspaces) ? manifest.workspaces : [];
    workspaces.push({ id: workspaceId, name: result.workspaceName });
    await atomicWriteJson(manifestPath, JSON.stringify({
      ...manifest,
      workspaces,
      folders: Array.isArray(manifest.folders) ? manifest.folders : [],
      activeId: workspaceId,
    }, null, 2), { rollingBackup: true });
    return result;
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.rm(finalDir, { recursive: true, force: true });
    throw error;
  }
};
