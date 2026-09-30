import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createCanvasMcpServer, MCP_PLUGIN_API_VERSION } from '../server';
import { CANVAS_APP_RESOURCE_URI } from '../tools';
import { MCP_APP_MIME_TYPE } from '../resource';
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
  it('declares the MCP App entrypoint and hides view-only tools from the model', async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    const open = tools.find(tool => tool.name === 'canvas_open');
    expect(open?._meta?.ui).toEqual({ resourceUri: CANVAS_APP_RESOURCE_URI });
    expect(open?._meta?.['openai/ui']).toMatchObject({
      entrypoints: [{ type: 'global' }],
      preferredDisplayMode: 'fullscreen',
    });
    for (const name of ['canvas_ui_snapshot', 'canvas_ui_version']) {
      expect(tools.find(tool => tool.name === name)?._meta?.ui).toEqual({ visibility: ['app'] });
    }
    expect(tools.find(tool => tool.name === 'canvas_apply')?.annotations?.readOnlyHint).toBe(false);
  });

  it('serves the view as an MCP App resource', async () => {
    const client = await connect();
    const { resources } = await client.listResources();
    expect(resources.map(resource => resource.uri)).toEqual([CANVAS_APP_RESOURCE_URI]);
    const read = await client.readResource({ uri: CANVAS_APP_RESOURCE_URI });
    expect(read.contents[0].mimeType).toBe(MCP_APP_MIME_TYPE);
    expect(String(read.contents[0].text)).toContain('<html');
  });

  it('opens the active workspace with {} and falls back to a picker without one', async () => {
    await seed([node('a', 'text', { content: 'hello' }), node('b', 'frame', { label: 'Frame' })], false);
    const client = await connect();
    const picker = await client.callTool({ name: 'canvas_open', arguments: {} });
    expect(picker.isError).toBeFalsy();
    expect(picker.structuredContent).toMatchObject({ workspaceId: null, workspaces: [{ id: wsId, name: 'Research' }] });

    await seed([node('a', 'text', { content: 'hello' }), node('b', 'frame', { label: 'Frame' })]);
    const opened = await client.callTool({ name: 'canvas_open', arguments: {} });
    expect(opened.structuredContent).toMatchObject({ workspaceId: wsId, workspaceName: 'Research', nodeCount: 2, edgeCount: 1 });
  });

  it('projects a render snapshot with explicit edit modes and no heavy fields', async () => {
    const wsDir = await seed([
      node('a', 'file', { filePath: 'placeholder', content: 'stale' }),
      node('b', 'iframe', { url: 'https://example.com', html: '<script>big</script>' }),
      node('c', 'mindmap', { root: { id: 'r', text: 'Root', children: [{ id: 'k', text: 'Kid', children: [] }] } }),
      node('d', 'file', { filePath: '/etc/hosts', content: 'inline only' }),
    ]);
    const notePath = join(wsDir, 'notes', 'a.md');
    await fs.mkdir(join(wsDir, 'notes'), { recursive: true });
    await fs.writeFile(notePath, '# From disk');
    const canvasPath = join(wsDir, 'canvas.json');
    const raw = JSON.parse(await fs.readFile(canvasPath, 'utf-8'));
    raw.nodes[0].data.filePath = notePath;
    await fs.writeFile(canvasPath, JSON.stringify(raw));

    const client = await connect();
    const result = await client.callTool({ name: 'canvas_ui_snapshot', arguments: { workspaceId: wsId } });
    const snapshot = (result.structuredContent as { snapshot: { nodes: Array<Record<string, unknown>>; edges: unknown[] } }).snapshot;
    const byId = Object.fromEntries(snapshot.nodes.map(entry => [entry.id, entry]));
    expect(byId.a).toMatchObject({ content: '# From disk', editable: 'content', meta: 'a.md' });
    expect(byId.b).toMatchObject({ editable: 'none', meta: 'https://example.com' });
    expect(JSON.stringify(byId.b)).not.toContain('<script>');
    expect(byId.c.outline).toBe('- Root\n  - Kid');
    // Outside the workspace dir: disk is never read and the node is not editable.
    expect(byId.d).toMatchObject({ content: 'inline only', editable: 'none' });
    expect(snapshot.edges).toHaveLength(1);
  });

  it('applies view edits atomically and reports a new version', async () => {
    await seed([node('a', 'text', { content: 'hello' }), node('b', 'frame', { label: 'Frame' })]);
    const client = await connect();
    const before = await client.callTool({ name: 'canvas_ui_version', arguments: { workspaceId: wsId } });
    const applied = await client.callTool({
      name: 'canvas_apply',
      arguments: {
        workspaceId: wsId,
        operations: [
          { action: 'update', id: 'a', x: 40, y: 50, content: 'edited' },
          { action: 'update', id: 'b', content: JSON.stringify({ label: 'Renamed' }) },
          { action: 'deleteEdge', id: 'e1' },
          // The view's own frame create + label patch, as coalesced.
          { action: 'create', type: 'frame', id: 'node-view-1', title: 'Frame', x: 0, y: 0, data: { label: 'Frame' } },
          { action: 'update', id: 'node-view-1', content: JSON.stringify({ label: 'Plan' }) },
        ],
      },
    });
    expect(applied.isError).toBeFalsy();
    const report = applied.structuredContent as { updated: string[]; created: string[]; version: string };
    expect(report.created).toEqual(['node-view-1']);
    expect(report.updated).toEqual(['a', 'b', 'node-view-1']);
    expect(report.version).not.toBe((before.structuredContent as { version: string }).version);

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
