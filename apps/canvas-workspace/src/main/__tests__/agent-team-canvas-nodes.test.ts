import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasSaveData } from '../agent/tools/types';

const mockState = vi.hoisted(() => ({
  canvas: null as CanvasSaveData | null,
  broadcasts: [] as Array<{ workspaceId: string; nodeIds: string[]; kind: string; source: string }>,
}));

vi.mock('../canvas/storage', () => ({
  readCanvasFull: vi.fn(async () => ({ data: mockState.canvas })),
  writeCanvasFull: vi.fn(async (_workspaceId: string, data: CanvasSaveData) => {
    mockState.canvas = JSON.parse(JSON.stringify(data));
  }),
}));

vi.mock('../canvas/broadcast', () => ({
  broadcastCanvasUpdate: vi.fn((workspaceId: string, nodeIds: string[], kind: string, source: string) => {
    mockState.broadcasts.push({ workspaceId, nodeIds, kind, source });
  }),
}));

vi.mock('../agent/workspace-meta', () => ({
  readWorkspaceMeta: vi.fn(async () => ({ rootFolder: '/repo' })),
}));

vi.mock('../terminal/pty-manager', () => ({
  hasSession: vi.fn(() => false),
  killSession: vi.fn(() => true),
  writeToSession: vi.fn(),
}));

vi.mock('../agent/session-send', () => ({
  sendInputToAgentNode: vi.fn(),
}));

import {
  createAgentTeamCanvasNodes,
  createTeamAgentNode,
  ensureAgentTeamCanvasLayout,
  removeAgentTeamCanvasNodes,
  stopAgentTeamCanvasNodes,
} from '../agent-teams/canvas-nodes';

