import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCanvasMcpServer, MCP_PLUGIN_API_VERSION } from '../server';
import { NODE_VIEW_RESOURCE_URI } from '../tools';
import { MCP_APP_MIME_TYPE, NODE_VIEW_PATH_ENV } from '../resource';
import { loadCanvas, getWorkspaceDir } from '../../core/store';
import type { CanvasNode } from '../../core/types';

let storeDir: string;
const wsId = 'ws-mcp';

beforeEach(async () => {
  storeDir = join(tmpdir(), `canvas-cli-mcp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`);
  await fs.mkdir(storeDir, { recursive: true });
});

afterEach(async () => {
  await fs.rm(storeDir, { recursive: true, force: true });
});

async function seed(nodes: CanvasNode[], active = true): Promise<string> {
  const wsDir = getWorkspaceDir(wsId, storeDir);
  await fs.mkdir(wsDir, { recursive: true });
  await fs.writeFile(join(wsDir, 'canvas.json'), JSON.stringify({
    nodes,
    edges: [{ id: 'e1', source: { kind: 'node', nodeId: 'a' }, target: { kind: 'node', nodeId: 'b' }, label: 'links' }],
    transform: { x: 0, y: 0, scale: 1 },
    savedAt: '2026-01-01T00:00:00.000Z',
  }));
  await fs.writeFile(join(storeDir, '__workspaces__.json'), JSON.stringify({
    workspaces: [{ id: wsId, name: 'Research' }],
    ...(active ? { activeId: wsId } : {}),
  }));
  return wsDir;
}

function node(id: string, type: string, data: Record<string, unknown>, extra: Partial<CanvasNode> = {}): CanvasNode {
  return { id, type, title: id.toUpperCase(), x: 0, y: 0, width: 200, height: 120, data, ...extra } as CanvasNode;
}

async function connect(pluginApi?: number): Promise<Client> {
  const server = createCanvasMcpServer({ storeDir, env: {}, version: 'test', pluginApi });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  const client = new Client({ name: 'test', version: '1' });
  await client.connect(clientTransport);
  return client;
}

