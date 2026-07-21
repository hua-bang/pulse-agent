import { describe, expect, it } from 'vitest';
import { PDF_DOCUMENT_NODE_TYPE, PDF_PICK_FILE_CHANNEL, CANVAS_NODES_PLUGIN_ID } from '../constants';
import { registerPdfNode, type PdfNodeDeps } from '../pdf-main';
import type {
  CanvasNode,
  MainCtx,
  PluginIpcHandler,
  PluginNodeCapabilities,
} from '../types';

function createCtx() {
  const registrations: Array<{ nodeType: string; capabilities: PluginNodeCapabilities }> = [];
  const handlers = new Map<string, PluginIpcHandler>();
  const ctx: MainCtx = {
    registerNodeCapabilities(nodeType, capabilities) {
      registrations.push({ nodeType, capabilities });
    },
    registerCanvasTool() {},
    handle(channel, handler) {
      handlers.set(channel, handler);
    },
  };
  return { ctx, registrations, handlers };
}

function createDeps(overrides: Partial<PdfNodeDeps> = {}): PdfNodeDeps {
  return {
    extractor: {
      async probe() {
        return { pageCount: 3 };
      },
      async extract(_path, pages) {
        const targets = pages ?? [1, 2, 3];
        return {
          pageCount: 3,
          pages: targets.map((page) => ({ page, text: `Text of page ${page}` })),
        };
      },
    },
    async statFile() {
      return { size: 1234, isFile: true };
    },
    async pickPdfFile() {
      return { canceled: false, path: '/tmp/picked.pdf' };
    },
    ...overrides,
  };
}

function createNode(payload: Record<string, unknown> = {}): CanvasNode {
  return {
    id: 'node-1',
    type: 'plugin',
    title: 'PDF',
    x: 0,
    y: 0,
    width: 640,
    height: 420,
    data: {
      pluginId: CANVAS_NODES_PLUGIN_ID,
      nodeType: PDF_DOCUMENT_NODE_TYPE,
      payload,
    },
  };
}

const ATTACHED = {
  source: { path: '/tmp/spec.pdf', name: 'spec.pdf' },
  pageCount: 3,
  currentPage: 1,
};

function setup(overrides: Partial<PdfNodeDeps> = {}) {
  const { ctx, registrations, handlers } = createCtx();
  registerPdfNode(ctx, createDeps(overrides));
  return { capabilities: registrations[0].capabilities, registrations, handlers };
}