describe('agent team canvas node layout', () => {
  beforeEach(() => {
    mockState.canvas = {
      nodes: [],
      edges: [],
      transform: { x: 0, y: 0, scale: 1 },
      savedAt: new Date(0).toISOString(),
    };
    mockState.broadcasts.length = 0;
  });

  it('creates agent nodes below the team control strip', async () => {
    const result = await createAgentTeamCanvasNodes({
      workspaceId: 'ws-1',
      teamId: 'team-1',
      name: 'Agent Team',
      goal: 'Coordinate',
      x: 100,
      y: 200,
      lead: { agentId: 'lead-1', name: 'Lead', agentType: 'claude-code' },
      teammates: [
        { agentId: 'mate-1', name: 'Backend', agentType: 'codex' },
        { agentId: 'mate-2', name: 'Frontend', agentType: 'codex' },
      ],
    });

    const frame = mockState.canvas!.nodes.find((node) => node.id === result.frameNodeId)!;
    const lead = mockState.canvas!.nodes.find((node) => node.id === result.agentNodeIds['lead-1'])!;
    const backend = mockState.canvas!.nodes.find((node) => node.id === result.agentNodeIds['mate-1'])!;
    const frontend = mockState.canvas!.nodes.find((node) => node.id === result.agentNodeIds['mate-2'])!;

    expect(frame.data.agentTeamPanelHeight).toBe(388);
    expect(lead.y).toBe(frame.y + 412);
    expect(lead.data.agentArgs).toBe('--disallowedTools Task');
    expect(lead.data.dangerousMode).toBe(true);
    expect(backend.y).toBe(lead.y);
    expect(frontend.y).toBe(lead.y);
    expect(backend.x).toBeGreaterThan(lead.x);
    expect(frontend.x).toBeGreaterThan(backend.x);
    expect(backend.data.agentArgs).toBeUndefined();
    expect(backend.data.dangerousMode).toBe(true);
    expect(lead.y).toBeGreaterThan(frame.y + (frame.data.agentTeamPanelHeight as number));
  });

  it('migrates legacy agent team nodes out from under the control strip', async () => {
    mockState.canvas!.nodes = [
      {
        id: 'frame-1',
        type: 'frame',
        title: 'Agent Team',
        x: 100,
        y: 200,
        width: 1120,
        height: 620,
        data: { agentTeamId: 'team-1' },
      },
      {
        id: 'agent-1',
        type: 'agent',
        title: 'Lead',
        x: 124,
        y: 258,
        width: 520,
        height: 440,
        data: { agentTeamId: 'team-1' },
      },
    ];

    await ensureAgentTeamCanvasLayout('ws-1', 'team-1');

    const frame = mockState.canvas!.nodes[0];
    const agent = mockState.canvas!.nodes[1];
    expect(frame.data.agentTeamPanelHeight).toBe(388);
    expect(agent.y).toBe(612);
    expect(mockState.broadcasts.at(-1)).toMatchObject({
      workspaceId: 'ws-1',
      kind: 'update',
      source: 'agent-teams',
    });
  });

  it('places teammates added after plan approval into reserved row slots', async () => {
    const result = await createAgentTeamCanvasNodes({
      workspaceId: 'ws-1',
      teamId: 'team-1',
      name: 'Agent Team',
      goal: 'Coordinate',
      x: 100,
      y: 200,
      lead: { agentId: 'lead-1', name: 'Lead', agentType: 'codex' },
      teammates: [],
    });

    const backendNodeId = await createTeamAgentNode({
      workspaceId: 'ws-1',
      teamId: 'team-1',
      frameNodeId: result.frameNodeId,
      agentId: 'backend-1',
      name: 'Backend Codex',
      role: 'teammate',
      agentType: 'codex',
    });
    const frontendNodeId = await createTeamAgentNode({
      workspaceId: 'ws-1',
      teamId: 'team-1',
      frameNodeId: result.frameNodeId,
      agentId: 'frontend-1',
      name: 'Frontend Codex',
      role: 'teammate',
      agentType: 'codex',
    });

    const frame = mockState.canvas!.nodes.find((node) => node.id === result.frameNodeId)!;
    const lead = mockState.canvas!.nodes.find((node) => node.id === result.agentNodeIds['lead-1'])!;
    const backend = mockState.canvas!.nodes.find((node) => node.id === backendNodeId)!;
    const frontend = mockState.canvas!.nodes.find((node) => node.id === frontendNodeId)!;

    expect(backend.y).toBe(lead.y);
    expect(frontend.y).toBe(lead.y);
    expect(backend.x).toBeGreaterThan(lead.x);
    expect(frontend.x).toBeGreaterThan(backend.x);
    expect(frame.width).toBeGreaterThanOrEqual(frontend.x + frontend.width + 24 - frame.x);
    expect(backend.data.dangerousMode).toBe(true);
    expect(frontend.data.dangerousMode).toBe(true);
  });

  it('preserves manually resized leader nodes after updating the team panel layout', async () => {
    mockState.canvas!.nodes = [
      {
        id: 'frame-1',
        type: 'frame',
        title: 'Agent Team',
        x: 100,
        y: 200,
        width: 1120,
        height: 500,
        data: { agentTeamId: 'team-1', agentTeamPanelHeight: 172 },
      },
      {
        id: 'agent-1',
        type: 'agent',
        title: 'Team Lead',
        x: 124,
        y: 370,
        width: 480,
        height: 260,
        data: {
          agentTeamId: 'team-1',
          agentTeamRole: 'lead',
          agentType: 'claude-code',
          agentArgs: '--disallowedTools Task',
        },
      },
    ];

    await ensureAgentTeamCanvasLayout('ws-1', 'team-1');

    const frame = mockState.canvas!.nodes[0];
    const agent = mockState.canvas!.nodes[1];
    expect(frame.data.agentTeamPanelHeight).toBe(388);
    expect(agent.y).toBe(586);
    expect(agent.width).toBe(480);
    expect(agent.height).toBe(260);
    expect(agent.data.dangerousMode).toBe(true);
    expect(mockState.broadcasts.at(-1)).toMatchObject({
      workspaceId: 'ws-1',
      kind: 'update',
      source: 'agent-teams',
    });
  });

  it('adds Claude Task disallow args to existing team leader nodes without resizing them', async () => {
    mockState.canvas!.nodes = [
      {
        id: 'frame-1',
        type: 'frame',
        title: 'Agent Team',
        x: 100,
        y: 200,
        width: 1120,
        height: 500,
        data: { agentTeamId: 'team-1', agentTeamPanelHeight: 388 },
      },
      {
        id: 'agent-1',
        type: 'agent',
        title: 'Team Lead',
        x: 124,
        y: 370,
        width: 480,
        height: 260,
        data: { agentTeamId: 'team-1', agentTeamRole: 'lead', agentType: 'claude-code' },
      },
    ];

    await ensureAgentTeamCanvasLayout('ws-1', 'team-1');

    const agent = mockState.canvas!.nodes[1];
    expect(agent.width).toBe(480);
    expect(agent.height).toBe(260);
    expect(agent.data.agentArgs).toBe('--disallowedTools Task');
    expect(agent.data.dangerousMode).toBe(true);
    expect(mockState.broadcasts.at(-1)).toMatchObject({
      workspaceId: 'ws-1',
      kind: 'update',
      source: 'agent-teams',
    });
  });

  it('stops all agent nodes for a paused team', async () => {
    mockState.canvas!.nodes = [
      {
        id: 'frame-1',
        type: 'frame',
        title: 'Agent Team',
        x: 100,
        y: 200,
        width: 1120,
        height: 500,
        data: { agentTeamId: 'team-1', agentTeamPanelHeight: 388 },
      },
      {
        id: 'agent-1',
        type: 'agent',
        title: 'Team Lead',
        x: 124,
        y: 370,
        width: 480,
        height: 260,
        data: {
          agentTeamId: 'team-1',
          agentTeamRole: 'lead',
          status: 'running',
          viewMode: 'running',
          inlinePrompt: 'keep going',
          promptFile: '.canvas-agent-team.md',
        },
      },
      {
        id: 'other-agent',
        type: 'agent',
        title: 'Other',
        x: 700,
        y: 370,
        width: 480,
        height: 260,
        data: { agentTeamId: 'team-2', status: 'running', viewMode: 'running' },
      },
    ];

    const changedIds = await stopAgentTeamCanvasNodes('ws-1', 'team-1');

    const agent = mockState.canvas!.nodes.find((node) => node.id === 'agent-1')!;
    const otherAgent = mockState.canvas!.nodes.find((node) => node.id === 'other-agent')!;
    expect(changedIds).toEqual(['agent-1']);
    expect(agent.data.status).toBe('idle');
    expect(agent.data.viewMode).toBe('restart');
    expect(agent.data.inlinePrompt).toBe('');
    expect(agent.data.promptFile).toBe('');
    expect(otherAgent.data.status).toBe('running');
    expect(mockState.broadcasts.at(-1)).toMatchObject({
      workspaceId: 'ws-1',
      nodeIds: ['agent-1'],
      kind: 'update',
      source: 'agent-teams',
    });
  });

  it('removes a team frame, its coding agents, and connected edges', async () => {
    mockState.canvas!.nodes = [
      {
        id: 'frame-1',
        type: 'frame',
        title: 'Agent Team',
        x: 100,
        y: 200,
        width: 1120,
        height: 500,
        data: { agentTeamId: 'team-1', agentTeamPanelHeight: 388 },
      },
      {
        id: 'agent-1',
        type: 'agent',
        title: 'Team Lead',
        x: 124,
        y: 370,
        width: 480,
        height: 260,
        data: { agentTeamId: 'team-1', agentTeamRole: 'lead' },
      },
      {
        id: 'note-1',
        type: 'text',
        title: 'Keep me',
        x: 700,
        y: 370,
        width: 240,
        height: 120,
        data: { content: 'hello' },
      },
    ];
    mockState.canvas!.edges = [
      { id: 'edge-1', source: { kind: 'node', nodeId: 'agent-1' }, target: { kind: 'node', nodeId: 'note-1' } },
      { id: 'edge-2', source: { kind: 'point', x: 1, y: 2 }, target: { kind: 'node', nodeId: 'note-1' } },
    ];

    const removedIds = await removeAgentTeamCanvasNodes('ws-1', 'team-1');

    expect(removedIds).toEqual(['frame-1', 'agent-1']);
    expect(mockState.canvas!.nodes.map((node) => node.id)).toEqual(['note-1']);
    expect(mockState.canvas!.edges?.map((edge) => edge.id)).toEqual(['edge-2']);
    expect(mockState.broadcasts.at(-1)).toMatchObject({
      workspaceId: 'ws-1',
      nodeIds: ['frame-1', 'agent-1'],
      kind: 'delete',
      source: 'agent-teams',
    });
  });
});
