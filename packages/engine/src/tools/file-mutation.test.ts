import * as fs from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { setImmediate } from 'timers/promises';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Real temporary files, with async fs completion under test control. No sleeps
// or probabilistic races: a held snapshot lets every other runnable call drain.
vi.mock('fs/promises', async () => {
  const actual = await vi.importActual<typeof import('fs/promises')>('fs/promises');
  const sync = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    realpath: vi.fn(async (file: string) => sync.realpathSync(file)),
    access: vi.fn(async (file: string) => sync.accessSync(file)),
    mkdir: vi.fn(async (file: string, options: fs.MakeDirectoryOptions) => sync.mkdirSync(file, options)),
    readFile: vi.fn(async (file: string) => sync.readFileSync(file, 'utf-8')),
    writeFile: vi.fn(async (file: string, content: string) => sync.writeFileSync(file, content)),
  };
});

import * as io from 'fs/promises';
import { EditTool } from './edit.js';
import { WriteTool } from './write.js';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

let dir: string;
let file: string;
beforeEach(() => {
  vi.clearAllMocks();
  dir = fs.mkdtempSync(path.join(tmpdir(), 'file-mutation-'));
  file = path.join(dir, 'notes.txt');
  fs.writeFileSync(file, 'alpha\nbeta\n');
});
afterEach(() => {
  vi.restoreAllMocks();
  fs.rmSync(dir, { recursive: true, force: true });
});

function holdFirstRead() {
  const entered = deferred();
  const release = deferred();
  vi.mocked(io.readFile).mockImplementationOnce(async (target) => {
    const snapshot = fs.readFileSync(target, 'utf-8');
    entered.resolve();
    await release.promise;
    return snapshot;
  });
  return { entered: entered.promise, release: release.resolve };
}

const editAlpha = (filePath: string) => EditTool.execute({ filePath, oldString: 'alpha', newString: 'ALPHA' });
const editBeta = (filePath: string) => EditTool.execute({ filePath, oldString: 'beta', newString: 'BETA' });