describe('pulse-canvas mcp server', () => {
  it('shows nodes inline through canvas_open and hides view-only tools from the model', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const open = tools.find(tool => tool.name === 'canvas_open');
    expect(open?._meta?.ui).toEqual({ resourceUri: NODE_VIEW_RESOURCE_URI });
    expect(open?._meta?.['openai/ui']).toEqual({
      preferredDisplayMode: 'inline',
      availableDisplayModes: ['inline', 'fullscreen'],
    });
    expect(tools.find(tool => tool.name === 'canvas_ui_node')?._meta?.ui).toEqual({ visibility: ['app'] });
    expect(tools.map(tool => tool.name)).not.toContain('canvas_ui_snapshot');
    expect(tools.find(tool => tool.name === 'canvas_apply')?.annotations?.readOnlyHint).toBe(false);
  });

  it('serves the app-built node view, or a fallback page without one', async () => {
    const viewPath = join(storeDir, 'node-view.html');
    await fs.writeFile(viewPath, '<!doctype html><html><body>app node view</body></html>');
    const previous = process.env[NODE_VIEW_PATH_ENV];
    process.env[NODE_VIEW_PATH_ENV] = viewPath;
    try {
      const client = await connect();
      const { resources } = await client.listResources();
      expect(resources.map(resource => resource.uri)).toEqual([NODE_VIEW_RESOURCE_URI]);
      const read = await client.readResource({ uri: NODE_VIEW_RESOURCE_URI });
      expect(read.contents[0].mimeType).toBe(MCP_APP_MIME_TYPE);
      expect(String(read.contents[0].text)).toContain('app node view');
    } finally {
      if (previous === undefined) delete process.env[NODE_VIEW_PATH_ENV];
      else process.env[NODE_VIEW_PATH_ENV] = previous;
    }
  });

  it('opens a node, or a picker without nodeId', async () => {
    await seed([node('a', 'text', { content: 'hello' }), node('b', 'frame', { label: 'Frame' })]);
    const client = await connect();
    const opened = await client.callTool({ name: 'canvas_open', arguments: { nodeId: 'a' } });
    expect(opened.isError).toBeFalsy();
    expect(opened.structuredContent).toEqual({
      workspaceId: wsId, workspaceName: 'Research', nodeId: 'a', type: 'text', title: 'A',
    });
    const picker = await client.callTool({ name: 'canvas_open', arguments: {} });
    expect(picker.structuredContent).toEqual({ workspaceId: wsId, workspaceName: 'Research', nodeId: null });
    const missing = await client.callTool({ name: 'canvas_open', arguments: { nodeId: 'nope' } });
    expect(missing.structuredContent).toMatchObject({ code: 'node_not_found' });
  });

  it('projects only the fields node bodies render, confined to the workspace', async () => {
    const wsDir = await seed([
      node('a', 'file', { filePath: 'placeholder', content: 'stale' }),
      node('b', 'iframe', { url: 'https://example.com', html: '<script>big</script>' }),
      node('c', 'mindmap', { root: { id: 'r', text: 'Root', children: [] }, layout: 'right', rev: 3, extra: 'x' }),
      node('d', 'file', { filePath: '/etc/hosts', content: 'inline only' }),
      node('e', 'text', { content: '<p>Hi</p>', textColor: '#111', sessionId: 'nope' }),
    ]);
    const notePath = join(wsDir, 'notes', 'a.md');
    await fs.mkdir(join(wsDir, 'notes'), { recursive: true });
    await fs.writeFile(notePath, '# From disk');
    const canvasPath = join(wsDir, 'canvas.json');
    const raw = JSON.parse(await fs.readFile(canvasPath, 'utf-8'));
    raw.nodes[0].data.filePath = notePath;
    await fs.writeFile(canvasPath, JSON.stringify(raw));

    const client = await connect();
    const read = async (nodeId: string) => (await client.callTool({
      name: 'canvas_ui_node', arguments: { workspaceId: wsId, nodeId },
    })).structuredContent as {
      node: { data: Record<string, unknown> };
      version: string;
      workspaceName: string;
      writableFields: string[];
    };

    expect((await read('a')).node.data).toEqual({ content: '# From disk' });
    expect((await read('b')).node.data).toEqual({});
    expect((await read('c')).node.data).toEqual({ root: { id: 'r', text: 'Root', children: [] }, layout: 'right', rev: 3 });
    // Outside the workspace dir: disk is never read and the path never leaves the store.
    expect((await read('d')).node.data).toEqual({ content: 'inline only' });
    const text = await read('e');
    expect(text.node.data).toEqual({ content: '<p>Hi</p>', textColor: '#111' });
    expect(text.writableFields).toEqual(['content', 'textColor', 'backgroundColor', 'fontSize', 'autoSize']);
    expect((await read('a')).writableFields).toEqual([]);
    expect(text.workspaceName).toBe('Research');
    expect(text.version).toMatch(/^[0-9a-f]{40}$/);
  });

  it('persists node view edits as typed data patches and changes the node version', async () => {
    await seed([node('m', 'mindmap', { root: { id: 'r', text: 'Root', children: [] }, layout: 'right', rev: 1 })]);
    const client = await connect();
    const version = async () => ((await client.callTool({
      name: 'canvas_ui_node', arguments: { workspaceId: wsId, nodeId: 'm' },
    })).structuredContent as { version: string }).version;
    const before = await version();
    const applied = await client.callTool({
      name: 'canvas_apply',
      arguments: {
        workspaceId: wsId,
        operations: [{
          action: 'update', id: 'm', width: 500,
          data: { root: { id: 'r', text: 'Root', children: [{ id: 'k', text: 'Kid', children: [] }] }, rev: 2 },
        }],
      },
    });
    expect(applied.isError).toBeFalsy();
    expect(await version()).not.toBe(before);
    const canvas = await loadCanvas(wsId, storeDir);
    expect(canvas?.nodes[0]).toMatchObject({ width: 500, data: { rev: 2, root: { children: [{ id: 'k', text: 'Kid' }] } } });
  });

  it('applies batched node and edge edits atomically', async () => {
    await seed([node('a', 'text', { content: 'hello' }), node('b', 'frame', { label: 'Frame' })]);
    const client = await connect();
    const applied = await client.callTool({
      name: 'canvas_apply',
      arguments: {
        workspaceId: wsId,
        operations: [
          { action: 'update', id: 'a', x: 40, y: 50, content: 'edited' },
          { action: 'update', id: 'b', content: JSON.stringify({ label: 'Renamed' }) },
          { action: 'deleteEdge', id: 'e1' },
          { action: 'create', type: 'frame', id: 'node-view-1', title: 'Frame', x: 0, y: 0, data: { label: 'Frame' } },
          { action: 'update', id: 'node-view-1', content: JSON.stringify({ label: 'Plan' }) },
        ],
      },
    });
    expect(applied.isError).toBeFalsy();
    const report = applied.structuredContent as { updated: string[]; created: string[] };
    expect(report.created).toEqual(['node-view-1']);
    expect(report.updated).toEqual(['a', 'b', 'node-view-1']);

    const canvas = await loadCanvas(wsId, storeDir);
    expect(canvas?.nodes.find(n => n.id === 'a')).toMatchObject({ x: 40, y: 50, data: { content: 'edited' } });
    expect(canvas?.nodes.find(n => n.id === 'b')?.data.label).toBe('Renamed');
    expect(canvas?.nodes.find(n => n.id === 'node-view-1')).toMatchObject({ type: 'frame', data: { label: 'Plan' } });
    expect(canvas?.edges).toEqual([]);
  });

  it('returns structured errors instead of throwing', async () => {
    await seed([node('a', 'text', { content: 'hello' })]);
    const client = await connect();
    const conflict = await client.callTool({
      name: 'canvas_apply',
      arguments: { workspaceId: wsId, baseRevision: 99, operations: [{ action: 'delete', id: 'a' }] },
    });
    expect(conflict.isError).toBe(true);
    expect(conflict.structuredContent).toMatchObject({ ok: false, code: 'revision_conflict' });

    const missing = await client.callTool({ name: 'canvas_context', arguments: { workspaceId: 'nope' } });
    expect(missing.isError).toBe(true);
    expect((missing.structuredContent as { code: string }).code).toMatch(/workspace_/);
  });

  it('degrades to an upgrade notice when the plugin needs a newer API', async () => {
    const client = await connect(MCP_PLUGIN_API_VERSION + 1);
    const { tools } = await client.listTools();
    expect(tools.map(tool => tool.name)).toEqual(['canvas_status']);
    const status = await client.callTool({ name: 'canvas_status', arguments: {} });
    expect(status.structuredContent).toMatchObject({ code: 'plugin_api_unsupported' });
  });
});
