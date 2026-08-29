import { beforeEach, describe, expect, it, vi } from 'vitest';

const electron = vi.hoisted(() => ({
  handlers: new Map<string, (event: any, payload: any) => Promise<any>>(),
  showMessageBox: vi.fn(),
}));

vi.mock('electron', () => ({
  BrowserWindow: { fromWebContents: () => null },
  dialog: { showMessageBox: electron.showMessageBox },
  ipcMain: {
    handle: (channel: string, handler: (event: any, payload: any) => Promise<any>) => {
      electron.handlers.set(channel, handler);
    },
  },
}));

import { setupMcpAppIpc } from './mcp-app-ipc';

describe('MCP App IPC approvals', () => {
  const executeMcpAppTool = vi.fn(async () => ({ ok: true }));
  const manager = {
    getRegisteredToolName: () => 'mcp_cowart_save',
  };
  const service = {
    activateScope: vi.fn(async () => undefined),
    getAgentForScope: () => ({ getMcpAppsManager: () => manager, executeMcpAppTool }),
  };

  beforeEach(() => {
    electron.handlers.clear();
    electron.showMessageBox.mockReset();
    executeMcpAppTool.mockClear();
    setupMcpAppIpc(service as never);
  });

  it('uses one checked approval for repeated calls to the same server and scope', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: true });
    const destroyed = vi.fn();
    const event = { sender: { id: 71, once: destroyed } };
    const callTool = electron.handlers.get('canvas-agent:mcp-app-call-tool')!;
    const payload = {
      scope: { kind: 'workspace', workspaceId: 'ws-1' },
      serverName: 'cowart.cowart_mcp',
      toolName: 'save_cowart_view_state',
      arguments: { version: 1 },
    };

    expect((await callTool(event, payload)).ok).toBe(true);
    expect((await callTool(event, { ...payload, toolName: 'save_cowart_canvas_state' })).ok).toBe(true);

    expect(electron.showMessageBox).toHaveBeenCalledTimes(1);
    expect(electron.showMessageBox.mock.calls[0][0]).toMatchObject({
      checkboxLabel: expect.stringContaining('cowart.cowart_mcp'),
      checkboxChecked: false,
    });
    expect(executeMcpAppTool).toHaveBeenCalledTimes(2);
    expect(destroyed).toHaveBeenCalledWith('destroyed', expect.any(Function));
  });

  it('does not reuse a server grant across agent scopes', async () => {
    electron.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: true });
    const event = { sender: { id: 72, once: vi.fn() } };
    const callTool = electron.handlers.get('canvas-agent:mcp-app-call-tool')!;

    await callTool(event, {
      scope: { kind: 'workspace', workspaceId: 'ws-1' },
      serverName: 'cowart.cowart_mcp', toolName: 'save', arguments: {},
    });
    await callTool(event, {
      scope: { kind: 'workspace', workspaceId: 'ws-2' },
      serverName: 'cowart.cowart_mcp', toolName: 'save', arguments: {},
    });

    expect(electron.showMessageBox).toHaveBeenCalledTimes(2);
  });
});
