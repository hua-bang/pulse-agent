import { promises as fs } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { EntityRecord, PulseStorage } from '@pulse-coder/storage';
import { withLegacyCanvasWrite } from '@pulse-coder/storage/local';
import {
  materializeCanvasSnapshot,
  prepareLegacyCanvasImport,
  type LegacyCanvas,
  type PreparedLegacyCanvasImport,
} from '@pulse-coder/storage/canvas';
import { isSafeRelativePath, type WorkspaceExportFile } from '../workspace-export-archive';
import { assertSafeNodeId } from '../nodes/store';
import { atomicWriteJson } from './atomic-json';
import { getLocalCanvasStorage, resolveStorageNativeBinding } from './backend';
import { stripDataFromNode } from './write-v2';
import type { CanvasNode } from './schema';
import {
  getCanvasSessionArchivePort, isLegacyWorkspaceSessionState, isWorkspaceSessionFile,
  type PreparedCanvasSessionImport,
} from './session-archive-port';

const PORTABLE_PREFIX = 'pulsecanvas://workspace/';
const IMPORT_JOURNAL = '.workspace-import.json';
const isNodeFile = (path: string): boolean => /^nodes\/[^/]+\.json$/.test(path.replace(/\\/g, '/'));

export const relativePathFromPortableUrl = (value: string): string | null => (
  value.startsWith(PORTABLE_PREFIX) ? decodeURI(value.slice(PORTABLE_PREFIX.length)) : null
);

export const rewriteCanvasFilePaths = (value: unknown, mapper: (path: string) => string): unknown => {
  if (Array.isArray(value)) return value.map(item => rewriteCanvasFilePaths(item, mapper));
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [
    key,
    key === 'filePath' && typeof item === 'string' ? mapper(item) : rewriteCanvasFilePaths(item, mapper),
  ]));
};

export function validateWorkspaceArchiveSchema(canvas: unknown): void {
  const version = canvas && typeof canvas === 'object' && !Array.isArray(canvas)
    ? (canvas as { schemaVersion?: unknown }).schemaVersion : undefined;
  if (version !== undefined && version !== 1 && version !== 2) {
    throw new Error(`Unsupported workspace canvas schema: ${String(version)}`);
  }
}

function nodeFileValue(file: WorkspaceExportFile): EntityRecord {
  let value: EntityRecord;
  try {
    value = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')) as EntityRecord;
  } catch (cause) {
    throw new Error(`Workspace archive contains invalid node JSON: ${file.relativePath}: ${String(cause)}`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.id !== 'string') {
    throw new Error(`Workspace archive contains an invalid node record: ${file.relativePath}`);
  }
  assertSafeNodeId(value.id);
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) {
    throw new Error(`Unsupported workspace node schema: ${String(value.schemaVersion)}`);
  }
  if (file.relativePath.replace(/\\/g, '/') !== `nodes/${value.id}.json`) {
    throw new Error(`Workspace node id does not match its filename: ${file.relativePath}`);
  }
  return value;
}

export function rewriteWorkspaceNodeFiles(
  files: WorkspaceExportFile[],
  mapper: (path: string) => string,
): WorkspaceExportFile[] {
  return files.map(file => isNodeFile(file.relativePath) ? {
    ...file,
    content: Buffer.from(JSON.stringify(rewriteCanvasFilePaths(nodeFileValue(file), mapper), null, 2)).toString('base64'),
  } : file);
}

/** Include off-canvas atom paths when deciding which external attachments to bundle. */
export async function workspaceExportPathContext(canvas: unknown, files: WorkspaceExportFile[]): Promise<unknown[]> {
  const attachments = files.some(file => isWorkspaceSessionFile(file.relativePath))
    ? (await getCanvasSessionArchivePort()).attachmentPaths(files).map(filePath => ({ filePath })) : [];
  return [canvas, ...files.filter(file => isNodeFile(file.relativePath)).map(nodeFileValue), ...attachments];
}

export async function rewriteWorkspaceArchiveFiles(files: WorkspaceExportFile[], mapper: (path: string) => string): Promise<WorkspaceExportFile[]> {
  const rewritten = rewriteWorkspaceNodeFiles(files, mapper);
  return rewritten.some(file => isWorkspaceSessionFile(file.relativePath))
    ? (await getCanvasSessionArchivePort()).rewriteAttachmentPaths(rewritten, mapper) : rewritten;
}

async function collectWorkspaceFiles(workspaceDir: string, excludeLegacyNodes: boolean): Promise<WorkspaceExportFile[]> {
  const files: WorkspaceExportFile[] = [];
  const walk = async (directory: string): Promise<void> => {
    const entries = await fs.readdir(directory, { withFileTypes: true }).catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    });
    for (const entry of entries) {
      if (entry.name === 'canvas.json' || entry.name === 'canvas.json.bak'
        || entry.name === IMPORT_JOURNAL || entry.name.endsWith('.tmp')) continue;
      const path = join(directory, entry.name);
      const relativePath = relative(workspaceDir, path).split(sep).join('/');
      if (!isSafeRelativePath(relativePath)) continue;
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) {
        if (excludeLegacyNodes && /^nodes\/[^/]+\.json(?:\.bak)?$/.test(relativePath)) continue;
        files.push({ relativePath, encoding: 'base64', content: (await fs.readFile(path)).toString('base64') });
      }
    }
  };
  await walk(workspaceDir);
  return files;
}

