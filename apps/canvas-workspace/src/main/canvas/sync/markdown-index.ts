import { realpath } from 'node:fs/promises';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BrowserWindow } from 'electron';
import { isStorageError, sameFileVersion, type EntityRecord, type JsonObject, type PulseStorage } from '@pulse-coder/storage';
import { readTextFile } from '../../files/file-save';
import { workspaceFiles } from '../../files/workspace-files';

interface ObservedFile { filePath: string; content: string; version: string }
interface WorkspaceWatch {
  stopped: boolean;
  store: PulseStorage;
  workspaceId: string;
  /** Directory → stop function of its repository watch. */
  directories: Map<string, () => void>;
  timer?: NodeJS.Timeout;
  pending?: Promise<void>;
}

const workspaces = new Map<string, WorkspaceWatch>();

function fileData(record: EntityRecord): JsonObject | null {
  if (record.type !== 'file' || !record.data || typeof record.data !== 'object' || Array.isArray(record.data)) return null;
  return record.data;
}

function fileSource(record: EntityRecord): JsonObject {
  const source = record.fileSource;
  return source && typeof source === 'object' && !Array.isArray(source) ? source : {};
}

async function reconcileIntent(
  store: PulseStorage,
  workspaceId: string,
  node: EntityRecord,
  data: JsonObject,
  file?: ObservedFile,
): Promise<{ data: JsonObject; protected: boolean; conflict: boolean }> {
  if (data.fileWriteIntentId === undefined && data.fileWriteStatus === undefined) {
    return { data, protected: false, conflict: false };
  }
  const id = data.fileWriteIntentId;
  const validId = typeof id === 'string' && !!id && id.length <= 1024 && !/[\u0000-\u001f]/.test(id);
  const intent = validId ? await store.fileWrites.get(id) : null;
  let ownsNode = !!intent && intent.workspaceId === workspaceId && intent.nodeId === node.id && intent.content === data.content;
  if (ownsNode && file) {
    try { ownsNode = await realpath(file.filePath) === await realpath(fileURLToPath(intent!.uri)); }
    catch { ownsNode = false; }
  }
  if (ownsNode && intent!.status !== 'applied') {
    return {
      data: { ...data, fileWriteStatus: intent!.status, modified: true, saved: false },
      protected: true,
      conflict: intent!.status === 'conflict' || intent!.status === 'error',
    };
  }
  const cleaned = { ...data };
  delete cleaned.fileWriteIntentId;
  delete cleaned.fileWriteStatus;
  // Exported archives may retain intent ids without exporting the outbox. An
  // unresolved target is a draft, not a reason to freeze file refresh forever.
  const orphanedDraft = !ownsNode && data.fileWriteStatus !== 'applied'
    && (!file || data.content !== file.content);
  if (orphanedDraft) {
    cleaned.modified = true;
    cleaned.saved = false;
  }
  return { data: cleaned, protected: false, conflict: orphanedDraft };
}

