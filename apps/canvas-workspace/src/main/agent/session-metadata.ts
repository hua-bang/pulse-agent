import { promises as fs } from 'fs';
import { dirname } from 'path';
import { randomUUID } from 'crypto';

export interface SessionMetadata {
  title?: string;
  pinned?: boolean;
}

export type SessionMetadataMap = Record<string, SessionMetadata>;

export async function readSessionMetadata(path: string): Promise<SessionMetadataMap> {
  try {
    const raw = await fs.readFile(path, 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object'
      ? parsed as SessionMetadataMap
      : {};
  } catch {
    return {};
  }
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
  const metadata = await readSessionMetadata(path);
  const next = { ...metadata[sessionId], ...patch };
  if (next.pinned === false) delete next.pinned;
  if (!next.title && !next.pinned) delete metadata[sessionId];
  else metadata[sessionId] = next;
  await writeSessionMetadata(path, metadata);
}

export async function removeSessionMetadata(
  path: string,
  sessionId: string,
): Promise<void> {
  const metadata = await readSessionMetadata(path);
  if (!(sessionId in metadata)) return;
  delete metadata[sessionId];
  await writeSessionMetadata(path, metadata);
}

async function writeSessionMetadata(
  path: string,
  metadata: SessionMetadataMap,
): Promise<void> {
  await fs.mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await fs.writeFile(tmp, JSON.stringify(metadata, null, 2), 'utf-8');
    await fs.rename(tmp, path);
  } catch (err) {
    await fs.unlink(tmp).catch(() => undefined);
    throw err;
  }
}
