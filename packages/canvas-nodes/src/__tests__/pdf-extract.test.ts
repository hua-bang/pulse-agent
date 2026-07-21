import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPdfExtractor } from '../pdf-extract';

/**
 * Build a minimal but structurally valid single-page PDF containing the given
 * text, with a correct xref table so pdfjs parses it without recovery.
 */
function buildMinimalPdf(text: string): Buffer {
  const escaped = text.replace(/\\/g, '\\\\').replace(/\(/g, '\\(').replace(/\)/g, '\\)');
  const stream = `BT /F1 18 Tf 72 720 Td (${escaped}) Tj ET`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R '
      + '/Resources << /Font << /F1 5 0 R >> >> >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
  ];

  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, index) => {
    offsets.push(body.length);
    body += `${index + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefOffset = body.length;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) {
    xref += `${String(offset).padStart(10, '0')} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`
    + `startxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(body + xref + trailer, 'latin1');
}

describe('pdf extractor (real pdfjs)', () => {
  let dir: string;
  let pdfPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'pulse-pdf-node-'));
    pdfPath = join(dir, 'fixture.pdf');
    await writeFile(pdfPath, buildMinimalPdf('Hello Pulse PDF'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('probes the page count', async () => {
    const extractor = createPdfExtractor();
    await expect(extractor.probe(pdfPath)).resolves.toEqual({ pageCount: 1 });
  });

  it('extracts text and serves repeat calls from the cache', async () => {
    const extractor = createPdfExtractor();
    const first = await extractor.extract(pdfPath);
    expect(first.pageCount).toBe(1);
    expect(first.pages[0].text).toContain('Hello Pulse PDF');

    const again = await extractor.extract(pdfPath, [1]);
    expect(again.pages[0].text).toContain('Hello Pulse PDF');
  });

  it('rejects on missing files', async () => {
    const extractor = createPdfExtractor();
    await expect(extractor.probe(join(dir, 'missing.pdf'))).rejects.toThrow();
  });
});
