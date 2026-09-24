import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PulseStorage } from './contracts.js';
import type { FileWriteInput } from './file-contracts.js';
import { localFileVersion, prepareLocalFileWrite, recoverLocalFileWrites } from './local-files.js';
import { openSqliteStorage } from './sqlite/index.js';

let directory: string;
let databasePath: string;
let filePath: string;
let storage: PulseStorage;

async function stage(write: FileWriteInput): Promise<void> {
  const previous = await storage.canvas.read('work');
  await storage.canvas.commit({
    workspaceId: 'work', expectedRevision: previous?.revision ?? null,
    nodes: { put: [{ id: write.nodeId, type: 'file', data: { filePath, content: write.content } }] },
    fileWrites: [write],
  });
}

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'pulse-file-recovery-'));
  databasePath = join(directory, 'store.sqlite');
  filePath = join(directory, 'note.md');
  storage = await openSqliteStorage({ path: databasePath });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await storage.close();
  await fs.rm(directory, { recursive: true, force: true });
});

describe('local file intent recovery', () => {
  it('captures exact UTF-8 base content and refuses an unexpected source version', async () => {
    const base = '\ufeff原文\n';
    await fs.writeFile(filePath, base);
    const write = await prepareLocalFileWrite(filePath, 'note', 'Target');
    expect(write).toMatchObject({ baseContent: base, baseVersion: localFileVersion(base), content: 'Target' });
    await expect(prepareLocalFileWrite(filePath, 'note', 'Target', null))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await fs.readFile(filePath, 'utf8')).toBe(base);
  });

  it('creates a missing regular file and acknowledges its matching index state', async () => {
    filePath = join(directory, 'notes', 'new.md');
    const write = await prepareLocalFileWrite(filePath, 'note', 'New text', null);
    await stage(write);
    const report = await recoverLocalFileWrites(storage, { workspaceId: 'work' });
    expect(report).toMatchObject({ ok: true, applied: 1, errors: 0, conflicts: 0 });
    expect(await fs.readFile(filePath, 'utf8')).toBe('New text');
    expect(await storage.canvas.readNode('work', 'note')).toMatchObject({ data: {
      fileWriteStatus: 'applied', saved: true, modified: false,
    } });
    expect(await storage.fileWrites.get(write.id)).toMatchObject({ baseContent: null, content: 'New text', status: 'applied' });
    expect((await fs.readdir(join(directory, 'notes'))).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });

  it('preserves an external edit and both snapshots, and never auto-overwrites a recorded conflict', async () => {
    await fs.writeFile(filePath, 'Base');
    const write = await prepareLocalFileWrite(filePath, 'note', 'Requested');
    await stage(write);
    await fs.writeFile(filePath, 'External edit');
    expect(await recoverLocalFileWrites(storage)).toMatchObject({ ok: false, conflicts: 1 });
    expect(await fs.readFile(filePath, 'utf8')).toBe('External edit');
    expect(await storage.fileWrites.get(write.id)).toMatchObject({ baseContent: 'Base', content: 'Requested', status: 'conflict' });
    await fs.writeFile(filePath, 'Base');
    expect(await recoverLocalFileWrites(storage)).toMatchObject({ conflicts: 1 });
    expect(await fs.readFile(filePath, 'utf8')).toBe('Base');
    vi.spyOn(fs, 'open').mockRejectedValueOnce(Object.assign(new Error('Temporarily unreadable'), { code: 'EACCES' }));
    expect(await recoverLocalFileWrites(storage)).toMatchObject({ conflicts: 1 });
    vi.restoreAllMocks();
    expect((await storage.fileWrites.get(write.id))?.status).toBe('conflict');
    expect(await recoverLocalFileWrites(storage)).toMatchObject({ conflicts: 1 });
    expect(await fs.readFile(filePath, 'utf8')).toBe('Base');
    await fs.writeFile(filePath, 'Requested');
    expect(await recoverLocalFileWrites(storage)).toMatchObject({ ok: true, applied: 1 });
  });

  it('recovers after target bytes landed but the acknowledgement failed, without rewriting the file', async () => {
    await fs.writeFile(filePath, 'Base');
    const write = await prepareLocalFileWrite(filePath, 'note', 'Requested');
    await stage(write);
    const realSettle = storage.fileWrites.settle.bind(storage.fileWrites);
    let failed = false;
    vi.spyOn(storage.fileWrites, 'settle').mockImplementation(async (id, outcome) => {
      if (outcome.status === 'applied' && !failed) {
        failed = true;
        throw new Error('Injected acknowledgement failure');
      }
      return realSettle(id, outcome);
    });
    expect(await recoverLocalFileWrites(storage)).toMatchObject({ ok: false, errors: 1 });
    expect(await fs.readFile(filePath, 'utf8')).toBe('Requested');
    expect((await storage.fileWrites.get(write.id))?.status).toBe('error');
    vi.restoreAllMocks();
    await storage.close();
    storage = await openSqliteStorage({ path: databasePath });
    const rename = vi.spyOn(fs, 'rename');
    expect(await recoverLocalFileWrites(storage)).toMatchObject({ ok: true, applied: 1 });
    expect(rename).not.toHaveBeenCalled();
    expect(await storage.canvas.readNode('work', 'note')).toMatchObject({ data: { saved: true } });
  });

  it('keeps a failed replacement recoverable and cleans its staging file', async () => {
    await fs.writeFile(filePath, 'Base');
    const write = await prepareLocalFileWrite(filePath, 'note', 'Requested');
    await stage(write);
    vi.spyOn(fs, 'rename').mockRejectedValueOnce(Object.assign(new Error('Target is not writable'), { code: 'EACCES' }));
    const report = await recoverLocalFileWrites(storage);
    expect(report).toMatchObject({ ok: false, errors: 1 });
    expect(await fs.readFile(filePath, 'utf8')).toBe('Base');
    expect(await storage.fileWrites.get(write.id)).toMatchObject({ status: 'error', baseContent: 'Base', content: 'Requested' });
    expect((await fs.readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
    expect(await recoverLocalFileWrites(storage)).toMatchObject({ ok: true, applied: 1 });
    expect(await fs.readFile(filePath, 'utf8')).toBe('Requested');
  });

  it('does not apply a superseded intent over a newer node edit', async () => {
    await fs.writeFile(filePath, 'Base');
    const first = await prepareLocalFileWrite(filePath, 'note', 'First');
    await stage(first);
    const second = await prepareLocalFileWrite(filePath, 'note', 'Second');
    await stage(second);
    expect(await recoverLocalFileWrites(storage)).toMatchObject({ conflicts: 1, applied: 1 });
    expect(await fs.readFile(filePath, 'utf8')).toBe('Second');
    expect((await storage.fileWrites.get(first.id))?.status).toBe('conflict');
    expect(await storage.canvas.readNode('work', 'note')).toMatchObject({ data: {
      content: 'Second', fileWriteIntentId: second.id, saved: true,
    } });
  });

  it('refuses non-file schemes and symlink targets without changing their contents', async () => {
    await fs.writeFile(filePath, 'Base');
    const write = await prepareLocalFileWrite(filePath, 'note', 'Requested');
    await stage({ ...write, uri: 'https://example.invalid/note.md' });
    expect(await recoverLocalFileWrites(storage)).toMatchObject({ errors: 1 });
    expect(await fs.readFile(filePath, 'utf8')).toBe('Base');
    const linked = join(directory, 'linked.md');
    await fs.symlink(filePath, linked);
    await expect(prepareLocalFileWrite(linked, 'other', 'Denied')).rejects.toMatchObject({ code: 'invalid_argument' });
    expect(await fs.readFile(filePath, 'utf8')).toBe('Base');
  });

  it('detects an external edit that lands while the temporary file is being prepared', async () => {
    await fs.writeFile(filePath, 'Base');
    await stage(await prepareLocalFileWrite(filePath, 'note', 'Requested'));
    const realOpen = fs.open.bind(fs);
    vi.spyOn(fs, 'open').mockImplementation(async (path, flags, mode) => {
      const handle = await realOpen(path, flags, mode);
      if (String(path).includes('.pulse-write-')) await fs.writeFile(filePath, 'Concurrent editor');
      return handle;
    });
    expect(await recoverLocalFileWrites(storage)).toMatchObject({ ok: false, conflicts: 1 });
    expect(await fs.readFile(filePath, 'utf8')).toBe('Concurrent editor');
    expect((await fs.readdir(directory)).filter(name => name.endsWith('.tmp'))).toEqual([]);
  });
});
