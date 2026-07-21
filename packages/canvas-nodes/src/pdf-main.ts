import { stat } from 'node:fs/promises';
import { PDF_DOCUMENT_NODE_TYPE, PDF_PICK_FILE_CHANNEL } from './constants';
import { isRecord } from './scene';
import { createPdfExtractor } from './pdf-extract';
import {
  clampPdfPage,
  formatPdfPages,
  normalizePdfPayload,
  normalizePdfSource,
  parsePdfPageSelection,
  pdfBaseName,
  pdfPatchFromState,
  summarizePdf,
} from './pdf';
import type {
  MainCtx,
  PdfDocumentState,
  PdfExtractor,
  PdfSource,
  PluginNodeActionResult,
  PluginNodePatch,
  PluginNodeRef,
  PluginNodeWriteInput,
} from './types';

const PDF_ACTIONS = ['set_source', 'extract_text', 'go_to_page', 'summarize'];
const READ_EXCERPT_MAX_CHARS = 8000;
const READ_EXCERPT_MAX_PAGES = 10;
const READ_EXCERPT_PAGE_LIMIT = 30;
const EXTRACT_DEFAULT_MAX_CHARS = 20000;
const EXTRACT_MIN_MAX_CHARS = 500;
const EXTRACT_MAX_MAX_CHARS = 200000;

export interface PdfFilePick {
  canceled: boolean;
  path?: string;
}

export interface PdfNodeDeps {
  extractor: PdfExtractor;
  statFile(path: string): Promise<{ size: number; isFile: boolean }>;
  pickPdfFile(): Promise<PdfFilePick>;
}

// Electron is imported through a variable specifier: the vite lib build must
// not try to bundle it, and this package intentionally has no electron types.
const ELECTRON_SPECIFIER = 'electron';

interface ElectronDialogLike {
  showOpenDialog(options: {
    properties?: string[];
    filters?: Array<{ name: string; extensions: string[] }>;
  }): Promise<{ canceled: boolean; filePaths: string[] }>;
}

async function pickViaElectronDialog(): Promise<PdfFilePick> {
  try {
    const mod = (await import(/* @vite-ignore */ ELECTRON_SPECIFIER)) as {
      dialog?: ElectronDialogLike;
    };
    if (!mod.dialog) return { canceled: true };
    const result = await mod.dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'PDF Documents', extensions: ['pdf'] }],
    });
    if (result.canceled || !result.filePaths.length) return { canceled: true };
    return { canceled: false, path: result.filePaths[0] };
  } catch {
    return { canceled: true };
  }
}

export function createDefaultPdfDeps(): PdfNodeDeps {
  return {
    extractor: createPdfExtractor(),
    async statFile(path: string) {
      const info = await stat(path);
      return { size: info.size, isFile: info.isFile() };
    },
    pickPdfFile: pickViaElectronDialog,
  };
}

function stateFromRef(ref: PluginNodeRef): PdfDocumentState {
  const data = isRecord(ref.node.data) ? ref.node.data : {};
  return normalizePdfPayload(data.payload);
}

