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
    getRegisteredToolName: vi.fn((): string | undefined => 'mcp_cowart_save'),
  };
  const service = {
    activateScope: vi.fn(async () => undefined),
    getAgentForScope: () => ({ getMcpAppsManager: () => manager, executeMcpAppTool }),
  };

  beforeEach(() => {
    electron.handlers.clear();
    executeMcpAppTool.mockClear();
    manager.getRegisteredToolName.mockReturnValue('mcp_cowart_save');
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
  it('runs list reads without a prompt, even while a write approval is open', async () => {
    const event = { sender: { id: 74, once: vi.fn() } };
    const callTool = electron.handlers.get('canvas-agent:mcp-app-call-tool')!;
    const payload = { scope: { kind: 'global' }, serverName: 'app', toolName: 'save', arguments: {} };
    const pending = await callTool(event, payload);
    expect(pending.approval).toBeDefined();
    expect(await callTool(event, { ...payload, toolName: 'list_drawings' })).toMatchObject({ ok: true });
    expect(executeMcpAppTool).toHaveBeenCalledTimes(1);
    await callTool(event, { ...payload, approval: { requestId: pending.approval.requestId, decision: 'cancel' } });
  });

  it('serializes three concurrent writes and applies a session grant to waiting calls', async () => {
    const event = { sender: { id: 75, once: vi.fn() } };
    const callTool = electron.handlers.get('canvas-agent:mcp-app-call-tool')!;
    const payload = { scope: { kind: 'global' }, serverName: 'app', toolName: 'save', arguments: {} };
    const first = await callTool(event, payload);
    let thirdSettled = false;
    const secondPromise = callTool(event, { ...payload, arguments: { n: 2 } });
    const thirdPromise = callTool(event, { ...payload, arguments: { n: 3 } }).then(value => { thirdSettled = true; return value; });
    await Promise.resolve();
    expect(thirdSettled).toBe(false);
    await callTool(event, { ...payload, approval: { requestId: first.approval.requestId, decision: 'once' } });
    const second = await secondPromise;
    expect(second.approval).toBeDefined();
    expect(thirdSettled).toBe(false);
    await callTool(event, { ...payload, arguments: { n: 2 }, approval: { requestId: second.approval.requestId, decision: 'session' } });
    expect(await thirdPromise).toMatchObject({ ok: true });
    expect(executeMcpAppTool).toHaveBeenCalledTimes(3);
  });

  it('keeps mixed read/write tools behind approval and releases the queue on cancel', async () => {
    const event = { sender: { id: 76, once: vi.fn() } };
    const callTool = electron.handlers.get('canvas-agent:mcp-app-call-tool')!;
    const payload = { scope: { kind: 'global' }, serverName: 'app', toolName: 'get_or_create_drawing', arguments: {} };
    const first = await callTool(event, payload);
    const next = callTool(event, { ...payload, toolName: 'search_and_delete' });
    expect(await callTool(event, { ...payload, approval: { requestId: first.approval.requestId, decision: 'cancel' } }))
      .toMatchObject({ ok: false, error: 'Tool call was cancelled' });
    const second = await next;
    expect(second.approval).toBeDefined();
    expect(executeMcpAppTool).not.toHaveBeenCalled();
    await callTool(event, { ...payload, toolName: 'search_and_delete', approval: { requestId: second.approval.requestId, decision: 'cancel' } });
  });

  it('settles queued requests when the renderer is destroyed', async () => {
    let destroyed = false;
    let cleanup!: () => void;
    const event = { sender: { id: 77, once: (_event: string, callback: () => void) => { cleanup = callback; }, isDestroyed: () => destroyed } };
    const callTool = electron.handlers.get('canvas-agent:mcp-app-call-tool')!;
    const payload = { scope: { kind: 'global' }, serverName: 'app', toolName: 'save', arguments: {} };
    await callTool(event, payload);
    const next = callTool(event, payload);
    await Promise.resolve();
    destroyed = true;
    cleanup();
    expect(await next).toMatchObject({ ok: false, error: 'MCP App renderer is closed' });
    expect(executeMcpAppTool).not.toHaveBeenCalled();
  });

  it('cancels a pending request after its tool was disabled', async () => {
    const event = { sender: { id: 78, once: vi.fn() } };
    const callTool = electron.handlers.get('canvas-agent:mcp-app-call-tool')!;
    const payload = { scope: { kind: 'global' }, serverName: 'app', toolName: 'save', arguments: {} };
    const first = await callTool(event, payload);
    manager.getRegisteredToolName.mockReturnValue(undefined);
    expect(await callTool(event, { ...payload, approval: { requestId: first.approval.requestId, decision: 'cancel' } }))
      .toMatchObject({ ok: false, error: 'Tool call was cancelled' });
    manager.getRegisteredToolName.mockReturnValue('mcp_cowart_save');
    const next = await callTool(event, payload);
    expect(next.approval).toBeDefined();
    await callTool(event, { ...payload, approval: { requestId: next.approval.requestId, decision: 'cancel' } });
  });

  it.each(['once', 'session'])('releases a failed %s confirmation without approving a different server', async (decision) => {
    const event = { sender: { id: decision === 'once' ? 79 : 80, once: vi.fn() } };
    const callTool = electron.handlers.get('canvas-agent:mcp-app-call-tool')!;
    const payload = { scope: { kind: 'global' }, serverName: 'disabled-app', toolName: 'save', arguments: {} };
    const first = await callTool(event, payload);
    manager.getRegisteredToolName.mockReturnValue(undefined);
    expect(await callTool(event, { ...payload, approval: { requestId: first.approval.requestId, decision } }))
      .toMatchObject({ ok: false, error: 'Unknown or disabled MCP App tool' });
    manager.getRegisteredToolName.mockReturnValue('mcp_cowart_save');
    const other = { ...payload, serverName: 'enabled-app' };
    const next = await callTool(event, other);
    expect(next.approval).toBeDefined();
    expect(executeMcpAppTool).not.toHaveBeenCalled();
    await callTool(event, { ...other, approval: { requestId: next.approval.requestId, decision: 'cancel' } });
  });

  it('does not clear another pending request when a failed confirmation has different arguments', async () => {
    const event = { sender: { id: 81, once: vi.fn() } };
    const callTool = electron.handlers.get('canvas-agent:mcp-app-call-tool')!;
    const payload = { scope: { kind: 'global' }, serverName: 'app', toolName: 'save', arguments: { n: 1 } };
    const first = await callTool(event, payload);
    manager.getRegisteredToolName.mockReturnValue(undefined);
    await callTool(event, { ...payload, arguments: { n: 2 }, approval: { requestId: first.approval.requestId, decision: 'once' } });
    expect(await callTool(event, { ...payload, approval: { requestId: first.approval.requestId, decision: 'cancel' } }))
      .toMatchObject({ ok: false, error: 'Tool call was cancelled' });
  });

  it('lets a session-approved server execute while another server awaits approval', async () => {
    const event = { sender: { id: 82, once: vi.fn() } };
    const callTool = electron.handlers.get('canvas-agent:mcp-app-call-tool')!;
    const payload = { scope: { kind: 'global' }, serverName: 'granted-app', toolName: 'save', arguments: {} };
    const first = await callTool(event, payload);
    await callTool(event, { ...payload, approval: { requestId: first.approval.requestId, decision: 'session' } });
    const other = { ...payload, serverName: 'other-app' };
    const pending = await callTool(event, other);
    expect(await callTool(event, payload)).toMatchObject({ ok: true });
    expect(executeMcpAppTool).toHaveBeenCalledTimes(2);
    await callTool(event, { ...other, approval: { requestId: pending.approval.requestId, decision: 'cancel' } });
  });

});
