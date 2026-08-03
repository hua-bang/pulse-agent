import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

// The shipped extension imports `typebox` from pi's own runtime; stub the
// tiny surface it uses so the module loads inside our test process.
vi.mock('typebox', () => ({
  Type: {
    Object: (properties: Record<string, unknown>) => ({ type: 'object', properties }),
    Optional: (schema: unknown) => schema,
    String: (options: Record<string, unknown> = {}) => ({ type: 'string', ...options }),
    Integer: (options: Record<string, unknown> = {}) => ({ type: 'integer', ...options }),
    Union: (schemas: unknown[]) => ({ anyOf: schemas }),
    Literal: (value: unknown) => ({ const: value }),
  },
}));

import piExtension, {
  callCapability,
  createManifestTools,
  createPulseCanvasTools,
  readPiToolManifest,
  readRuntimeInfo,
} from '../../../../resources/pi-extension/pulse-canvas';

let dir: string;
let runtimeFile: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'pi-ext-'));
  runtimeFile = join(dir, 'canvas-workspace.json');
  writeFileSync(runtimeFile, JSON.stringify({
    pid: 1, baseUrl: 'http://127.0.0.1:45678', secret: 's3cret', createdAt: 't',
  }));
});

afterEach(() => {
  delete process.env.PULSE_CANVAS_WORKSPACE_ID;
  delete process.env.PULSE_CANVAS_PI_TOOL_MANIFEST;
  delete process.env.PULSE_CANVAS_PI_TOOL_BRIDGE_ID;
  delete process.env.PULSE_CANVAS_PI_TOOL_BRIDGE_SECRET;
  delete process.env.PULSE_CANVAS_RUNTIME_FILE;
  rmSync(dir, { recursive: true, force: true });
});

describe('runtime discovery', () => {
  it('reads baseUrl + secret from the runtime file', () => {
    expect(readRuntimeInfo(runtimeFile)).toEqual({
      baseUrl: 'http://127.0.0.1:45678',
      secret: 's3cret',
    });
  });

  it('explains that the app is not running when the file is missing', () => {
    expect(() => readRuntimeInfo(join(dir, 'nope.json')))
      .toThrow(/not running/);
  });
});

describe('capability HTTP client', () => {
  it('POSTs /capabilities/call with the bearer secret and unwraps ok values', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, value: { nodeCount: 3 } }),
    });
    const value = await callCapability({
      name: 'canvas.context.read',
      workspaceId: 'ws-1',
      input: { scope: 'summary' },
      runtimeFile,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(value).toEqual({ nodeCount: 3 });
    expect(fetchImpl).toHaveBeenCalledWith('http://127.0.0.1:45678/capabilities/call', {
      method: 'POST',
      headers: {
        authorization: 'Bearer s3cret',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        workspaceId: 'ws-1',
        name: 'canvas.context.read',
        input: { scope: 'summary' },
      }),
    });
  });

  it('throws the capability error message on ok:false', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 403,
      json: async () => ({ ok: false, error: { code: 'capability_forbidden', message: 'nope' } }),
    });
    await expect(callCapability({
      name: 'canvas.nodes.update',
      workspaceId: 'ws-1',
      input: {},
      runtimeFile,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    })).rejects.toThrow('canvas.nodes.update: nope');
  });
});