export async function readWorkspaceExportSource(
  root: string,
  workspaceId: string,
  readLegacyCanvas: () => Promise<unknown>,
): Promise<{ canvas: unknown; files: WorkspaceExportFile[] }> {
  assertSafeNodeId(workspaceId);
  await (await getCanvasSessionArchivePort()).assertWorkspaceStorage(root);
  const storage = await getLocalCanvasStorage(root);
  const conversationsActive = (await storage?.localActivation.read())?.some(row => row.domain === 'conversations' && row.state === 'active') === true;
  if (!storage) {
    if (conversationsActive) throw new Error('Finish Canvas storage migration before exporting a workspace with SQL conversations');
    return withLegacyCanvasWrite(root, async () => {
      const canvas = await readLegacyCanvas();
      const files = await collectWorkspaceFiles(join(root, workspaceId), false);
      files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
      return { canvas, files };
    }, { resolveNativeBinding: resolveStorageNativeBinding });
  }
  const bundle = await storage.workspaces.readBundle(workspaceId);
  if (!bundle) throw new Error(`Workspace is missing from active SQLite storage: ${workspaceId}`);
  const snapshot = bundle.canvas;
  const { revision: _revision, storageGeneration: _storageGeneration, generation: _generation, nodes, ...metadata } = materializeCanvasSnapshot(snapshot);
  const canvas = {
    ...metadata,
    schemaVersion: 2,
    nodes: (nodes ?? []).map(node => stripDataFromNode(node as CanvasNode)),
  };
  let files = await collectWorkspaceFiles(join(root, workspaceId), true);
  if (conversationsActive) {
    files = files.filter(file => !isLegacyWorkspaceSessionState(file.relativePath));
    files.push(...(await getCanvasSessionArchivePort()).exportFiles(bundle));
  }
  for (const node of snapshot.nodes) {
    assertSafeNodeId(node.id);
    files.push({
      relativePath: `nodes/${node.id}.json`,
      encoding: 'base64',
      content: Buffer.from(JSON.stringify(node, null, 2)).toString('base64'),
    });
  }
  files.sort((left, right) => left.relativePath.localeCompare(right.relativePath));
  return { canvas, files };
}

export async function stageSqliteWorkspaceImport(input: {
  workspaceId: string;
  workspaceName: string;
  stagingDir: string;
  sourcePath: string;
  canvas: unknown;
  files: WorkspaceExportFile[];
}): Promise<PreparedLegacyCanvasImport> {
  validateWorkspaceArchiveSchema(input.canvas);
  const atoms = input.files.filter(file => isNodeFile(file.relativePath)).map(nodeFileValue);
  const canvas = input.canvas as LegacyCanvas;
  if (canvas?.schemaVersion === 2) {
    const atomIds = new Set(atoms.map(atom => atom.id));
    for (const node of canvas.nodes ?? []) {
      if (node.type === 'reference' && node.ref != null) continue;
      if (!atomIds.has(node.id ?? '') && !Object.prototype.hasOwnProperty.call(node, 'data')) {
        throw new Error(`Workspace archive is missing the node body: ${String(node.id)}`);
      }
    }
  }
  const prepared = prepareLegacyCanvasImport(input.workspaceId, canvas, atoms);
  await fs.mkdir(join(input.stagingDir, 'nodes'), { recursive: true });
  for (const node of prepared.nodes) {
    assertSafeNodeId(node.id);
    await fs.writeFile(join(input.stagingDir, 'nodes', `${node.id}.json`), JSON.stringify(node, null, 2));
  }
  await atomicWriteJson(join(input.stagingDir, IMPORT_JOURNAL), JSON.stringify({
    schemaVersion: 1,
    workspaceId: input.workspaceId,
    workspaceName: input.workspaceName,
    sourcePath: input.sourcePath,
    phase: 'prepared',
  }, null, 2));
  return prepared;
}

export class WorkspaceImportRecoveryError extends Error {
  constructor(readonly recoveryPath: string, readonly failures: unknown[]) {
    super(`Workspace import needs recovery. Imported files and its recovery record were retained at ${recoveryPath}.`);
    this.name = 'WorkspaceImportRecoveryError';
  }
}

/** Compensate a failed manifest publication without deleting any later concurrent edits. */
export async function commitSqliteWorkspaceImport(
  storage: PulseStorage,
  snapshot: PreparedLegacyCanvasImport,
  workspaceDir: string,
  publishManifest: () => Promise<void>,
  sessions?: Pick<PreparedCanvasSessionImport, 'currentSessionId' | 'conversations'>,
): Promise<LegacyCanvas> {
  const journalPath = join(workspaceDir, IMPORT_JOURNAL);
  const journal = JSON.parse(await fs.readFile(journalPath, 'utf8')) as Record<string, unknown>;
  const receipt = await storage.workspaces.importBundle({
    canvas: snapshot,
    expectedGeneration: storage.generation,
    ...(sessions ? { currentSessionId: sessions.currentSessionId, conversations: sessions.conversations } : {}),
  });
  try {
    await atomicWriteJson(journalPath, JSON.stringify({
      ...journal, phase: 'database-committed', revision: receipt.revision,
      generation: receipt.generation, conversationState: receipt.conversationState,
    }, null, 2));
    await publishManifest();
  } catch (error) {
    try {
      await storage.workspaces.removeBundle(snapshot.workspaceId, receipt.revision, receipt.generation, receipt.conversationState);
    } catch (rollbackError) {
      throw new WorkspaceImportRecoveryError(workspaceDir, [error, rollbackError]);
    }
    throw error;
  }
  await fs.unlink(journalPath).catch(error => {
    console.warn(`[workspace-import] Imported workspace is registered; recovery record cleanup failed: ${String(error)}`);
  });
  return materializeCanvasSnapshot({ ...snapshot, revision: receipt.revision, generation: receipt.generation });
}
