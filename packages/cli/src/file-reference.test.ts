import * as fs from 'fs/promises';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  applyFileReference,
  detectFileReferenceQuery,
  expandFileReferences,
  extractFileReferences,
  filterFileEntries,
  indexWorkspaceFiles,
  isIgnored,
} from './file-reference.js';

describe('detectFileReferenceQuery', () => {
  it('detects an @ reference at a word boundary', () => {
    expect(detectFileReferenceQuery('look at @src/ink', 16)).toEqual({ query: 'src/ink', start: 8 });
    expect(detectFileReferenceQuery('@', 1)).toEqual({ query: '', start: 0 });
  });

  it('ignores @ that is not at a word boundary or not at the cursor', () => {
    expect(detectFileReferenceQuery('mail me@example.com', 19)).toBeNull();
    expect(detectFileReferenceQuery('@src/app.ts done', 16)).toBeNull();
    expect(detectFileReferenceQuery('plain text', 10)).toBeNull();
  });
});

describe('applyFileReference', () => {
  it('replaces the partial query with the chosen path and a trailing space', () => {
    expect(applyFileReference('look at @src/ink', 16, 'src/ink-app.tsx')).toEqual({
      input: 'look at @src/ink-app.tsx ',
      cursor: 25,
    });
  });

  it('preserves text after the cursor', () => {
    expect(applyFileReference('@src and more', 4, 'src/app.ts').input).toBe('@src/app.ts  and more');
  });

  it('is a no-op when the cursor is not in a reference', () => {
    expect(applyFileReference('nothing here', 5, 'a.ts')).toEqual({ input: 'nothing here', cursor: 5 });
  });
});

describe('extractFileReferences', () => {
  it('collects unique refs and strips trailing punctuation', () => {
    expect(extractFileReferences('compare @a.ts and @b/c.ts, then @a.ts again')).toEqual(['a.ts', 'b/c.ts']);
  });

  it('ignores emails and returns nothing when there are no refs', () => {
    expect(extractFileReferences('write to me@example.com')).toEqual([]);
    expect(extractFileReferences('no refs at all')).toEqual([]);
  });
});

describe('isIgnored', () => {
  it('always ignores heavy directories and honours simple gitignore patterns', () => {
    expect(isIgnored('node_modules/foo/index.js', [])).toBe(true);
    expect(isIgnored('packages/cli/dist/index.cjs', [])).toBe(true);
    expect(isIgnored('src/app.log', ['*.log'])).toBe(true);
    expect(isIgnored('secrets/key.pem', ['secrets'])).toBe(true);
    expect(isIgnored('src/app.ts', ['*.log', 'secrets'])).toBe(false);
  });
});

describe('filterFileEntries', () => {
  const entries = [
    { relPath: 'src/ink-app.tsx', isDirectory: false },
    { relPath: 'src/ink-controller.ts', isDirectory: false },
    { relPath: 'docs/inkling.md', isDirectory: false },
    { relPath: 'src', isDirectory: true },
  ];

  it('keeps basename matches and breaks ties by path length', () => {
    expect(filterFileEntries(entries, 'ink').map(entry => entry.relPath)).toEqual([
      'src/ink-app.tsx',
      'docs/inkling.md',
      'src/ink-controller.ts',
    ]);
  });

  it('ranks a basename prefix above a mid-path match', () => {
    const mixed = [
      { relPath: 'vendor/inky/readme.md', isDirectory: false },
      { relPath: 'ink.ts', isDirectory: false },
    ];
    expect(filterFileEntries(mixed, 'ink').map(entry => entry.relPath)).toEqual(['ink.ts', 'vendor/inky/readme.md']);
  });

  it('returns the head of the index for an empty query', () => {
    expect(filterFileEntries(entries, '', 2)).toHaveLength(2);
  });
});

