import { promises as fs } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import type { PulseStorage } from '@pulse-coder/storage';
import { withLegacyCanvasWrite } from '@pulse-coder/storage/local';
import {
  isSafeRelativePath,
  parseWorkspaceExportFile,
} from './workspace-export-archive';
import { assertSafeNodeId } from '../nodes/store';
import { getLocalCanvasStorage, resolveStorageNativeBinding } from '../persistence/backend';
import {
  commitSqliteWorkspaceImport,
  relativePathFromPortableUrl,
  rewriteCanvasFilePaths,
  rewriteWorkspaceNodeFiles,
  stageSqliteWorkspaceImport,
  validateWorkspaceArchiveSchema,
} from '../persistence/sqlite-workspace';
import { getCanvasSessionArchivePort, isWorkspaceSessionFile } from '../persistence/session-archive-port';
import { updateWorkspaceManifestDocument } from '../persistence/workspace-manifest';

export { relativePathFromPortableUrl, rewriteCanvasFilePaths } from '../persistence/sqlite-workspace';

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

function withImportedEntry(manifest: Record<string, unknown>, result: ImportedWorkspace): Record<string, unknown> {
  return {
    ...manifest,
    workspaces: [
      ...(Array.isArray(manifest.workspaces) ? manifest.workspaces : []),
      { id: result.workspaceId, name: result.workspaceName },
    ],
    folders: Array.isArray(manifest.folders) ? manifest.folders : [],
    activeId: result.workspaceId,
  };
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
        storeDir, prepared, finalDir, manifest => withImportedEntry(manifest, result),
        conversationsActive && sessions ? sessions : undefined,
      );
    } else {
      await updateWorkspaceManifestDocument(storeDir, manifest => withImportedEntry(manifest, result));
    }
    return result;
  } catch (error) {
    await fs.rm(stagingDir, { recursive: true, force: true });
    if (ownsFinalDir) {
      await fs.rm(finalDir, { recursive: true, force: true });
    }
    throw error;
  }
};

export const importWorkspaceArchiveToStore = async (options: WorkspaceImportOptions): Promise<ImportedWorkspace> => {
  assertSafeNodeId(options.workspaceId);
  await (await getCanvasSessionArchivePort()).assertWorkspaceStorage(options.storeDir);
  const storage = await getLocalCanvasStorage(options.storeDir);
  const conversationsActive = (await storage?.localActivation.read())?.some(row => row.domain === 'conversations' && row.state === 'active') === true;
  if (conversationsActive && !storage) throw new Error('Finish Canvas storage migration before importing a workspace with SQL conversations');
  return withLegacyCanvasWrite(options.storeDir, () => importWorkspaceUnlocked(options, storage, conversationsActive), {
    allowActive: storage !== null, resolveNativeBinding: resolveStorageNativeBinding,
  });
};
