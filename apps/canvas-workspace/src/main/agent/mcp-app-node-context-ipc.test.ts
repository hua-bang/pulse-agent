import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ handlers: new Map<string, Function>(), loadCanvas: vi.fn() }));
vi.mock('electron', () => ({ ipcMain: { handle: (name: string, handler: Function) => mocks.handlers.set(name, handler) } }));
vi.mock('../canvas/service', () => ({ loadCanvas: mocks.loadCanvas }));
import { setupMcpAppNodeContextIpc } from './mcp-app-node-context-ipc';
import { getMcpAppNodeContextStore } from './mcp-app-node-context';
import { McpAppNodeMainPlugin } from '../../plugins/main/mcp-app-node';

const target = {
  workspaceId: 'ws-1', nodeId: 'n1', serverName: 'bits-and-bolts',
  toolName: 'cad.library', resourceUri: 'ui://bits/app',
};
const node = {
  id: 'n1', type: 'plugin', data: {
    pluginId: 'mcp-apps', nodeType: 'mcp-app', payload: { ...target, title: 'Bits & Bolts', kind: 'global' },
  },
};
const event = { sender: { id: 101, isDestroyed: () => false, once: vi.fn() } };

describe('MCP App node context IPC to semantic node reads', () => {
  beforeEach(() => {
    mocks.handlers.clear();
    event.sender.once.mockClear();
    getMcpAppNodeContextStore().clearSender(101);
    mocks.loadCanvas.mockResolvedValue({ nodes: [node] });
    setupMcpAppNodeContextIpc();
  });

  it('makes the displayed library content available to canvas_read_node through the plugin capability', async () => {
    const opened = await mocks.handlers.get('canvas-agent:mcp-app-context-open')!(event, target);
    expect(opened.ok).toBe(true);
    const update = mocks.handlers.get('canvas-agent:mcp-app-context-update')!;
    expect(update(event, { token: opened.token, source: 'visible-ui', context: {
      content: [{ type: 'text', text: 'Parts Library\nTranslucent agent keycap (1U)\nCodex Micro sculpted dial' }],
    } })).toEqual({ ok: true });
    const registerNodeCapabilities = vi.fn();
    void McpAppNodeMainPlugin.activate({ registerNodeCapabilities } as never);
    const read = registerNodeCapabilities.mock.calls[0][1].read;
    expect(read({ workspaceId: 'ws-1', node }).content).toContain('Translucent agent keycap');
    expect(read({ workspaceId: 'ws-2', node }).content).not.toContain('Translucent agent keycap');
    expect(read({ workspaceId: 'ws-1', node }).content).toContain('untrusted data');
    const content = read({ workspaceId: 'ws-1', node }).content;
    expect(content.indexOf('Translucent agent keycap')).toBeLessThan(content.indexOf('If specific information is missing'));
    expect(content).toContain('respond directly without additional tool calls');
    expect(content).toContain('do not call it merely to read or summarize this existing node');
    event.sender.once.mock.calls[0][1]();
    expect(read({ workspaceId: 'ws-1', node }).content).toContain('No live App view context');
  });

  it('rejects publications for another app binding, missing nodes, and closed renderers', async () => {
    const open = mocks.handlers.get('canvas-agent:mcp-app-context-open')!;
    expect((await open(event, { ...target, serverName: 'tldraw' })).ok).toBe(false);
    expect(await open(event, { ...target, nodeId: 'missing' })).toMatchObject({ ok: false, code: 'node-not-persisted' });
    expect((await open({ sender: { ...event.sender, isDestroyed: () => true } }, target)).ok).toBe(false);
    expect((await open(event, null)).ok).toBe(false);
  });

  it('rejects a slow older mount when a new mount finishes first', async () => {
    let resolveOld!: (value: unknown) => void;
    mocks.loadCanvas.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }));
    const open = mocks.handlers.get('canvas-agent:mcp-app-context-open')!;
    const old = open(event, target);
    const current = await open(event, target);
    resolveOld({ nodes: [node] });
    expect(await old).toMatchObject({ ok: false, error: expect.stringContaining('replaced') });
    expect(mocks.handlers.get('canvas-agent:mcp-app-context-update')!(event, {
      token: current.token, source: 'visible-ui', context: { content: [{ type: 'text', text: 'current' }] },
    })).toEqual({ ok: true });
  });
});