describe('file mutation coordination', () => {
  it.each(['same path', 'normalized relative path', 'file symlink', 'directory symlink'])(
    'preserves both successful edits through %s', async (alias) => {
      let secondPath = file;
      if (alias === 'normalized relative path') secondPath = path.relative(process.cwd(), `${dir}/./notes.txt`);
      if (alias === 'file symlink') {
        secondPath = path.join(dir, 'alias.txt');
        fs.symlinkSync(file, secondPath);
      }
      if (alias === 'directory symlink') {
        fs.symlinkSync(dir, path.join(dir, 'alias-dir'));
        secondPath = path.join(dir, 'alias-dir', 'notes.txt');
      }
      const gate = holdFirstRead();
      const first = editAlpha(file);
      await gate.entered;
      const second = editBeta(secondPath);
      await setImmediate();
      // On old code second has already read and written the stale snapshot.
      const readsWhileHeld = vi.mocked(io.readFile).mock.calls.length;
      gate.release();
      const results = await Promise.all([first, second]);
      expect(results).toMatchObject([{ success: true, replacements: 1 }, { success: true, replacements: 1 }]);
      expect(fs.readFileSync(file, 'utf-8')).toBe('ALPHA\nBETA\n');
      expect(readsWhileHeld).toBe(1);
    },
  );

  it('allows another file to finish while an edit holds its snapshot', async () => {
    const other = path.join(dir, 'other.txt');
    fs.writeFileSync(other, 'alpha\nbeta\n');
    const gate = holdFirstRead();
    const first = editAlpha(file);
    await gate.entered;
    try {
      await expect(editBeta(other)).resolves.toMatchObject({ success: true });
      expect(fs.readFileSync(other, 'utf-8')).toBe('alpha\nBETA\n');
    } finally {
      gate.release();
      await first;
    }
  });

  it('releases a failed validation for queued edits and later retries', async () => {
    const gate = holdFirstRead();
    const failed = EditTool.execute({ filePath: file, oldString: 'missing', newString: 'x' });
    const rejected = expect(failed).rejects.toThrow(`old_string not found in file: ${file}`);
    await gate.entered;
    const next = editAlpha(file);
    gate.release();
    await rejected;
    await next;
    await editBeta(file);
    expect(fs.readFileSync(file, 'utf-8')).toBe('ALPHA\nBETA\n');
  });

  it('releases an I/O rejection for multiple queued waiters and a later retry', async () => {
    const gate = holdFirstRead();
    const error = new Error('write denied');
    vi.mocked(io.writeFile).mockRejectedValueOnce(error);
    const first = editAlpha(file);
    const rejected = expect(first).rejects.toBe(error);
    await gate.entered;
    const queued = Promise.all([editAlpha(file), editBeta(file)]);
    gate.release();
    await rejected;
    await queued;
    await WriteTool.execute({ filePath: file, content: 'retry' });
    expect(fs.readFileSync(file, 'utf-8')).toBe('retry');
  });

  it('propagates resolution errors and allows a subsequent retry', async () => {
    const error = Object.assign(new Error('permission denied'), { code: 'EACCES' });
    vi.mocked(io.realpath).mockRejectedValueOnce(error);
    await expect(editAlpha(file)).rejects.toBe(error);
    await expect(editAlpha(file)).resolves.toMatchObject({ success: true });
  });

  it('queues an overwrite behind the entire edit instead of losing it to a stale edit', async () => {
    const gate = holdFirstRead();
    const first = editAlpha(file);
    await gate.entered;
    const write = WriteTool.execute({ filePath: file, content: 'replacement' });
    await setImmediate();
    const writesWhileHeld = vi.mocked(io.writeFile).mock.calls.length;
    gate.release();
    await Promise.all([first, write]);
    expect(fs.readFileSync(file, 'utf-8')).toBe('replacement');
    expect(writesWhileHeld).toBe(0);
  });

  it('queues an edit behind an in-flight overwrite', async () => {
    const entered = deferred();
    const release = deferred();
    vi.mocked(io.writeFile).mockImplementationOnce(async (target, content) => {
      entered.resolve();
      await release.promise;
      fs.writeFileSync(target, content as string);
    });
    const first = WriteTool.execute({ filePath: file, content: 'alpha\nnew beta\n' });
    await entered.promise;
    const second = editAlpha(file);
    await setImmediate();
    const readsWhileHeld = vi.mocked(io.readFile).mock.calls.length;
    release.resolve();
    await Promise.all([first, second]);
    expect(fs.readFileSync(file, 'utf-8')).toBe('ALPHA\nnew beta\n');
    expect(readsWhileHeld).toBe(0);
  });

  it('coordinates creation through a symlinked existing ancestor', async () => {
    fs.symlinkSync(dir, path.join(dir, 'alias-dir'));
    const target = path.join(dir, 'nested', 'deep', 'new.txt');
    const alias = path.join(dir, 'alias-dir', 'nested', 'deep', 'new.txt');
    const results = await Promise.all([
      WriteTool.execute({ filePath: target, content: 'one' }),
      WriteTool.execute({ filePath: alias, content: 'two' }),
    ]);
    expect(results.map((result) => result.created).sort()).toEqual([false, true]);
    expect(['one', 'two']).toContain(fs.readFileSync(target, 'utf-8'));
  });

  it('preserves uniqueness, replaceAll, and unchanged-input errors', async () => {
    fs.writeFileSync(file, 'alpha alpha');
    await expect(editAlpha(file)).rejects.toThrow('old_string is not unique');
    await expect(EditTool.execute({ filePath: file, oldString: 'alpha', newString: 'alpha' })).rejects.toThrow('must be different');
    await expect(EditTool.execute({ filePath: file, oldString: 'alpha', newString: '中', replaceAll: true })).resolves.toMatchObject({ success: true, replacements: 2, preview: '...中 中...' });
    expect(fs.readFileSync(file, 'utf-8')).toBe('中 中');
  });
});
