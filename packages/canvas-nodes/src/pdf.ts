import { isRecord } from './scene';
import type {
  PdfDocumentState,
  PdfDocumentSummary,
  PdfPageText,
  PdfSource,
} from './types';

// Renderer-safe helpers: this module is imported by both the main capability
// provider and the MF renderer view, so it must stay free of node/electron
// imports.

export function pdfBaseName(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.length ? segments[segments.length - 1] : path;
}

export function normalizePdfSource(value: unknown): PdfSource | null {
  if (!isRecord(value)) return null;
  const path = typeof value.path === 'string' ? value.path.trim() : '';
  if (!path) return null;
  return {
    path,
    name: typeof value.name === 'string' && value.name.trim()
      ? value.name.trim()
      : pdfBaseName(path),
    size: typeof value.size === 'number' && Number.isFinite(value.size)
      ? value.size
      : undefined,
    addedAt: typeof value.addedAt === 'string' ? value.addedAt : undefined,
  };
}

export function clampPdfPage(page: unknown, pageCount: number | null): number {
  const raw = typeof page === 'number' && Number.isFinite(page) ? Math.floor(page) : 1;
  const min = Math.max(1, raw);
  return pageCount && pageCount >= 1 ? Math.min(min, pageCount) : min;
}

export function normalizePdfPayload(value: unknown): PdfDocumentState {
  const raw = isRecord(value) ? value : {};
  const source = normalizePdfSource(raw.source);
  const pageCount = typeof raw.pageCount === 'number'
    && Number.isFinite(raw.pageCount)
    && raw.pageCount >= 1
    ? Math.floor(raw.pageCount)
    : null;
  return {
    title: typeof raw.title === 'string' ? raw.title.trim() : '',
    source,
    pageCount,
    currentPage: clampPdfPage(raw.currentPage, pageCount),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : undefined,
  };
}

/**
 * Parse a page selection into a sorted, unique 1-based page list.
 * Accepts a number, a number array, or a string such as "1-3,5".
 * Returns null when the input selects all pages; out-of-range pages are
 * dropped when pageCount is known.
 */
export function parsePdfPageSelection(
  input: unknown,
  pageCount: number | null,
): number[] | null {
  const collected: number[] = [];
  const pushPage = (value: number) => {
    if (!Number.isFinite(value)) return;
    const page = Math.floor(value);
    if (page >= 1 && (!pageCount || page <= pageCount)) collected.push(page);
  };

  if (input == null || input === '' || input === 'all') return null;
  if (typeof input === 'number') {
    pushPage(input);
  } else if (Array.isArray(input)) {
    for (const item of input) {
      if (typeof item === 'number') pushPage(item);
    }
  } else if (typeof input === 'string') {
    for (const part of input.split(',')) {
      const token = part.trim();
      if (!token) continue;
      const range = token.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const start = Number(range[1]);
        const end = Number(range[2]);
        for (let page = Math.min(start, end); page <= Math.max(start, end); page += 1) {
          pushPage(page);
        }
        continue;
      }
      if (/^\d+$/.test(token)) pushPage(Number(token));
    }
  } else {
    return null;
  }

  return Array.from(new Set(collected)).sort((a, b) => a - b);
}

export function summarizePdf(state: PdfDocumentState): PdfDocumentSummary {
  return {
    title: state.title || state.source?.name || 'PDF Document',
    fileName: state.source?.name ?? null,
    path: state.source?.path ?? null,
    pageCount: state.pageCount,
    currentPage: state.currentPage,
    hasSource: !!state.source,
  };
}

export function pdfPatchFromState(state: PdfDocumentState): { payload: Record<string, unknown> } {
  return {
    payload: {
      ...state,
      updatedAt: new Date().toISOString(),
    },
  };
}

export interface FormattedPdfText {
  text: string;
  truncated: boolean;
}

export function formatPdfPages(pages: PdfPageText[], maxChars: number): FormattedPdfText {
  const joined = pages
    .map((page) => `[Page ${page.page}]\n${page.text.trim()}`)
    .join('\n\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  if (joined.length <= maxChars) return { text: joined, truncated: false };
  return { text: joined.slice(0, maxChars), truncated: true };
}

export function pdfFileUrl(path: string, page?: number): string {
  const normalized = path.replace(/\\/g, '/');
  const withRoot = normalized.startsWith('/') ? normalized : `/${normalized}`;
  const encoded = encodeURI(withRoot).replace(/#/g, '%23').replace(/\?/g, '%3F');
  const fragment = page && page > 1 ? `#page=${page}` : '';
  return `file://${encoded}${fragment}`;
}