async function probeSource(
  deps: PdfNodeDeps,
  path: string,
): Promise<{ source: PdfSource; pageCount: number | null; error?: string }> {
  const info = await deps.statFile(path);
  if (!info.isFile) throw new Error(`Not a file: ${path}`);
  const source: PdfSource = {
    path,
    name: pdfBaseName(path),
    size: info.size,
    addedAt: new Date().toISOString(),
  };
  try {
    const probed = await deps.extractor.probe(path);
    return { source, pageCount: probed.pageCount };
  } catch (err) {
    return {
      source,
      pageCount: null,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function readExcerpt(
  deps: PdfNodeDeps,
  state: PdfDocumentState,
): Promise<{ content: string; pageCount: number | null }> {
  if (!state.source) {
    return {
      content:
        'No PDF attached yet. Attach one with action "set_source" '
        + '({"path": "/absolute/path/to/file.pdf"}) or let the user pick a file from the node UI.',
      pageCount: state.pageCount,
    };
  }
  try {
    const { pageCount } = await deps.extractor.probe(state.source.path);
    const pages = pageCount > READ_EXCERPT_PAGE_LIMIT
      ? Array.from({ length: READ_EXCERPT_MAX_PAGES }, (_, i) => i + 1)
      : undefined;
    const extraction = await deps.extractor.extract(state.source.path, pages);
    const formatted = formatPdfPages(extraction.pages, READ_EXCERPT_MAX_CHARS);
    const notes: string[] = [];
    if (pages) {
      notes.push(`Excerpt covers pages 1-${READ_EXCERPT_MAX_PAGES} of ${pageCount}.`);
    }
    if (formatted.truncated) {
      notes.push('Excerpt truncated.');
    }
    if (notes.length) {
      notes.push('Use action "extract_text" with {"pages": "N-M"} for more.');
    }
    const content = formatted.text || '[No extractable text on the sampled pages.]';
    return {
      content: notes.length ? `${content}\n\n${notes.join(' ')}` : content,
      pageCount,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      content: `[PDF text extraction failed: ${message}]`,
      pageCount: state.pageCount,
    };
  }
}

function normalizeWrite(ref: PluginNodeRef, input: PluginNodeWriteInput): PluginNodePatch {
  const current = stateFromRef(ref);
  const patch = isRecord(input.payload) ? input.payload : {};
  const next = normalizePdfPayload({
    ...current,
    ...patch,
    source: 'source' in patch ? normalizePdfSource(patch.source) : current.source,
  });
  return {
    title: typeof input.title === 'string' && input.title.trim() ? input.title.trim() : undefined,
    data: input.data,
    ...pdfPatchFromState(next),
  };
}

export function registerPdfNode(ctx: MainCtx, deps: PdfNodeDeps = createDefaultPdfDeps()): void {
  ctx.registerNodeCapabilities(PDF_DOCUMENT_NODE_TYPE, {
    async read(ref) {
      const state = stateFromRef(ref);
      const excerpt = await readExcerpt(deps, state);
      const summary = summarizePdf({
        ...state,
        pageCount: excerpt.pageCount ?? state.pageCount,
      });
      return {
        summary,
        content: excerpt.content,
        payload: { ...state, pageCount: excerpt.pageCount ?? state.pageCount },
        availableActions: PDF_ACTIONS,
      };
    },

    write(ref, input) {
      return normalizeWrite(ref, input);
    },

    actions: {
      async set_source(ref, input): Promise<PluginNodeActionResult> {
        const path = typeof input.path === 'string' ? input.path.trim() : '';
        if (!path) return { result: { ok: false, error: 'path is required' } };
        if (!/\.pdf$/i.test(path)) {
          return { result: { ok: false, error: 'path must point to a .pdf file' } };
        }
        let probed;
        try {
          probed = await probeSource(deps, path);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { result: { ok: false, error: message } };
        }
        const current = stateFromRef(ref);
        const title = typeof input.title === 'string' && input.title.trim()
          ? input.title.trim()
          : current.title || probed.source.name;
        const next: PdfDocumentState = {
          title,
          source: probed.source,
          pageCount: probed.pageCount,
          currentPage: 1,
        };
        return {
          patch: {
            title,
            ...pdfPatchFromState(next),
          },
          result: {
            ok: true,
            summary: summarizePdf(next),
            probeError: probed.error,
          },
        };
      },

      async extract_text(ref, input): Promise<PluginNodeActionResult> {
        const state = stateFromRef(ref);
        if (!state.source) {
          return { result: { ok: false, error: 'No PDF attached. Run set_source first.' } };
        }
        const maxChars = typeof input.maxChars === 'number' && Number.isFinite(input.maxChars)
          ? Math.min(Math.max(Math.floor(input.maxChars), EXTRACT_MIN_MAX_CHARS), EXTRACT_MAX_MAX_CHARS)
          : EXTRACT_DEFAULT_MAX_CHARS;
        try {
          const { pageCount } = await deps.extractor.probe(state.source.path);
          const selection = parsePdfPageSelection(input.pages, pageCount);
          if (selection && selection.length === 0) {
            return {
              result: {
                ok: false,
                error: `No valid pages in selection (document has ${pageCount} pages).`,
              },
            };
          }
          const extraction = await deps.extractor.extract(
            state.source.path,
            selection ?? undefined,
          );
          const formatted = formatPdfPages(extraction.pages, maxChars);
          return {
            result: {
              ok: true,
              pageCount,
              pages: extraction.pages.map((page) => page.page),
              text: formatted.text,
              truncated: formatted.truncated,
            },
          };
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return { result: { ok: false, error: message } };
        }
      },

      go_to_page(ref, input): PluginNodeActionResult {
        const state = stateFromRef(ref);
        if (!state.source) {
          return { result: { ok: false, error: 'No PDF attached. Run set_source first.' } };
        }
        if (typeof input.page !== 'number' || !Number.isFinite(input.page)) {
          return { result: { ok: false, error: 'page must be a number' } };
        }
        const currentPage = clampPdfPage(input.page, state.pageCount);
        const next = { ...state, currentPage };
        return {
          patch: pdfPatchFromState(next),
          result: { ok: true, currentPage, pageCount: state.pageCount },
        };
      },

      summarize(ref): PluginNodeActionResult {
        const state = stateFromRef(ref);
        return {
          result: { ok: true, summary: summarizePdf(state) },
        };
      },
    },
  });

  ctx.handle?.(PDF_PICK_FILE_CHANNEL, async () => {
    const picked = await deps.pickPdfFile();
    if (picked.canceled || !picked.path) return { ok: false, canceled: true };
    try {
      const probed = await probeSource(deps, picked.path);
      return {
        ok: true,
        source: probed.source,
        pageCount: probed.pageCount,
        probeError: probed.error,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { ok: false, error: message };
    }
  });
}
