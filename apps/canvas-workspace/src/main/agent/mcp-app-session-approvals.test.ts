import { describe, expect, it } from 'vitest';
import { McpAppSessionApprovals } from './mcp-app-session-approvals';

describe('McpAppSessionApprovals', () => {
  it('remembers one MCP server only for the granting renderer and agent scope', () => {
    const approvals = new McpAppSessionApprovals();
    const workspace = { kind: 'workspace', workspaceId: 'ws-1' } as const;

    approvals.grant(7, workspace, 'cowart.cowart_mcp');

    expect(approvals.has(7, workspace, 'cowart.cowart_mcp')).toBe(true);
    expect(approvals.has(7, workspace, 'another.server')).toBe(false);
    expect(approvals.has(7, { kind: 'workspace', workspaceId: 'ws-2' }, 'cowart.cowart_mcp')).toBe(false);
    expect(approvals.has(8, workspace, 'cowart.cowart_mcp')).toBe(false);
  });

  it('clears every remembered grant when the renderer session ends', () => {
    const approvals = new McpAppSessionApprovals();
    approvals.grant(7, { kind: 'global' }, 'one.server');
    approvals.grant(7, { kind: 'scheduled', taskId: 'task-1' }, 'two.server');

    approvals.clear(7);

    expect(approvals.has(7, { kind: 'global' }, 'one.server')).toBe(false);
    expect(approvals.has(7, { kind: 'scheduled', taskId: 'task-1' }, 'two.server')).toBe(false);
  });
});
