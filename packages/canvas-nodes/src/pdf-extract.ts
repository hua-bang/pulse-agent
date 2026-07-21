import { readFile, stat } from 'node:fs/promises';
import type { PdfExtractor, PdfExtractResult, PdfPageText } from './types';

// Main-process-only module. pdfjs-dist is imported at runtime through a
// variable specifier so the vite lib build leaves the import untouched and
// Node resolves it from this package's node_modules; the legacy build runs
// its fake worker automatically under Node/Electron main.
const PDFJS_SPECIFIER = 'pdfjs-dist/legacy/build/pdf.mjs';

interface PdfjsTextItem {
  str?: string;
  hasEOL?: boolean;
}

interface PdfjsPage {
  getTextContent(): Promise<{ items: unknown[] }>;
}

interface PdfjsDocument {
  numPages: number;
  getPage(pageNumber: number): Promise<PdfjsPage>;
}

interface PdfjsLoadingTask {
  promise: Promise<PdfjsDocument>;
  destroy(): Promise<void>;
}

interface PdfjsModule {
  getDocument(params: Record<string, unknown>): PdfjsLoadingTask;
}

let pdfjsPromise: Promise<PdfjsModule> | null = null;

function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import(/* @vite-ignore */ PDFJS_SPECIFIER) as Promise<PdfjsModule>;
  }
  return pdfjsPromise;
}

function textFromItems(items: unknown[]): string {
  let text = '';
  for (const item of items) {
    const record = item as PdfjsTextItem;
    if (typeof record.str === 'string') text += record.str;
    if (record.hasEOL) text += '\n';
  }
  return text.replace(/\n{3,}/g, '\n\n').trim();
}

interface CacheEntry {
  fingerprint: string;
  pageCount: number;
  texts: Map<number, string>;
}

const MAX_CACHED_DOCUMENTS = 8;

async function fingerprintFile(path: string): Promise<string> {
  const info = await stat(path);
  return `${info.mtimeMs}:${info.size}`;
}

async function withDocument<T>(
  path: string,
  fn: (doc: PdfjsDocument) => Promise<T>,
): Promise<T> {
  const pdfjs = await loadPdfjs();
  const data = new Uint8Array(await readFile(path));
  const task = pdfjs.getDocument({
    data,
    useSystemFonts: true,
    isEvalSupported: false,
    disableFontFace: true,
  });
  try {
    return await fn(await task.promise);
  } finally {
    await task.destroy().catch(() => undefined);
  }
}

export function createPdfExtractor(): PdfExtractor {
  const cache = new Map<string, CacheEntry>();

  const entryFor = async (path: string): Promise<CacheEntry | null> => {
    const fingerprint = await fingerprintFile(path);
    const existing = cache.get(path);
    if (existing && existing.fingerprint === fingerprint) return existing;
    return null;
  };

  const storeEntry = (path: string, entry: CacheEntry) => {
    cache.delete(path);
    cache.set(path, entry);
    while (cache.size > MAX_CACHED_DOCUMENTS) {
      const oldest = cache.keys().next().value;
      if (oldest == null) break;
      cache.delete(oldest);
    }
  };

  return {
    async probe(path: string) {
      const cached = await entryFor(path);
      if (cached) return { pageCount: cached.pageCount };
      const fingerprint = await fingerprintFile(path);
      const pageCount = await withDocument(path, async (doc) => doc.numPages);
      storeEntry(path, { fingerprint, pageCount, texts: new Map() });
      return { pageCount };
    },

    async extract(path: string, pages?: number[]): Promise<PdfExtractResult> {
      const fingerprint = await fingerprintFile(path);
      let entry = await entryFor(path);
      if (!entry) {
        entry = { fingerprint, pageCount: 0, texts: new Map() };
      }

      const knownCount = entry.pageCount || null;
      const targets = pages && pages.length
        ? pages.filter((page) => page >= 1 && (!knownCount || page <= knownCount))
        : null;
      const missing = targets
        ? targets.filter((page) => !entry!.texts.has(page))
        : null;
      const needsDocument = !entry.pageCount || missing === null || missing.length > 0;

      if (needsDocument) {
        await withDocument(path, async (doc) => {
          entry!.pageCount = doc.numPages;
          const wanted = (targets ?? Array.from({ length: doc.numPages }, (_, i) => i + 1))
            .filter((page) => page >= 1 && page <= doc.numPages && !entry!.texts.has(page));
          for (const pageNumber of wanted) {
            const page = await doc.getPage(pageNumber);
            const content = await page.getTextContent();
            entry!.texts.set(pageNumber, textFromItems(content.items));
          }
        });
      }

      storeEntry(path, entry);
      const resolved = (targets ?? Array.from({ length: entry.pageCount }, (_, i) => i + 1))
        .filter((page) => page >= 1 && page <= entry!.pageCount);
      const result: PdfPageText[] = resolved.map((page) => ({
        page,
        text: entry!.texts.get(page) ?? '',
      }));
      return { pageCount: entry.pageCount, pages: result };
    },
  };
}
