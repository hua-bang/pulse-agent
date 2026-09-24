import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import type { PulseStorage } from '@pulse-coder/storage';
import { withLegacyCanvasWrite } from '@pulse-coder/storage/local';
import { isSafeNodeId } from '../nodes/store';
import { atomicWriteJson, readJsonWithRecovery } from './atomic-json';
import { resolveStorageNativeBinding } from './backend';
import { IMPORT_JOURNAL } from './sqlite-workspace';

export type ImportRecoveryOutcome =
  /** SQL had the workspace but the manifest did not: the entry was published. */
  | 'published'
  /** Both sides were already complete (or the workspace was later trashed): only the journal remained. */
  | 'cleaned'
  /** SQL never received the import: its files were moved aside, not deleted. */
  | 'set-aside'
  /** The journal could not be trusted; everything was left in place. */
  | 'skipped';

export interface ImportRecoveryResult { workspaceId: string; outcome: ImportRecoveryOutcome; detail?: string }

interface ImportJournal { workspaceId: string; workspaceName: string }

function parseJournal(text: string, directoryName: string): ImportJournal | string {
  let value: unknown;
  try { value = JSON.parse(text); } catch { return 'invalid JSON'; }
  const journal = value as Partial<ImportJournal> & { schemaVersion?: unknown };
  if (!journal || typeof journal !== 'object' || journal.schemaVersion !== 1) return 'unsupported journal';
  if (journal.workspaceId !== directoryName) return 'journal does not match its directory';
  if (typeof journal.workspaceName !== 'string' || !journal.workspaceName.trim()) return 'journal has no workspace name';
  return { workspaceId: journal.workspaceId, workspaceName: journal.workspaceName };
}

async function publishManifestEntry(root: string, journal: ImportJournal): Promise<boolean> {
  const manifestPath = join(root, '__workspaces__.json');
  const read = await readJsonWithRecovery(manifestPath);
  if (read.kind === 'unrecoverable') throw read.err;
  const manifest = read.kind === 'ok' && read.data && typeof read.data === 'object' && !Array.isArray(read.data)
    ? read.data as { workspaces?: Array<{ id: string; name: string }>; folders?: unknown[] }
    : {};
  const workspaces = Array.isArray(manifest.workspaces) ? manifest.workspaces : [];
  if (workspaces.some(entry => entry?.id === journal.workspaceId)) return false;
  // Keep the user's current selection: startup recovery is not a new import action.
  await atomicWriteJson(manifestPath, JSON.stringify({
    ...manifest,
    workspaces: [...workspaces, { id: journal.workspaceId, name: journal.workspaceName }],
    folders: Array.isArray(manifest.folders) ? manifest.folders : [],
  }, null, 2), { rollingBackup: true });
  return true;
}

async function recoverOne(root: string, storage: PulseStorage, workspaceId: string, text: string): Promise<ImportRecoveryResult> {
  const journal = parseJournal(text, workspaceId);
  if (typeof journal === 'string') return { workspaceId, outcome: 'skipped', detail: journal };
  const journalPath = join(root, workspaceId, IMPORT_JOURNAL);
  if (await storage.workspaces.getTrashed(workspaceId)) {
    await fs.unlink(journalPath);
    return { workspaceId, outcome: 'cleaned', detail: 'workspace was deleted after import' };
  }
  if (await storage.canvas.read(workspaceId)) {
    const published = await publishManifestEntry(root, journal);
    await fs.unlink(journalPath);
    return { workspaceId, outcome: published ? 'published' : 'cleaned' };
  }
  const destination = join(root, '__storage-backup__', 'interrupted-imports', `${workspaceId}-${Date.now()}`);
  await fs.mkdir(join(root, '__storage-backup__', 'interrupted-imports'), { recursive: true });
  await fs.rename(join(root, workspaceId), destination);
  return { workspaceId, outcome: 'set-aside', detail: destination };
}

/**
 * Finish workspace imports that a hard interrupt stopped between the database
 * commit and manifest publication. Runs at startup, before IPC can write.
 */
export async function recoverInterruptedWorkspaceImports(root: string, storage: PulseStorage): Promise<ImportRecoveryResult[]> {
  const entries = await fs.readdir(root, { withFileTypes: true }).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  });
  const pending: Array<{ workspaceId: string; text: string }> = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !isSafeNodeId(entry.name)) continue;
    const text = await fs.readFile(join(root, entry.name, IMPORT_JOURNAL), 'utf8').catch(error => {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    });
    if (text !== null) pending.push({ workspaceId: entry.name, text });
  }
  if (!pending.length) return [];
  // The manifest is shared with the CLI; take the same lock as other manifest writers.
  return withLegacyCanvasWrite(root, async () => {
    const results: ImportRecoveryResult[] = [];
    for (const item of pending) results.push(await recoverOne(root, storage, item.workspaceId, item.text));
    return results;
  }, { allowActive: true, resolveNativeBinding: resolveStorageNativeBinding });
}

/** Best effort: an unrecovered import is no worse than before recovery existed. */
export async function recoverImportsAtStartup(
  root: string,
  storage: PulseStorage,
  writeLog: (scope: string, message: string, detail?: string) => unknown,
): Promise<void> {
  try {
    const results = await recoverInterruptedWorkspaceImports(root, storage);
    if (results.length) await writeLog('storage', 'Recovered interrupted workspace imports', JSON.stringify(results));
  } catch (error) {
    await writeLog('storage', 'Interrupted workspace import recovery failed', String(error));
  }
}