describe('pdf main capabilities', () => {
  it('registers the pdf.document node type and the pick-file channel', () => {
    const { registrations, handlers } = setup();
    expect(registrations[0].nodeType).toBe(PDF_DOCUMENT_NODE_TYPE);
    expect(handlers.has(PDF_PICK_FILE_CHANNEL)).toBe(true);
  });

  it('reads guidance content when no source is attached', async () => {
    const { capabilities } = setup();
    const read = await capabilities.read?.({ workspaceId: 'ws', node: createNode() }) as any;
    expect(read.summary.hasSource).toBe(false);
    expect(read.content).toContain('set_source');
    expect(read.availableActions).toContain('extract_text');
  });

  it('reads an extracted excerpt when a source is attached', async () => {
    const { capabilities } = setup();
    const read = await capabilities.read?.({
      workspaceId: 'ws',
      node: createNode(ATTACHED),
    }) as any;
    expect(read.summary.pageCount).toBe(3);
    expect(read.content).toContain('[Page 1]\nText of page 1');
    expect(read.content).toContain('[Page 3]');
  });

  it('limits the read excerpt for large documents', async () => {
    const extracted: number[][] = [];
    const { capabilities } = setup({
      extractor: {
        async probe() {
          return { pageCount: 80 };
        },
        async extract(_path, pages) {
          extracted.push(pages ?? []);
          const targets = pages ?? [];
          return {
            pageCount: 80,
            pages: targets.map((page) => ({ page, text: `p${page}` })),
          };
        },
      },
    });
    const read = await capabilities.read?.({
      workspaceId: 'ws',
      node: createNode(ATTACHED),
    }) as any;
    expect(extracted[0]).toHaveLength(10);
    expect(read.content).toContain('pages 1-10 of 80');
  });

  it('survives extraction failures in read', async () => {
    const { capabilities } = setup({
      extractor: {
        async probe() {
          throw new Error('broken file');
        },
        async extract() {
          throw new Error('broken file');
        },
      },
    });
    const read = await capabilities.read?.({
      workspaceId: 'ws',
      node: createNode(ATTACHED),
    }) as any;
    expect(read.content).toContain('extraction failed');
    expect(read.content).toContain('broken file');
  });

  it('set_source validates the path and probes the page count', async () => {
    const { capabilities } = setup();
    const missing = await capabilities.actions?.set_source(
      { workspaceId: 'ws', node: createNode() },
      {},
    ) as any;
    expect(missing.result.ok).toBe(false);

    const notPdf = await capabilities.actions?.set_source(
      { workspaceId: 'ws', node: createNode() },
      { path: '/tmp/file.txt' },
    ) as any;
    expect(notPdf.result.ok).toBe(false);

    const ok = await capabilities.actions?.set_source(
      { workspaceId: 'ws', node: createNode() },
      { path: '/tmp/spec.pdf' },
    ) as any;
    expect(ok.result.ok).toBe(true);
    expect(ok.patch.title).toBe('spec.pdf');
    expect(ok.patch.payload.pageCount).toBe(3);
    expect(ok.patch.payload.currentPage).toBe(1);
    expect(ok.patch.payload.source.path).toBe('/tmp/spec.pdf');
  });

  it('set_source reports stat failures as action errors', async () => {
    const { capabilities } = setup({
      async statFile() {
        throw new Error('ENOENT: no such file');
      },
    });
    const result = await capabilities.actions?.set_source(
      { workspaceId: 'ws', node: createNode() },
      { path: '/tmp/missing.pdf' },
    ) as any;
    expect(result.result.ok).toBe(false);
    expect(result.result.error).toContain('ENOENT');
  });

  it('extract_text honors page selections and truncation', async () => {
    const { capabilities } = setup();
    const ref = { workspaceId: 'ws', node: createNode(ATTACHED) };

    const selected = await capabilities.actions?.extract_text(ref, { pages: '1-2' }) as any;
    expect(selected.result.ok).toBe(true);
    expect(selected.result.pages).toEqual([1, 2]);
    expect(selected.result.text).toContain('[Page 2]');

    const invalid = await capabilities.actions?.extract_text(ref, { pages: '99' }) as any;
    expect(invalid.result.ok).toBe(false);

    const detached = await capabilities.actions?.extract_text(
      { workspaceId: 'ws', node: createNode() },
      {},
    ) as any;
    expect(detached.result.ok).toBe(false);
  });

  it('extract_text clamps maxChars and reports truncation', async () => {
    const { capabilities } = setup({
      extractor: {
        async probe() {
          return { pageCount: 1 };
        },
        async extract() {
          return { pageCount: 1, pages: [{ page: 1, text: 'x'.repeat(2000) }] };
        },
      },
    });
    const ref = { workspaceId: 'ws', node: createNode(ATTACHED) };
    const truncated = await capabilities.actions?.extract_text(ref, { maxChars: 1 }) as any;
    expect(truncated.result.truncated).toBe(true);
    expect(truncated.result.text.length).toBe(500);
  });

  it('go_to_page clamps into the page range and patches currentPage', async () => {
    const { capabilities } = setup();
    const ref = { workspaceId: 'ws', node: createNode(ATTACHED) };

    const ok = await capabilities.actions?.go_to_page(ref, { page: 99 }) as any;
    expect(ok.result.currentPage).toBe(3);
    expect(ok.patch.payload.currentPage).toBe(3);

    const bad = await capabilities.actions?.go_to_page(ref, {}) as any;
    expect(bad.result.ok).toBe(false);
  });

  it('write merges payload patches without dropping the source', async () => {
    const { capabilities } = setup();
    const patch = await capabilities.write?.(
      { workspaceId: 'ws', node: createNode(ATTACHED) },
      { title: 'Renamed', payload: { currentPage: 2 } },
    ) as any;
    expect(patch.title).toBe('Renamed');
    expect(patch.payload.currentPage).toBe(2);
    expect(patch.payload.source.path).toBe('/tmp/spec.pdf');
  });

  it('pick-file handler returns the probed source', async () => {
    const { handlers } = setup();
    const handler = handlers.get(PDF_PICK_FILE_CHANNEL)!;
    const result = await handler({ sender: null, frameId: 0 }) as any;
    expect(result.ok).toBe(true);
    expect(result.source.name).toBe('picked.pdf');
    expect(result.pageCount).toBe(3);
  });

  it('pick-file handler reports cancellation', async () => {
    const { handlers } = setup({
      async pickPdfFile() {
        return { canceled: true };
      },
    });
    const handler = handlers.get(PDF_PICK_FILE_CHANNEL)!;
    const result = await handler({ sender: null, frameId: 0 }) as any;
    expect(result).toEqual({ ok: false, canceled: true });
  });
});
