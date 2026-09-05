import { promises as fs } from 'fs';
import { basename, dirname, join } from 'path';

export function isEnoent(err: unknown): boolean {
  return !!err && typeof err === 'object' && (err as { code?: string }).code === 'ENOENT';
}

function shouldRotateRollingBackup(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const obj = parsed as { nodes?: unknown[]; workspaces?: unknown[]; entries?: unknown[] };
  return (
    (Array.isArray(obj.nodes) && obj.nodes.length > 0) ||
    (Array.isArray(obj.workspaces) && obj.workspaces.length > 0) ||
    (Array.isArray(obj.entries) && obj.entries.length > 0)
  );
}

/** Publish JSON with tmp + rename, optionally rotating a valid non-empty backup. */
export async function atomicWriteJson(
  finalPath: string,
  serialized: string,
  opts: { rollingBackup?: boolean } = {},
): Promise<void> {
  const dir = dirname(finalPath);
  const base = basename(finalPath);
  const tmpPath = join(
    dir,
    `${base}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  const bakPath = join(dir, `${base}.bak`);

  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(tmpPath, serialized, 'utf-8');

  if (opts.rollingBackup) {
    try {
      const currentRaw = await fs.readFile(finalPath, 'utf-8');
      try {
        if (shouldRotateRollingBackup(JSON.parse(currentRaw))) {
          await fs.copyFile(finalPath, bakPath).catch(() => undefined);
        }
      } catch {
        // Keep the existing last-known-good backup when primary is corrupt.
      }
    } catch {
      // First write: there is no current file to rotate.
    }
  }

  await fs.rename(tmpPath, finalPath);
}

export type ReadJsonResult<T = unknown> =
  | { kind: 'ok'; data: T; recoveredFromBackup: boolean }
  | { kind: 'missing' }
  | { kind: 'unrecoverable'; err: unknown };

/** Read JSON with transparent fallback to the rolling `.bak` snapshot. */
export async function readJsonWithRecovery<T = unknown>(
  finalPath: string,
): Promise<ReadJsonResult<T>> {
  const bakPath = `${finalPath}.bak`;
  let primaryErr: unknown = null;

  try {
    const raw = await fs.readFile(finalPath, 'utf-8');
    try {
      return { kind: 'ok', data: JSON.parse(raw) as T, recoveredFromBackup: false };
    } catch (err) {
      primaryErr = err;
    }
  } catch (err) {
    if (!isEnoent(err)) primaryErr = err;
  }

  try {
    const bakRaw = await fs.readFile(bakPath, 'utf-8');
    return {
      kind: 'ok',
      data: JSON.parse(bakRaw) as T,
      recoveredFromBackup: true,
    };
  } catch (bakErr) {
    if (isEnoent(bakErr)) {
      return primaryErr
        ? { kind: 'unrecoverable', err: primaryErr }
        : { kind: 'missing' };
    }
    return { kind: 'unrecoverable', err: primaryErr ?? bakErr };
  }
}
