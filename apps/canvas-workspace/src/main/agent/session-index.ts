import { promises as fs } from 'fs';
import { basename, join, relative, sep } from 'path';
import type { CanvasAgentSession } from './types';
import { sessionPreview } from './session-preview';
import {
  listedSessionMetadata,
  readSessionFileIndex,
  readSessionMetadata,
  replaceSessionFileIndex,
  updateSessionFileIndex,
  type SessionFileIndex,
  type SessionFileIndexEntry,
} from './session-metadata';
import { sessionUpdatedAt, type AgentSessionListEntry } from './session-file-summary';

interface InventoryEntry {
  relativePath: string;
  absolutePath: string;
  mtimeMs: number;
  size: number;
}

async function sessionInventory(sessionsDir: string): Promise<InventoryEntry[]> {
  const entries: InventoryEntry[] = [];
  const currentPath = join(sessionsDir, 'current.json');
  try {
    const stat = await fs.stat(currentPath);
    entries.push({ relativePath: 'current.json', absolutePath: currentPath, mtimeMs: stat.mtimeMs, size: stat.size });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let archives: string[] = [];
  try {
    archives = await fs.readdir(join(sessionsDir, 'archive'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const archived = await Promise.all(archives.filter(file => file.endsWith('.json')).map(async (file) => {
    const relativePath = `archive/${file}`;
    const absolutePath = join(sessionsDir, relativePath);
    try {
      const stat = await fs.stat(absolutePath);
      return { relativePath, absolutePath, mtimeMs: stat.mtimeMs, size: stat.size };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw error;
    }
  }));
  entries.push(...archived.filter((entry): entry is InventoryEntry => entry !== null));
  return entries;
}

function indexMatchesInventory(index: SessionFileIndex, inventory: InventoryEntry[]): boolean {
  const paths = Object.keys(index);
  return paths.length === inventory.length && inventory.every((entry) => {
    const indexed = index[entry.relativePath];
    return indexed?.mtimeMs === entry.mtimeMs && indexed.size === entry.size;
  });
}

function fileIndexEntry(session: CanvasAgentSession, inventory: InventoryEntry): SessionFileIndexEntry {
  const firstUser = session.messages.find(message => message.role === 'user');
  const legacyDate = inventory.relativePath.startsWith('archive/')
    ? basename(inventory.relativePath).slice(0, 10)
    : '';
  return {
    sessionId: session.sessionId,
    date: session.startedAt?.slice(0, 10) || legacyDate,
    updatedAt: sessionUpdatedAt(session, inventory.mtimeMs),
    messageCount: session.messages.length,
    preview: firstUser ? sessionPreview(firstUser.content) : '',
    mtimeMs: inventory.mtimeMs,
    size: inventory.size,
  };
}

function invalidFileIndexEntry(inventory: InventoryEntry): SessionFileIndexEntry {
  return {
    sessionId: '', date: '', updatedAt: 0, messageCount: 0, preview: '',
    mtimeMs: inventory.mtimeMs, size: inventory.size, invalid: true,
  };
}

export async function updateIndexedSessionFile(
  sessionsDir: string,
  metadataPath: string,
  relativePath: string,
  session: CanvasAgentSession,
): Promise<void> {
  const absolutePath = join(sessionsDir, relativePath);
  const stat = await fs.stat(absolutePath);
  const entry = fileIndexEntry(session, {
    relativePath, absolutePath, mtimeMs: stat.mtimeMs, size: stat.size,
  });
  await updateSessionFileIndex(metadataPath, files => { files[relativePath] = entry; });
}

export async function tombstoneIndexedSessionFile(
  sessionsDir: string,
  metadataPath: string,
  relativePath: string,
): Promise<void> {
  const absolutePath = join(sessionsDir, relativePath);
  const stat = await fs.stat(absolutePath);
  const inventory = { relativePath, absolutePath, mtimeMs: stat.mtimeMs, size: stat.size };
  await updateSessionFileIndex(metadataPath, files => {
    files[relativePath] = invalidFileIndexEntry(inventory);
  });
}

export function updateIndexedSessionAbsoluteFile(
  sessionsDir: string,
  metadataPath: string,
  absolutePath: string,
  session: CanvasAgentSession,
): Promise<void> {
  return updateIndexedSessionFile(
    sessionsDir,
    metadataPath,
    relative(sessionsDir, absolutePath).split(sep).join('/'),
    session,
  );
}

export async function removeIndexedSessionFiles(
  sessionsDir: string,
  metadataPath: string,
  absolutePaths: string[],
): Promise<void> {
  await updateSessionFileIndex(metadataPath, files => {
    for (const path of absolutePaths) {
      const indexedPath = relative(sessionsDir, path).split(sep).join('/');
      if (!indexedPath.startsWith('../')) delete files[indexedPath];
    }
  });
}

export async function readOrRebuildSessionFileIndex(
  sessionsDir: string,
  metadataPath: string,
): Promise<SessionFileIndex> {
  const inventory = await sessionInventory(sessionsDir);
  const indexed = await readSessionFileIndex(metadataPath);
  if (indexed && indexMatchesInventory(indexed, inventory)) return indexed;

  const rebuilt: SessionFileIndex = {};
  await Promise.all(inventory.map(async (entry) => {
    try {
      const session = JSON.parse(await fs.readFile(entry.absolutePath, 'utf-8')) as CanvasAgentSession;
      if (session.sessionId && Array.isArray(session.messages)) {
        rebuilt[entry.relativePath] = fileIndexEntry(session, entry);
      } else {
        rebuilt[entry.relativePath] = invalidFileIndexEntry(entry);
      }
    } catch {
      rebuilt[entry.relativePath] = invalidFileIndexEntry(entry);
    }
  }));
  await replaceSessionFileIndex(metadataPath, rebuilt)
    .catch(error => console.warn('[session-index] Could not persist rebuilt index:', error));
  return rebuilt;
}

export async function readValidSessionFileIndex(
  sessionsDir: string,
  metadataPath: string,
): Promise<SessionFileIndex | null> {
  const [inventory, indexed] = await Promise.all([
    sessionInventory(sessionsDir),
    readSessionFileIndex(metadataPath),
  ]);
  return indexed && indexMatchesInventory(indexed, inventory) ? indexed : null;
}

export async function listIndexedSessions(
  sessionsDir: string,
  metadataPath: string,
): Promise<AgentSessionListEntry[]> {
  const [files, metadata] = await Promise.all([
    readOrRebuildSessionFileIndex(sessionsDir, metadataPath),
    readSessionMetadata(metadataPath),
  ]);
  const current = files['current.json'];
  const currentId = current?.messageCount ? current.sessionId : undefined;
  const archived = new Map<string, SessionFileIndexEntry>();
  for (const [relativePath, entry] of Object.entries(files)) {
    if (entry.invalid || !relativePath.startsWith('archive/') || entry.messageCount === 0 || entry.sessionId === currentId) continue;
    const existing = archived.get(entry.sessionId);
    if (!existing || entry.mtimeMs > existing.mtimeMs) archived.set(entry.sessionId, entry);
  }
  const listed: AgentSessionListEntry[] = [];
  if (currentId && current) listed.push(toListEntry(current, metadata, true));
  listed.push(...Array.from(archived.values(), entry => toListEntry(entry, metadata, false)));
  return listed.sort((left, right) => {
    if (left.isCurrent !== right.isCurrent) return left.isCurrent ? -1 : 1;
    return right.updatedAt - left.updatedAt || right.date.localeCompare(left.date);
  });
}

function toListEntry(
  entry: SessionFileIndexEntry,
  metadata: Awaited<ReturnType<typeof readSessionMetadata>>,
  isCurrent: boolean,
): AgentSessionListEntry {
  return {
    sessionId: entry.sessionId,
    date: entry.date,
    updatedAt: entry.updatedAt,
    messageCount: entry.messageCount,
    preview: entry.preview,
    ...listedSessionMetadata(metadata, entry.sessionId),
    isCurrent,
  };
}
