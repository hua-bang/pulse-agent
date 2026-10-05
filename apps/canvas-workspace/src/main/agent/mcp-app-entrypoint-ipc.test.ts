import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, payload: any) => Promise<any>>(),
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: any, payload: any) => Promise<any>) => {
      electron.handlers.set(channel, handler);
    },
  },
}));

import { setupMcpAppIpc } from './mcp-app-ipc';

const library = {
  serverName: 'cad',
  toolName: 'cad.library',
  registeredToolName: 'mcp_cad_cad_library',
  resourceUri: 'ui://cad/app',
  title: 'Bits & Bolts',
  entrypoints: [{ namespace: 'openai/ui', type: 'global', options: {} }],
};
const board = {
  serverName: 'acme',
  toolName: 'board',
  registeredToolName: 'mcp_acme_board',
  resourceUri: 'ui://acme/board',
  entrypoints: [
    { namespace: 'openai/ui', type: 'thread', options: {} },
    { namespace: 'pulse/ui', type: 'node', options: { nodeType: 'acme.board', title: 'Board', defaultSize: [9000, 100] } },
  ],
};
const inlineOnly = {
  serverName: 'acme',
  toolName: 'search',
  registeredToolName: 'mcp_acme_search',
  resourceUri: 'ui://acme/search',
};
const libraryTray = {
  ...library,
  toolName: 'cad.tray',
  registeredToolName: 'mcp_cad_cad_tray',
  entrypoints: [{ namespace: 'openai/ui', type: 'thread', options: {} }],
};
// A config key with a space and slash, declaring both a Pulse node and a global app.
const studio = {
  serverName: 'my tools/v2',
  toolName: 'studio',
  registeredToolName: 'mcp_my_tools_v2_studio',
  resourceUri: 'ui://tools/studio',
  title: 'Studio',
  entrypoints: [
    { namespace: 'openai/ui', type: 'global', options: {} },
    { namespace: 'pulse/ui', type: 'node', options: { nodeType: 'tools.studio' } },
  ],
};
const apps = [library, libraryTray, board, inlineOnly, studio];

describe('MCP App entrypoint IPC', () => {
  const executeMcpAppTool = vi.fn(async () => ({ content: [], structuredContent: { page: 'library' } }));
  const manager = {
    listToolApps: () => apps,
    getRegisteredToolName: (server: string, tool: string) => apps.find(
      app => app.serverName === server && app.toolName === tool,
    )?.registeredToolName,
    getToolApp: (name: string) => apps.find(app => app.registeredToolName === name),
  };
  const service = {
    activateScope: vi.fn(async () => undefined),
    getAgentForScope: () => ({ getMcpAppsManager: () => manager, executeMcpAppTool }),
  };
  const event = { sender: { id: 5, once: vi.fn() } };
  const scope = { kind: 'workspace', workspaceId: 'ws-1' };

  beforeEach(() => {
    electron.handlers.clear();
    executeMcpAppTool.mockClear();
    setupMcpAppIpc(service as never);
  });

  it('lists one entrypoint per app, preferring Pulse node and dropping duplicate thread tabs', async () => {
    const list = electron.handlers.get('canvas-agent:mcp-app-list-entrypoints')!;
    await expect(list(event, { scope })).resolves.toEqual({
      ok: true,
      value: [
        {
          serverName: 'cad',
          toolName: 'cad.library',
          resourceUri: 'ui://cad/app',
          title: 'Bits & Bolts',
          kind: 'global',
        },
        {
          serverName: 'acme',
          toolName: 'board',
          resourceUri: 'ui://acme/board',
          title: 'Board',
          kind: 'node',
          nodeType: 'acme.board',
          defaultSize: { width: 2000, height: 200 },
        },
        {
          serverName: 'my tools/v2',
          toolName: 'studio',
          resourceUri: 'ui://tools/studio',
          title: 'Studio',
          kind: 'node',
          nodeType: 'tools.studio',
        },
      ],
    });
  });

  it('lists every entrypoint of a requested kind, even behind a preferred node entrypoint', async () => {
    const list = electron.handlers.get('canvas-agent:mcp-app-list-entrypoints')!;
    const result = await list(event, { scope, kind: 'global' });
    expect(result.value.map((item: { toolName: string; kind: string }) => [item.toolName, item.kind])).toEqual([
      ['cad.library', 'global'],
      ['studio', 'global'],
    ]);
  });

  it('opens entrypoints of servers whose config key has spaces or slashes', async () => {
    const open = electron.handlers.get('canvas-agent:mcp-app-open-entrypoint')!;
    await expect(open(event, { scope, serverName: 'my tools/v2', toolName: 'studio' }))
      .resolves.toMatchObject({ ok: true });
    await expect(open(event, { scope, serverName: 'bad\nname', toolName: 'studio' }))
      .resolves.toMatchObject({ ok: false });
  });

  it('opens a declared entrypoint with {} and no approval prompt', async () => {
    const open = electron.handlers.get('canvas-agent:mcp-app-open-entrypoint')!;
    const result = await open(event, { scope, serverName: 'cad', toolName: 'cad.library' });

    expect(result).toEqual({ ok: true, value: { content: [], structuredContent: { page: 'library' } } });
    expect(executeMcpAppTool).toHaveBeenCalledWith('mcp_cad_cad_library', {}, expect.any(AbortSignal));
  });

  it('refuses tools without an entrypoint so the approval path cannot be bypassed', async () => {
    const open = electron.handlers.get('canvas-agent:mcp-app-open-entrypoint')!;

    await expect(open(event, { scope, serverName: 'acme', toolName: 'search' })).resolves.toEqual({
      ok: false,
      error: 'MCP App entrypoint is not available',
    });
    await expect(open(event, { scope, serverName: 'acme', toolName: 'missing' })).resolves.toMatchObject({ ok: false });
    expect(executeMcpAppTool).not.toHaveBeenCalled();
  });
});
