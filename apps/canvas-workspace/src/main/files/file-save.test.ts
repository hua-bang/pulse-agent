import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile, stat, chmod, symlink, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readFilePreview, FILE_PREVIEW_MAX_BYTES } from './file-preview';
import { readTextFile, saveFilePreview, saveTextFile } from './file-save';
let directory: string;
let path: string;
beforeEach(async () => { directory = await mkdtemp(join(tmpdir(), 'file-editor-')); path = join(directory, 'source.ts'); await writeFile(path, 'original\n'); });
afterEach(async () => { await rm(directory, { recursive: true, force: true }); });
const version = async () => {
  const read = await readFilePreview(path);
  if (!read.ok || read.kind !== 'text') throw new Error('Expected text');
  return read.version;
};
describe('version-checked local file save', () => {
  it('saves atomically, preserves mode, and returns the saved version', async () => {
    await chmod(path, 0o755);
    const result = await saveFilePreview({ filePath: path, expectedVersion: await version(), content: 'updated\n' });
    expect(result).toEqual({ ok: true, version: await version() });
    expect(await readFile(path, 'utf8')).toBe('updated\n');
    expect((await stat(path)).mode & 0o777).toBe(0o755);
    expect(await readdir(directory)).toEqual(['source.ts']);
  });
  it('rejects external changes without overwriting them', async () => {
    const expectedVersion = await version();
    await writeFile(path, 'written by VS Code');
    expect(await saveFilePreview({ filePath: path, expectedVersion, content: 'my draft' })).toMatchObject({ ok: false, conflict: true });
    expect(await readFile(path, 'utf8')).toBe('written by VS Code');
  });
  it('serializes concurrent saves so only one can commit the same base version', async () => {
    const expectedVersion = await version();
    const results = await Promise.all(['one', 'two'].map(content => saveFilePreview({ filePath: path, content, expectedVersion })));
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok && result.conflict)).toHaveLength(1);
  });
  it('retains UTF-8 BOM, CRLF and symlink identity', async () => {
    const content = '\uFEFFconst 中文 = 1;\r\n';
    await writeFile(path, content);
    const result = await readFilePreview(path);
    expect(result).toMatchObject({ content });
    const link = join(directory, 'link.ts');
    await symlink(path, link);
    expect(await saveFilePreview({ filePath: link, expectedVersion: await version(), content: content.replace('1', '2') })).toMatchObject({ ok: true });
    expect(await readlink(link)).toBe(path);
    expect(await readFile(path, 'utf8')).toBe(content.replace('1', '2'));
  });
  it('rejects oversized drafts and missing files without recreating them', async () => {
    expect(await saveFilePreview({ filePath: path, expectedVersion: await version(), content: 'a'.repeat(FILE_PREVIEW_MAX_BYTES + 1) })).toMatchObject({ ok: false });
    const expectedVersion = await version();
    await rm(path);
    expect(await saveFilePreview({ filePath: path, expectedVersion, content: 'draft' })).toMatchObject({ ok: false });
    expect(await readdir(directory)).toEqual([]);
  });

  it('reads and conditionally saves full notes larger than the preview limit', async () => {
    const content = '\uFEFF# 大笔记\r\n' + '中文'.repeat(FILE_PREVIEW_MAX_BYTES);
    await writeFile(path, content);
    const original = await readTextFile(path);
    expect(original).toMatchObject({ ok: true, content, version: expect.any(String) });
    expect(await readFilePreview(path)).toMatchObject({ ok: true, kind: 'too-large' });
    const updated = content + '\nend';
    const result = await saveTextFile({ filePath: path, content: updated, expectedVersion: original.version });
    expect(result).toMatchObject({ ok: true, version: expect.any(String) });
    expect(await readTextFile(path)).toMatchObject({ content: updated, version: result.ok ? result.version : '' });
  });

  it('preserves unversioned create/overwrite callers while returning the written version', async () => {
    const created = join(directory, 'new-note.md');
    const first = await saveTextFile({ filePath: created, content: 'one' });
    expect(first).toMatchObject({ ok: true, version: expect.any(String) });
    expect(await saveTextFile({ filePath: created, content: 'two' })).toMatchObject({ ok: true });
    expect(await readFile(created, 'utf8')).toBe('two');
  });

  it('shares the same CAS lane between ordinary notes and preview edits', async () => {
    const expectedVersion = (await readTextFile(path)).version!;
    const results = await Promise.all([
      saveTextFile({ filePath: path, content: 'note edit', expectedVersion }),
      saveFilePreview({ filePath: path, content: 'preview edit', expectedVersion }),
    ]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok && result.conflict)).toHaveLength(1);
    expect(await readdir(directory)).toEqual(['source.ts']);
  });
});