describe('indexWorkspaceFiles / expandFileReferences', () => {
  let root: string;

  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), 'pulse-files-'));
    await fs.mkdir(path.join(root, 'src'), { recursive: true });
    await fs.mkdir(path.join(root, 'node_modules', 'dep'), { recursive: true });
    await fs.writeFile(path.join(root, '.gitignore'), '*.log\nsecret\n');
    await fs.writeFile(path.join(root, 'src', 'app.ts'), 'export const a = 1;\n');
    await fs.writeFile(path.join(root, 'src', 'debug.log'), 'noise\n');
    await fs.writeFile(path.join(root, 'node_modules', 'dep', 'index.js'), 'x\n');
    await fs.writeFile(path.join(root, 'image.png'), Buffer.from([0x89, 0x50, 0x00, 0x01]));
  });

  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it('indexes tracked files and directories, skipping ignored ones', async () => {
    const index = await indexWorkspaceFiles(root);
    const paths = index.map(entry => entry.relPath);

    expect(paths).toContain('src/app.ts');
    expect(paths).toContain('src');
    expect(paths).not.toContain('src/debug.log');
    expect(paths.some(entry => entry.startsWith('node_modules'))).toBe(false);
    expect(index.find(entry => entry.relPath === 'src')?.isDirectory).toBe(true);
  });

  it('appends file contents while keeping the original message', async () => {
    const result = await expandFileReferences('explain @src/app.ts please', root);

    expect(result.attached).toEqual(['src/app.ts']);
    expect(result.text.startsWith('explain @src/app.ts please')).toBe(true);
    expect(result.text).toContain('--- @src/app.ts ---');
    expect(result.text).toContain('export const a = 1;');
  });

  it('lists directory contents for a directory reference', async () => {
    const result = await expandFileReferences('look at @src', root);
    expect(result.text).toContain('--- @src (directory listing) ---');
    expect(result.text).toContain('app.ts');
  });

  it('applies the same ignore rules the @ completion index uses', async () => {
    // Otherwise node_modules/.git/dist eat the entry cap in readdir order and
    // push real source files into the "+N more entries" tail.
    await fs.mkdir(path.join(root, 'src', 'node_modules'), { recursive: true });

    const result = await expandFileReferences('@src', root);

    expect(result.text).toContain('app.ts');
    expect(result.text).not.toContain('node_modules');
    expect(result.text).not.toContain('debug.log');
  });

  it('skips binaries, missing paths, and escapes outside the workspace', async () => {
    const result = await expandFileReferences('@image.png @nope.ts @../outside.ts', root);

    expect(result.attached).toEqual([]);
    expect(result.text).toBe('@image.png @nope.ts @../outside.ts');
    expect(result.skipped).toEqual([
      { ref: 'image.png', reason: 'binary file' },
      { ref: 'nope.ts', reason: 'not found' },
      { ref: '../outside.ts', reason: 'outside the workspace' },
    ]);
  });

  it('skips a sibling directory whose name merely extends the workspace basename', async () => {
    // A raw startsWith(root) check passes for `<root>-secrets`, leaking the file.
    const sibling = `${root}-secrets`;
    await fs.mkdir(sibling, { recursive: true });
    await fs.writeFile(path.join(sibling, 'creds.env'), 'TOKEN=leaked\n');

    try {
      const ref = `../${path.basename(sibling)}/creds.env`;
      const result = await expandFileReferences(`@${ref}`, root);

      expect(result.attached).toEqual([]);
      expect(result.text).not.toContain('TOKEN=leaked');
      expect(result.skipped).toEqual([{ ref, reason: 'outside the workspace' }]);
    } finally {
      await fs.rm(sibling, { recursive: true, force: true });
    }
  });

  it('truncates oversized files and honours the attachment cap', async () => {
    await fs.writeFile(path.join(root, 'big.txt'), 'x'.repeat(5000));
    const truncated = await expandFileReferences('@big.txt', root, { maxFileBytes: 100 });
    expect(truncated.text).toContain('truncated at 100 bytes');

    const capped = await expandFileReferences('@src/app.ts @big.txt', root, { maxFiles: 1 });
    expect(capped.attached).toEqual(['src/app.ts']);
    expect(capped.skipped[0].reason).toContain('attachment limit');
  });

  it('leaves messages without references untouched', async () => {
    const result = await expandFileReferences('nothing to attach', root);
    expect(result).toEqual({ text: 'nothing to attach', attached: [], skipped: [] });
  });
});
