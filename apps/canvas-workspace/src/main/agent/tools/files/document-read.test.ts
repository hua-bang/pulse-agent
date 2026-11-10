import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { strToU8, zipSync } from 'fflate';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classifyCanvasToolOperation } from '../../tool-policy';
import { createDocumentTools } from './document-read';

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const docx = (paragraphs: string[]) => zipSync({
  'word/document.xml': strToU8(`<w:document ${W}><w:body>${
    paragraphs.map((text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`).join('')
  }</w:body></w:document>`),
});

describe('document_read', () => {
  const tool = createDocumentTools().document_read;
  let dir = '';
  const read = (input: Record<string, unknown>) => tool.execute(input as never, {}) as Promise<string>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'document-read-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is a read-tier tool, so Ask mode does not stop it', () => {
    expect(classifyCanvasToolOperation('document_read')).toBe('read');
  });

  it('reads a Word document as Markdown', async () => {
    const path = join(dir, '需求.docx');
    await writeFile(path, docx(['第一段', '第二段']));
    expect(await read({ path })).toBe(`[${path} · docx · characters 0-8 of 8]\n\n第一段\n\n第二段`);
  });

  it('pages long results by character offset', async () => {
    const path = join(dir, 'notes.txt');
    await writeFile(path, 'abcdefghij');
    expect(await read({ path, maxChars: 4 }))
      .toBe(`[${path} · text · characters 0-4 of 10; more remains, continue with offset 4]\n\nabcd`);
    expect(await read({ path, offset: 8, maxChars: 4 })).toBe(`[${path} · text · characters 8-10 of 10]\n\nij`);
  });

  it('explains unsupported binary files and bad paths instead of throwing', async () => {
    const path = join(dir, 'scan.pdf');
    await writeFile(path, Buffer.from([0x25, 0x50, 0x44, 0x46, 0x00, 0x01]));
    expect(await read({ path })).toMatch(/^Error: Cannot read binary file: .*PDF .*not supported yet/);
    expect(await read({ path: join(dir, 'broken.docx') })).toMatch(/^Error: /);
    await writeFile(join(dir, 'fake.docx'), 'not a zip');
    expect(await read({ path: join(dir, 'fake.docx') })).toMatch(/^Error: Could not read .* as docx/);
    expect(await read({ path: 'relative/file.docx' })).toMatch(/^Error: path must be absolute/);
  });
});
