import { promises as fs } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

export interface SessionMetadata {
  title?: string;
  pinned?: boolean;
}

export interface SessionFileIndexEntry {
  sessionId: string;
  date: string;
  updatedAt: number;
  messageCount: number;
  preview: string;
  mtimeMs: number;
  size: number;
  invalid?: boolean;
}

export type SessionMetadataMap = Record<string, SessionMetadata>;
export type SessionFileIndex = Record<string, SessionFileIndexEntry>;

interface SessionMetadataDocument {
  indexed: boolean;
  sessions: SessionMetadataMap;
  files: SessionFileIndex;
}

const writeTails = new Map<string, Promise<void>>();

async function readDocument(path: string): Promise<SessionMetadataDocument> {
  let raw: string;
  try {
    raw = await fs.readFile(path, 'utf-8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { indexed: false, sessions: {}, files: {} };
    }
    throw error;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const sessions = isRecord(parsed.sessions) ? parsed.sessions as SessionMetadataMap : {};
    if (parsed.version === 2) {
      if (isRecord(parsed.files)) {
        const files = parsed.files as SessionFileIndex;
        const valid = Object.values(files).every(isSessionFileIndexEntry);
        return { indexed: valid, sessions, files: valid ? files : {} };
      }
      return { indexed: false, sessions, files: {} };
    }
    return { indexed: false, sessions: parsed as SessionMetadataMap, files: {} };
  } catch {
    return { indexed: false, sessions: {}, files: {} };
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === 'object' && !Array.isArray(value);

function isSessionFileIndexEntry(value: unknown): value is SessionFileIndexEntry {
  if (!isRecord(value)) return false;
  return typeof value.sessionId === 'string'
    && typeof value.date === 'string'
    && typeof value.updatedAt === 'number'
    && typeof value.messageCount === 'number'
    && typeof value.preview === 'string'
    && typeof value.mtimeMs === 'number'
    && typeof value.size === 'number'
    && (value.invalid === undefined || typeof value.invalid === 'boolean');
}

export async function readSessionMetadata(path: string): Promise<SessionMetadataMap> {
  return (await readDocument(path)).sessions;
}

export async function readSessionFileIndex(path: string): Promise<SessionFileIndex | null> {
  const document = await readDocument(path);
  return document.indexed ? document.files : null;
}

export function listedSessionMetadata(
  metadata: SessionMetadataMap,
  sessionId: string,
): { title?: string; pinned: boolean } {
  const entry = metadata[sessionId];
  return {
    ...(entry?.title ? { title: entry.title } : {}),
    pinned: entry?.pinned === true,
  };
}

export async function patchSessionMetadata(
  path: string,
  sessionId: string,
  patch: SessionMetadata,
): Promise<void> {
  await updateDocument(path, (document) => {
    const next = { ...document.sessions[sessionId], ...patch };
    if (next.pinned === false) delete next.pinned;
    if (!next.title && !next.pinned) delete document.sessions[sessionId];
    else document.sessions[sessionId] = next;
  });
}

export async function removeSessionMetadata(path: string, sessionId: string): Promise<void> {
  await updateDocument(path, (document) => { delete document.sessions[sessionId]; });
}

export async function replaceSessionFileIndex(path: string, files: SessionFileIndex): Promise<void> {
  await updateDocument(path, (document) => {
    document.indexed = true;
    document.files = files;
  });
}

export async function updateSessionFileIndex(
  path: string,
  update: (files: SessionFileIndex) => void,
): Promise<void> {
  if (!await readSessionFileIndex(path)) return;
  await updateDocument(path, (document) => {
    if (document.indexed) update(document.files);
  });
}

async function updateDocument(
  path: string,
  update: (document: SessionMetadataDocument) => void,
): Promise<void> {
  const previous = writeTails.get(path) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(async () => {
    const document = await readDocument(path);
    update(document);
    await writeDocument(path, document);
  });
  writeTails.set(path, run);
  try {
    await run;
  } finally {
    if (writeTails.get(path) === run) writeTails.delete(path);
  }
}

async function writeDocument(path: string, document: SessionMetadataDocument): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  const payload = document.indexed
    ? { version: 2, sessions: document.sessions, files: document.files }
    : document.sessions;
  try {
    await fs.writeFile(tmp, JSON.stringify(payload, null, 2), 'utf-8');
    await fs.rename(tmp, path);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}
