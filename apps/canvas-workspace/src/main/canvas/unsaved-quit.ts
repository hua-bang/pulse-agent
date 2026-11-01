/**
 * Marker left when quit could not finish saving. The next launch reads it
 * once (`canvas:consume-unsaved-quit`) and tells the user.
 */
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { app, ipcMain } from 'electron';

const MARKER_FILE = 'unsaved-quit.json';

export type UnsavedQuitReason = 'failed' | 'timeout';

const markerPath = (dir?: string): string => join(dir ?? app.getPath('userData'), MARKER_FILE);

export async function recordUnsavedQuit(reason: UnsavedQuitReason, dir?: string): Promise<void> {
  const path = markerPath(dir);
  await mkdir(join(path, '..'), { recursive: true });
  await writeFile(path, JSON.stringify({ pending: true, reason, at: Date.now() }), 'utf8');
}

/** Read the marker and delete it. A missing file means there is nothing to say. */
export async function consumeUnsavedQuit(dir?: string): Promise<boolean> {
  const path = markerPath(dir);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    return false;
  }
  await rm(path, { force: true }).catch(() => undefined);
  try {
    const parsed = JSON.parse(raw) as { pending?: unknown };
    return parsed.pending === true;
  } catch {
    return true;
  }
}

export function registerUnsavedQuitIpc(): void {
  ipcMain.handle('canvas:consume-unsaved-quit', async () => {
    try {
      return { ok: true, pending: await consumeUnsavedQuit() };
    } catch (error) {
      return { ok: false, pending: false, error: error instanceof Error ? error.message : String(error) };
    }
  });
}
