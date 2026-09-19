import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { PulseStorage } from '@pulse-coder/storage';
import { readLocalStorageStatus, withLegacyCanvasWrite } from '@pulse-coder/storage/local';
import {
  isSafeRelativePath,
  parseWorkspaceExportFile,
} from './workspace-export-archive';
import { atomicWriteJson, readJsonWithRecovery } from './storage';
import { assertSafeNodeId } from './nodes/store';
import { getLocalCanvasStorage } from './persistence/backend';
import {
  commitSqliteWorkspaceImport,
  relativePathFromPortableUrl,
  rewriteCanvasFilePaths,
  rewriteWorkspaceNodeFiles,
  stageSqliteWorkspaceImport,
  validateWorkspaceArchiveSchema,
  WorkspaceImportRecoveryError,
} from './persistence/sqlite-workspace';
import { getCanvasSessionArchivePort, isWorkspaceSessionFile } from './persistence/session-archive-port';

export { relativePathFromPortableUrl, rewriteCanvasFilePaths } from './persistence/sqlite-workspace';

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

async function registerWorkspace(storeDir: string, result: ImportedWorkspace): Promise<void> {
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
  workspaces.push({ id: result.workspaceId, name: result.workspaceName });
  await atomicWriteJson(manifestPath, JSON.stringify({
    ...manifest,
    workspaces,
    folders: Array.isArray(manifest.folders) ? manifest.folders : [],
    activeId: result.workspaceId,
  }, null, 2), { rollingBackup: true });
}

const importWorkspaceUnlocked = async ({
  sourcePath,
  storeDir,
  workspaceId,
  agentsTemplate,
}: WorkspaceImportOptions, storage: PulseStorage | null, conversationsActive: boolean): Promise<ImportedWorkspace> => {
  const imported = parseWorkspaceExportFile(await fs.readFile(sourcePath));
  validateWorkspaceArchiveSchema(imported.canvas);
  const finalDir = join(storeDir, workspaceId);
  const existing = await fs.lstat(finalDir).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  });
  if (existing) throw new Error(`Workspace directory already exists: ${finalDir}`);
  const stagingDir = join(
    storeDir,
    `.import-${workspaceId}-${process.pid}-${Math.random().toString(36).slice(2, 8)}`,
  );

  await fs.mkdir(storeDir, { recursive: true });
  await fs.mkdir(stagingDir);
  let ownsFinalDir = false;
  try {
    const restorePath = (filePath: string) => {
      const relativePath = relativePathFromPortableUrl(filePath);
      if (!relativePath || !isSafeRelativePath(relativePath)) return filePath;
      return join(finalDir, ...relativePath.split('/').filter(Boolean));
    };
    let files = rewriteWorkspaceNodeFiles(imported.files, restorePath);
    const sessions = files.some(file => isWorkspaceSessionFile(file.relativePath))
      ? (await getCanvasSessionArchivePort()).prepareImport(workspaceId, files, restorePath) : null;
    if (sessions) files = sessions.files;
    for (const file of files) {
      const targetPath = resolve(stagingDir, file.relativePath.replace(/\\/g, '/'));
      const rel = relative(stagingDir, targetPath);
      if (rel.startsWith('..') || isAbsolute(rel)) {
        throw new Error(`Workspace export contains an unsafe file path: ${file.relativePath}`);
      }
      await fs.mkdir(dirname(targetPath), { recursive: true });
      await fs.writeFile(targetPath, Buffer.from(file.content, 'base64'));
    }

    const rewritten = rewriteCanvasFilePaths(imported.canvas, restorePath);
    const restoredCanvas = rewritten && typeof rewritten === 'object' && !Array.isArray(rewritten)
      ? Object.fromEntries(Object.entries(rewritten).filter(([key]) => !['revision', 'storageGeneration', 'generation'].includes(key)))
      : rewritten;
    await fs.writeFile(join(stagingDir, 'canvas.json'), JSON.stringify(restoredCanvas, null, 2));
    const agentsPath = join(stagingDir, 'AGENTS.md');
    try {
      await fs.access(agentsPath);
    } catch {
      await fs.writeFile(agentsPath, agentsTemplate, 'utf8');
    }
    const result = {
      workspaceId,
      workspaceName: imported.workspace.name.trim() || 'Imported Workspace',
      fileCount: imported.files.length,
      canvas: restoredCanvas,
    };
    const prepared = storage ? await stageSqliteWorkspaceImport({
      workspaceId, workspaceName: result.workspaceName, stagingDir, sourcePath, canvas: restoredCanvas, files,
    }) : null;
    await fs.rename(stagingDir, finalDir);
    ownsFinalDir = true;
    if (storage && prepared) {
      result.canvas = await commitSqliteWorkspaceImport(
        storage, prepared, finalDir, () => registerWorkspace(storeDir, result),
        conversationsActive && sessions ? sessions : undefined,
      );
    } else {
      await registerWorkspace(storeDir, result);
    }
    return result;
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    if (ownsFinalDir && !(error instanceof WorkspaceImportRecoveryError)) {
      await fs.rm(finalDir, { recursive: true, force: true });
    }
    throw error;
  }
};

export const importWorkspaceArchiveToStore = async (options: WorkspaceImportOptions): Promise<ImportedWorkspace> => {
  assertSafeNodeId(options.workspaceId);
  const storage = await getLocalCanvasStorage(options.storeDir);
  const conversationsActive = (await readLocalStorageStatus(options.storeDir))?.domains.includes('conversations') === true;
  if (conversationsActive && !storage) throw new Error('Finish Canvas storage migration before importing a workspace with SQL conversations');
  return withLegacyCanvasWrite(options.storeDir, () => importWorkspaceUnlocked(options, storage, conversationsActive), { allowActive: storage !== null });
};
