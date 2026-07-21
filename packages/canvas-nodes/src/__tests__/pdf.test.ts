import { describe, expect, it } from 'vitest';
import {
  clampPdfPage,
  formatPdfPages,
  normalizePdfPayload,
  normalizePdfSource,
  parsePdfPageSelection,
  pdfBaseName,
  pdfFileUrl,
  summarizePdf,
} from '../pdf';

describe('pdf payload helpers', () => {
  it('normalizes an empty payload to safe defaults', () => {
    expect(normalizePdfPayload(undefined)).toEqual({
      title: '',
      source: null,
      pageCount: null,
      currentPage: 1,
      updatedAt: undefined,
    });
  });

  it('normalizes a source and derives the file name from the path', () => {
    const source = normalizePdfSource({ path: '/docs/reports/q3 report.pdf' });
    expect(source).toEqual({
      path: '/docs/reports/q3 report.pdf',
      name: 'q3 report.pdf',
      size: undefined,
      addedAt: undefined,
    });
    expect(normalizePdfSource({ path: '   ' })).toBeNull();
    expect(normalizePdfSource('nope')).toBeNull();
  });

  it('handles windows-style paths in base names', () => {
    expect(pdfBaseName('C:\\Users\\me\\file.pdf')).toBe('file.pdf');
  });

  it('clamps currentPage into the known page range', () => {
    const state = normalizePdfPayload({ pageCount: 5, currentPage: 99 });
    expect(state.currentPage).toBe(5);
    expect(clampPdfPage(-3, 5)).toBe(1);
    expect(clampPdfPage(3, null)).toBe(3);
  });
});

describe('parsePdfPageSelection', () => {
  it('returns null for all-page selections', () => {
    expect(parsePdfPageSelection(undefined, 10)).toBeNull();
    expect(parsePdfPageSelection('', 10)).toBeNull();
    expect(parsePdfPageSelection('all', 10)).toBeNull();
  });

  it('parses numbers, arrays, and range strings', () => {
    expect(parsePdfPageSelection(3, 10)).toEqual([3]);
    expect(parsePdfPageSelection([5, 1, 5], 10)).toEqual([1, 5]);
    expect(parsePdfPageSelection('1-3,5', 10)).toEqual([1, 2, 3, 5]);
    expect(parsePdfPageSelection('3-1', 10)).toEqual([1, 2, 3]);
  });

  it('drops out-of-range and invalid pages', () => {
    expect(parsePdfPageSelection('8-12', 10)).toEqual([8, 9, 10]);
    expect(parsePdfPageSelection('0,abc,2', 10)).toEqual([2]);
    expect(parsePdfPageSelection('999', 10)).toEqual([]);
  });
});

describe('formatting and summaries', () => {
  it('joins pages with markers and truncates at maxChars', () => {
    const formatted = formatPdfPages(
      [
        { page: 1, text: 'Hello' },
        { page: 2, text: 'World' },
      ],
      1000,
    );
    expect(formatted.text).toBe('[Page 1]\nHello\n\n[Page 2]\nWorld');
    expect(formatted.truncated).toBe(false);

    const truncated = formatPdfPages([{ page: 1, text: 'x'.repeat(50) }], 20);
    expect(truncated.truncated).toBe(true);
    expect(truncated.text).toHaveLength(20);
  });

  it('summarizes source metadata', () => {
    const summary = summarizePdf(normalizePdfPayload({
      source: { path: '/tmp/spec.pdf' },
      pageCount: 4,
      currentPage: 2,
    }));
    expect(summary).toEqual({
      title: 'spec.pdf',
      fileName: 'spec.pdf',
      path: '/tmp/spec.pdf',
      pageCount: 4,
      currentPage: 2,
      hasSource: true,
    });
  });

  it('builds encoded file urls with page fragments', () => {
    expect(pdfFileUrl('/tmp/my file.pdf')).toBe('file:///tmp/my%20file.pdf');
    expect(pdfFileUrl('/tmp/a#b.pdf', 3)).toBe('file:///tmp/a%23b.pdf#page=3');
    expect(pdfFileUrl('/tmp/plain.pdf', 1)).toBe('file:///tmp/plain.pdf');
  });
});