/** Disk is authoritative for saved notes; an explicitly dirty cached draft is preserved. */
export async function reconcileMarkdownIndex(
  store: PulseStorage,
  workspaceId: string,
): Promise<{ directories: string[]; files: ObservedFile[] }> {
  for (let attempt = 0; ; attempt++) {
    const snapshot = await store.canvas.read(workspaceId);
    if (!snapshot) return { directories: [], files: [] };
    const changed: EntityRecord[] = [];
    const directories = new Set<string>();
    const files = new Map<string, ObservedFile>();
    for (const node of snapshot.nodes) {
      const data = fileData(node);
      if (!data || typeof data.filePath !== 'string' || !isAbsolute(data.filePath)) continue;
      const filePath = resolve(data.filePath);
      directories.add(dirname(filePath));
      const read = await readTextFile(filePath);
      const file = read.ok && read.content !== undefined && read.version
        ? { filePath, content: read.content, version: read.version } : undefined;
      const previousSource = fileSource(node);
      // Versions stored by earlier releases are bare digests of the same bytes.
      const sourceChanged = !!file && !sameFileVersion(previousSource.version as string | undefined, file.version);
      if (file && sourceChanged) files.set(filePath, file);
      const intent = await reconcileIntent(store, workspaceId, node, data, file);
      if (!file) {
        const next = {
          ...node, data: intent.data,
          ...(intent.conflict ? { fileSource: { ...previousSource, conflict: true } } : {}),
        };
        if (JSON.stringify(next) !== JSON.stringify(node)) changed.push(next);
        continue;
      }
      const hasDraft = intent.protected || (intent.data.modified === true && intent.data.content !== file.content);
      const next = {
        ...node,
        fileSource: {
          ...previousSource,
          version: sourceChanged ? file.version : previousSource.version,
          conflict: intent.protected ? intent.conflict : hasDraft,
        },
        data: hasDraft ? intent.data : { ...intent.data, content: file.content, modified: false, saved: true },
        ...(!hasDraft && intent.data.content !== file.content ? { updatedAt: Date.now() } : {}),
      };
      if (JSON.stringify(next) !== JSON.stringify(node)) changed.push(next);
    }
    if (changed.length) {
      try {
        await store.canvas.commit({
          workspaceId,
          expectedRevision: snapshot.revision,
          expectedGeneration: snapshot.generation,
          nodes: { put: changed },
        });
      } catch (error) {
        if (isStorageError(error) && error.code === 'revision_conflict' && attempt < 2) continue;
        throw error;
      }
    }
    return { directories: [...directories], files: [...files.values()] };
  }
}

function broadcastFile(file: ObservedFile): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed()) continue;
    try { window.webContents.send('canvas:file-changed', file); }
    catch (error) { console.warn('[canvas-storage] Could not notify a file editor', error); }
  }
}

async function refresh(state: WorkspaceWatch): Promise<void> {
  if (state.stopped) return;
  if (state.pending) return state.pending;
  const pending = (async () => {
    const result = await reconcileMarkdownIndex(state.store, state.workspaceId);
    if (state.stopped) return;
    for (const file of result.files) broadcastFile(file);
    const retained = new Set(result.directories);
    for (const [directory, stopWatch] of state.directories) {
      if (!retained.has(directory)) {
        stopWatch();
        state.directories.delete(directory);
      }
    }
    for (const directory of retained) {
      if (state.directories.has(directory)) continue;
      try {
        const stopWatch = workspaceFiles.watchDirectory(workspaceFiles.uriForPath(directory), () => {
          if (state.stopped) return;
          if (state.timer) clearTimeout(state.timer);
          state.timer = setTimeout(() => {
            state.timer = undefined;
            void refresh(state).catch(error => console.warn('[canvas-storage] Markdown refresh failed', error));
          }, 150);
        }, () => state.directories.delete(directory));
        state.directories.set(directory, stopWatch);
      } catch {
        // Missing/unavailable backing paths remain visible as cached drafts.
        // A future load/focus refresh can attach the watcher after recovery.
      }
    }
  })();
  state.pending = pending;
  try { await pending; }
  finally { if (state.pending === pending) state.pending = undefined; }
}

export async function watchWorkspaceMarkdown(root: string, store: PulseStorage, workspaceId: string): Promise<void> {
  const key = `${resolve(root)}\0${workspaceId}`;
  let state = workspaces.get(key);
  if (!state) {
    state = { store, workspaceId, directories: new Map(), stopped: false };
    workspaces.set(key, state);
  }
  await refresh(state);
}

function stop(state: WorkspaceWatch): void {
  state.stopped = true;
  if (state.timer) clearTimeout(state.timer);
  state.directories.forEach(stopWatch => stopWatch());
  state.directories.clear();
}

export function stopWorkspaceMarkdown(root: string, workspaceId: string): void {
  const key = `${resolve(root)}\0${workspaceId}`;
  const state = workspaces.get(key);
  if (state) stop(state);
  workspaces.delete(key);
}

export function stopMarkdownIndexWatchers(): void {
  for (const state of workspaces.values()) stop(state);
  workspaces.clear();
}
