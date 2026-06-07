import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { promises as fs } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

// Mock pty-manager since node-pty / electron are not available in test env.
const sessionWrites: Array<{ id: string; data: string }> = [];
const liveSessions = new Set<string>();
let dropSessionAfterEnter = false;

vi.mock('../terminal/pty-manager', () => ({
  hasSession: (id: string) => liveSessions.has(id),
  writeToSession: (id: string, data: string) => {
    if (!liveSessions.has(id)) return false;
    sessionWrites.push({ id, data });
    if (dropSessionAfterEnter && data === '\r') liveSessions.delete(id);
    return true;
  },
}));

// Mock canvas-storage to load from a temp directory we control.
let mockCanvas: { nodes: Array<Record<string, unknown>> } | null = null;
vi.mock('../canvas/storage', () => ({
  readCanvasFull: async () => ({ data: mockCanvas }),
}));

import { sendInputToAgentNode } from '../agent/session-send';

let tmp: string;

beforeEach(() => {
  sessionWrites.length = 0;
  liveSessions.clear();
  dropSessionAfterEnter = false;
  mockCanvas = null;
  tmp = join(tmpdir(), `agent-send-${Date.now()}`);
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true }).catch(() => {});
});

describe('sendInputToAgentNode', () => {
  it('fails when the workspace cannot be loaded', async () => {
    mockCanvas = null;
    const r = await sendInputToAgentNode({ workspaceId: 'ws', nodeId: 'n', input: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('workspace_not_found');
  });

  it('fails when the node is missing', async () => {
    mockCanvas = { nodes: [] };
    const r = await sendInputToAgentNode({ workspaceId: 'ws', nodeId: 'missing', input: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('node_not_found');
  });

  it('fails when the node is not an agent', async () => {
    mockCanvas = {
      nodes: [{ id: 'n1', type: 'file', title: 'foo', data: {} }],
    };
    const r = await sendInputToAgentNode({ workspaceId: 'ws', nodeId: 'n1', input: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('wrong_node_type');
  });

  it('fails when the agent is not running', async () => {
    mockCanvas = {
      nodes: [{ id: 'n1', type: 'agent', title: 'foo', data: { status: 'idle' } }],
    };
    const r = await sendInputToAgentNode({ workspaceId: 'ws', nodeId: 'n1', input: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('not_running');
  });

  it('fails when sessionId is missing or PTY is gone', async () => {
    mockCanvas = {
      nodes: [{ id: 'n1', type: 'agent', title: 'foo', data: { status: 'running', sessionId: 'sess-dead' } }],
    };
    // sess-dead is not in liveSessions
    const r = await sendInputToAgentNode({ workspaceId: 'ws', nodeId: 'n1', input: 'hi' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.code).toBe('no_session');
  });

  it('writes body then \\r in order with a delay, and strips trailing newlines', async () => {
    mockCanvas = {
      nodes: [{ id: 'n1', type: 'agent', title: 'foo', data: { status: 'running', sessionId: 'sess-1' } }],
    };
    liveSessions.add('sess-1');

    const r = await sendInputToAgentNode({
      workspaceId: 'ws',
      nodeId: 'n1',
      input: 'do the thing\n',
    });

    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.bytesSent).toBe('do the thing'.length + 1);
      expect(r.nodeId).toBe('n1');
    }
    expect(sessionWrites).toEqual([
      { id: 'sess-1', data: 'do the thing' },
      { id: 'sess-1', data: '\r' },
    ]);
  });

  it('still sends Enter when the body is empty', async () => {
    mockCanvas = {
      nodes: [{ id: 'n1', type: 'agent', title: 'foo', data: { status: 'running', sessionId: 'sess-1' } }],
    };
    liveSessions.add('sess-1');

    const r = await sendInputToAgentNode({ workspaceId: 'ws', nodeId: 'n1', input: '' });
    expect(r.ok).toBe(true);
    expect(sessionWrites).toEqual([{ id: 'sess-1', data: '\r' }]);
  });

  it('fails when the PTY disappears immediately after submit so callers can queue a retry', async () => {
    mockCanvas = {
      nodes: [{ id: 'n1', type: 'agent', title: 'foo', data: { status: 'running', sessionId: 'sess-1' } }],
    };
    liveSessions.add('sess-1');
    dropSessionAfterEnter = true;

    const r = await sendInputToAgentNode({ workspaceId: 'ws', nodeId: 'n1', input: 'retry me' });

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.code).toBe('write_failed');
      expect(r.error).toContain('session disappeared after submit');
    }
    expect(sessionWrites).toEqual([
      { id: 'sess-1', data: 'retry me' },
      { id: 'sess-1', data: '\r' },
    ]);
  });
});
