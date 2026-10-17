import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';

import { EditTool } from './edit.js';
import { LsTool } from './ls.js';
import { ReadTool } from './read.js';
import { WriteTool } from './write.js';

const workdir = () => mkdtempSync(path.join(tmpdir(), 'file-tools-'));

describe('file tools', () => {
  it('rejects binary files instead of returning decoded noise', async () => {
    const file = path.join(workdir(), 'image.bin');
    writeFileSync(file, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0x02]));

    await expect(ReadTool.execute({ filePath: file })).rejects.toThrow('Cannot read binary file');
  });

  it('keeps read errors for missing paths and directories', async () => {
    const dir = workdir();

    await expect(ReadTool.execute({ filePath: path.join(dir, 'missing.txt') })).rejects.toThrow('File does not exist');
    await expect(ReadTool.execute({ filePath: dir })).rejects.toThrow('Cannot read directory');
  });

  it('previews the edit at the replaced location, not an earlier equal string', async () => {
    const file = path.join(workdir(), 'notes.txt');
    // `NEW` already appears near the start; the replacement happens far later.
    writeFileSync(file, `NEW header\n${'filler line\n'.repeat(100)}old value\n`);

    const result = await EditTool.execute({ filePath: file, oldString: 'old value', newString: 'NEW value' });

    expect(readFileSync(file, 'utf-8')).toContain('NEW value');
    expect(result.preview).toContain('NEW value');
    expect(result.preview).not.toContain('NEW header');
  });

  it('creates parent directories on write and lists them asynchronously', async () => {
    const dir = workdir();
    const file = path.join(dir, 'nested', 'deep', 'out.txt');

    const first = await WriteTool.execute({ filePath: file, content: 'hello' });
    const second = await WriteTool.execute({ filePath: file, content: 'hello again' });

    expect(first).toMatchObject({ success: true, created: true, bytes: 5 });
    expect(second.created).toBe(false);
    expect((await LsTool.execute({ path: path.join(dir, 'nested', 'deep') })).files).toEqual(['out.txt']);
  });
});

describe('built-in tool sources', () => {
  // Engine tools run on GUI main threads (Electron hosts); a synchronous call
  // freezes the whole UI. Comments may still name the old sync APIs.
  const toolsDir = path.join(process.cwd(), 'src', 'tools');
  const sources = readdirSync(toolsDir).filter((file) => file.endsWith('.ts') && !file.endsWith('.test.ts'));

  it.each(sources)('%s uses no synchronous filesystem or process API', (file) => {
    const code = readFileSync(path.join(toolsDir, file), 'utf-8')
      .split('\n')
      .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
      .map((line) => line.replace(/\/\/.*$/, ''))
      .join('\n');
    expect(code).not.toMatch(/\b[A-Za-z]+Sync\b/);
  });
});
