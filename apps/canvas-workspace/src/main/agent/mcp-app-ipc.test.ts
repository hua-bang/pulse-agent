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
    executeMcpAppTool.mockClear();
    setupMcpAppIpc(service as never);
  });

  it('uses one in-app session approval for repeated calls to the same server and scope', async () => {
    const destroyed = vi.fn();
    const event = { sender: { id: 71, once: destroyed } };
    const callTool = electron.handlers.get('canvas-agent:mcp-app-call-tool')!;
    const payload = {
      scope: { kind: 'workspace', workspaceId: 'ws-1' },
      serverName: 'cowart.cowart_mcp',
      toolName: 'save_cowart_view_state',
      arguments: { version: 1 },
    };

    const preflight = await callTool(event, payload);
    expect(preflight).toMatchObject({
      ok: false,
      approval: {
        serverName: 'cowart.cowart_mcp',
        toolName: 'save_cowart_view_state',
        truncated: false,
      },
    });
    expect((await callTool(event, {
      ...payload,
      approval: { requestId: preflight.approval.requestId, decision: 'session' },
    })).ok).toBe(true);
    expect((await callTool(event, { ...payload, toolName: 'save_cowart_canvas_state' })).ok).toBe(true);

    expect(executeMcpAppTool).toHaveBeenCalledTimes(2);
    expect(destroyed).toHaveBeenCalledWith('destroyed', expect.any(Function));
  });

  it('does not reuse a server grant across agent scopes', async () => {
    const event = { sender: { id: 72, once: vi.fn() } };
    const callTool = electron.handlers.get('canvas-agent:mcp-app-call-tool')!;

    const firstPayload = {
      scope: { kind: 'workspace', workspaceId: 'ws-1' },
      serverName: 'cowart.cowart_mcp', toolName: 'save', arguments: {},
    };
    const first = await callTool(event, firstPayload);
    await callTool(event, {
      ...firstPayload,
      approval: { requestId: first.approval.requestId, decision: 'session' },
    });
    const second = await callTool(event, {
      scope: { kind: 'workspace', workspaceId: 'ws-2' },
      serverName: 'cowart.cowart_mcp', toolName: 'save', arguments: {},
    });

    expect(second.approval).toBeDefined();
    expect(executeMcpAppTool).toHaveBeenCalledTimes(1);
  });

  it('binds an approval to the exact arguments shown to the user', async () => {
    const event = { sender: { id: 73, once: vi.fn() } };
    const callTool = electron.handlers.get('canvas-agent:mcp-app-call-tool')!;
    const payload = {
      scope: { kind: 'global' },
      serverName: 'cowart.cowart_mcp', toolName: 'save', arguments: { version: 1 },
    };
    const first = await callTool(event, payload);
    const result = await callTool(event, {
      ...payload,
      arguments: { version: 2 },
      approval: { requestId: first.approval.requestId, decision: 'once' },
    });

    expect(result).toMatchObject({ ok: false, error: 'MCP App approval is missing or expired' });
    expect(executeMcpAppTool).not.toHaveBeenCalled();
  });
});