describe('tool registration and execution', () => {
  it('registers the four canvas bridge tools with pi', () => {
    process.env.PULSE_CANVAS_WORKSPACE_ID = 'ws-env';
    const registered: Array<{ name: string }> = [];
    piExtension({ registerTool: (tool) => registered.push(tool as { name: string }) });
    expect(registered.map(tool => tool.name)).toEqual([
      'canvas_context_read',
      'canvas_node_read',
      'canvas_nodes_search',
      'canvas_node_update',
    ]);
  });

  it('registers the engine-generated manifest instead of the fixed subset', () => {
    const manifestPath = join(dir, 'tools.json');
    writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      tools: [
        {
          name: 'canvas_create_node',
          label: 'Create node',
          description: 'Create one node.',
          parameters: { type: 'object', properties: { title: { type: 'string' } } },
        },
        {
          name: 'memory_save',
          label: 'Save memory',
          description: 'Save memory.',
          parameters: { type: 'object', properties: { content: { type: 'string' } } },
        },
      ],
    }));
    process.env.PULSE_CANVAS_PI_TOOL_MANIFEST = manifestPath;
    process.env.PULSE_CANVAS_PI_TOOL_BRIDGE_ID = 'bridge-1';
    process.env.PULSE_CANVAS_PI_TOOL_BRIDGE_SECRET = 'secret-1';
    const registered: Array<{ name: string }> = [];

    piExtension({ registerTool: (tool) => registered.push(tool as { name: string }) });

    expect(readPiToolManifest(manifestPath).tools).toHaveLength(2);
    expect(createManifestTools(manifestPath, 'bridge-1').map(tool => tool.name)).toEqual([
      'canvas_create_node',
      'memory_save',
    ]);
    expect(registered.map(tool => tool.name)).toEqual(['canvas_create_node', 'memory_save']);
    delete process.env.PULSE_CANVAS_PI_TOOL_MANIFEST;
    delete process.env.PULSE_CANVAS_PI_TOOL_BRIDGE_ID;
    delete process.env.PULSE_CANVAS_PI_TOOL_BRIDGE_SECRET;
  });

  it('rejects malformed or duplicate manifest tool entries', () => {
    const manifestPath = join(dir, 'bad-tools.json');
    writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      tools: [{ name: 'read' }, { name: 'read', parameters: [] }],
    }));
    expect(() => readPiToolManifest(manifestPath)).toThrow(/duplicate|invalid parameters/i);
  });

  it('registers newly policy-visible tools after tool search', async () => {
    const manifestPath = join(dir, 'search-tools.json');
    writeFileSync(manifestPath, JSON.stringify({
      version: 1,
      tools: [{
        name: 'tool_search_tool_bm25',
        description: 'Search deferred tools.',
        parameters: { type: 'object', properties: { query: { type: 'string' } } },
      }],
    }));
    process.env.PULSE_CANVAS_PI_TOOL_MANIFEST = manifestPath;
    process.env.PULSE_CANVAS_PI_TOOL_BRIDGE_ID = 'bridge-search';
    process.env.PULSE_CANVAS_PI_TOOL_BRIDGE_SECRET = 'secret-search';
    process.env.PULSE_CANVAS_RUNTIME_FILE = runtimeFile;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({
      status: 200,
      json: async () => ({
        ok: true,
        value: { tool_references: [{ tool_name: 'artifact_create' }] },
        tools: [{
          name: 'artifact_create',
          description: 'Create an artifact.',
          parameters: { type: 'object', properties: { title: { type: 'string' } } },
        }, {
          name: 'tool_search_tool_bm25',
          description: 'Search deferred tools.',
          parameters: { type: 'object', properties: { query: { type: 'string' } } },
        }],
        activeToolNames: ['artifact_create'],
      }),
    } as Response);
    const registered: Array<{ name: string; execute: (...args: any[]) => Promise<unknown> }> = [];
    let runtimeReady = false;
    const setActiveTools = vi.fn(() => {
      if (!runtimeReady) throw new Error('Extension runtime not initialized');
    });
    piExtension({
      registerTool: tool => registered.push(tool as typeof registered[number]),
      setActiveTools,
    });

    expect(registered.map(tool => tool.name)).toEqual(['tool_search_tool_bm25']);
    expect(setActiveTools).not.toHaveBeenCalled();
    runtimeReady = true;
    await registered[0].execute('search-1', { query: 'artifact' });
    expect(registered.map(tool => tool.name)).toEqual(['tool_search_tool_bm25', 'artifact_create']);
    expect(setActiveTools).toHaveBeenLastCalledWith(['artifact_create']);
    expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({
      bridgeId: 'bridge-search',
      bridgeSecret: 'secret-search',
    });
    fetchMock.mockRestore();
  });

  it('executes a tool through the bridge and returns text content', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      status: 200,
      json: async () => ({ ok: true, value: { id: 'n-1', title: 'Note' } }),
    });
    const tools = createPulseCanvasTools({
      workspaceId: 'ws-1',
      runtimeFile,
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    const read = tools.find(tool => tool.name === 'canvas_node_read')!;
    const result = await read.execute('call-1', { nodeId: 'n-1' } as never);
    expect(result.content).toEqual([
      { type: 'text', text: JSON.stringify({ id: 'n-1', title: 'Note' }, null, 2) },
    ]);
    const body = JSON.parse((fetchImpl.mock.calls[0][1] as { body: string }).body);
    expect(body).toEqual({ workspaceId: 'ws-1', name: 'canvas.nodes.read', input: { nodeId: 'n-1' } });
  });

  it('fails with a clear message when no workspace is bound', async () => {
    const tools = createPulseCanvasTools({ runtimeFile });
    const context = tools.find(tool => tool.name === 'canvas_context_read')!;
    await expect(context.execute('call-1', {} as never)).rejects.toThrow(/PULSE_CANVAS_WORKSPACE_ID/);
  });
});
