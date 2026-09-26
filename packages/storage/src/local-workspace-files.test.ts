import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { localFileVersion } from './local-files.js';
import { createLocalWorkspaceFiles, fileContentVersion } from './local-workspace-files.js';
import { sameFileVersion } from './workspace-files.js';

let directory: string;
const files = createLocalWorkspaceFiles();
const uri = (name: string) => files.uriForPath(join(directory, name));

beforeEach(async () => {
  directory = await fs.mkdtemp(join(tmpdir(), 'pulse-workspace-files-'));
});

afterEach(async () => {
  await fs.rm(directory, { recursive: true, force: true });
});

describe('local workspace files', () => {
  it('shares one version scheme with file write intents', async () => {
    const receipt = await files.write(uri('note.md'), '# 标题\n');
    expect(receipt.version).toBe(localFileVersion('# 标题\n'));
    expect(await files.readText(uri('note.md'))).toEqual({ uri: uri('note.md'), version: receipt.version, content: '# 标题\n' });
    expect(files.localPath(receipt.uri)).toBe(join(await fs.realpath(directory), 'note.md'));
  });

  it('replaces only while the expected version still matches', async () => {
    const first = await files.write(uri('note.md'), 'one');
    await fs.writeFile(join(directory, 'note.md'), 'edited elsewhere');
    await expect(files.write(uri('note.md'), 'two', { expectedVersion: first.version }))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    expect(await fs.readFile(join(directory, 'note.md'), 'utf8')).toBe('edited elsewhere');

    const current = (await files.readText(uri('note.md')))!;
    await files.write(uri('note.md'), 'two', { expectedVersion: current.version });
    expect(await fs.readFile(join(directory, 'note.md'), 'utf8')).toBe('two');
    await expect(files.write(uri('gone.md'), 'x', { expectedVersion: current.version }))
      .rejects.toMatchObject({ code: 'revision_conflict' });
  });

  it('creates only when asked, and never over an existing file', async () => {
    await files.write(uri('image.png'), new Uint8Array([1, 2, 3]), { expectedVersion: null });
    await expect(files.write(uri('image.png'), new Uint8Array([9]), { expectedVersion: null }))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    const read = await files.readBytes(uri('image.png'));
    expect(Array.from(read!.bytes)).toEqual([1, 2, 3]);
    expect(read!.version).toBe(fileContentVersion(new Uint8Array([1, 2, 3])));
  });

  it('edits a file reached through a symlink in place and keeps its mode', async () => {
    await fs.writeFile(join(directory, 'real.md'), 'real', { mode: 0o640 });
    await fs.symlink(join(directory, 'real.md'), join(directory, 'link.md'));
    await files.write(uri('link.md'), 'updated');
    expect((await fs.lstat(join(directory, 'link.md'))).isSymbolicLink()).toBe(true);
    expect(await fs.readFile(join(directory, 'real.md'), 'utf8')).toBe('updated');
    if (process.platform !== 'win32') expect((await fs.stat(join(directory, 'real.md'))).mode & 0o777).toBe(0o640);
  });

  it('removes conditionally and treats a missing file as absent', async () => {
    const written = await files.write(uri('a.md'), 'a');
    await expect(files.remove(uri('a.md'), { expectedVersion: fileContentVersion(Buffer.from('b')) }))
      .rejects.toMatchObject({ code: 'revision_conflict' });
    await files.remove(uri('a.md'), { expectedVersion: written.version });
    expect(await files.readText(uri('a.md'))).toBeNull();
    await files.remove(uri('a.md'));
  });

  it('serializes concurrent writes to one file and leaves no temporary files', async () => {
    await Promise.all(Array.from({ length: 10 }, (_, index) => files.write(uri('busy.md'), `v${index}`)));
    expect(await fs.readdir(directory)).toEqual(['busy.md']);
  });

  it('accepts the bare digest earlier releases stored', () => {
    const version = localFileVersion('x');
    expect(sameFileVersion(version, version.slice('sha256:'.length))).toBe(true);
    expect(sameFileVersion(version, localFileVersion('y'))).toBe(false);
    expect(sameFileVersion(version, undefined)).toBe(false);
  });

  it('rejects non-file URIs and relative paths', () => {
    expect(() => files.localPath('https://example.com/a.md')).toThrow(/file:/);
    expect(() => files.uriForPath('relative.md')).toThrow(/absolute/);
  });

  it('removes a symlinked attachment entry, never the file it points to', async () => {
    const outside = await fs.mkdtemp(join(tmpdir(), 'pulse-outside-'));
    try {
      await fs.writeFile(join(outside, 'secret.txt'), 'keep me');
      await fs.symlink(join(outside, 'secret.txt'), join(directory, 'img-link.png'));
      await files.remove(uri('img-link.png'));
      await expect(fs.lstat(join(directory, 'img-link.png'))).rejects.toMatchObject({ code: 'ENOENT' });
      expect(await fs.readFile(join(outside, 'secret.txt'), 'utf8')).toBe('keep me');
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it.runIf(process.platform !== 'win32')('rejects remote hosts outside Windows', () => {
    expect(() => files.localPath('file://server/share/note.md')).toThrow(/file:/);
  });

  it.runIf(process.platform === 'win32')('round-trips Windows UNC share paths', () => {
    const unc = '\\\\server\\share\\note.md';
    expect(files.localPath(files.uriForPath(unc))).toBe(unc);
  });
});
