import { describe, expect, it, vi } from 'vitest';
import { AgentNodeResolver } from './agent-node-resolver';

describe('AgentNodeResolver', () => {
  it('scans once, then validates and reuses the cached agent identity', async () => {
    const agent = { id: 'agent-1', teamId: 'team-1', sessionRef: { sessionId: 'node-1' } };
    const store = {
      listTeamMetadata: vi.fn(async () => [{
        teamId: 'team-1', metadata: { agentNodeIds: { 'agent-1': 'node-1' } },
      }]),
      getAgent: vi.fn(async () => agent),
    };
    const resolver = new AgentNodeResolver();

    expect(await resolver.resolve('ws-1', 'node-1', store as never)).toEqual({ teamId: 'team-1', agent });
    expect(await resolver.resolve('ws-1', 'node-1', store as never)).toEqual({ teamId: 'team-1', agent });
    expect(store.listTeamMetadata).toHaveBeenCalledOnce();
    expect(store.getAgent).toHaveBeenCalledTimes(2);
  });

  it('drops a stale cache entry and self-heals through a fresh metadata scan', async () => {
    const oldAgent = { id: 'old', teamId: 'old-team', sessionRef: { sessionId: 'node-1' } };
    const nextAgent = { id: 'next', teamId: 'next-team', sessionRef: { sessionId: 'node-1' } };
    const metadata = vi.fn()
      .mockResolvedValueOnce([{ teamId: 'old-team', metadata: { agentNodeIds: { old: 'node-1' } } }])
      .mockResolvedValueOnce([{ teamId: 'next-team', metadata: { agentNodeIds: { next: 'node-1' } } }]);
    const getAgent = vi.fn()
      .mockResolvedValueOnce(oldAgent)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(nextAgent);
    const resolver = new AgentNodeResolver();
    const store = { listTeamMetadata: metadata, getAgent } as never;

    await resolver.resolve('ws-1', 'node-1', store);
    expect(await resolver.resolve('ws-1', 'node-1', store)).toEqual({ teamId: 'next-team', agent: nextAgent });
    expect(metadata).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['team id', { id: 'old', teamId: 'moved-team', sessionRef: { sessionId: 'node-1' } }],
    ['session id', { id: 'old', teamId: 'old-team', sessionRef: { sessionId: 'other-node' } }],
  ])('rescans when the cached agent %s changes', async (_field, changedAgent) => {
    const oldAgent = { id: 'old', teamId: 'old-team', sessionRef: { sessionId: 'node-1' } };
    const nextAgent = { id: 'next', teamId: 'next-team', sessionRef: { sessionId: 'node-1' } };
    const metadata = vi.fn()
      .mockResolvedValueOnce([{ teamId: 'old-team', metadata: { agentNodeIds: { old: 'node-1' } } }])
      .mockResolvedValueOnce([{ teamId: 'next-team', metadata: { agentNodeIds: { next: 'node-1' } } }]);
    const getAgent = vi.fn()
      .mockResolvedValueOnce(oldAgent)
      .mockResolvedValueOnce(changedAgent)
      .mockResolvedValueOnce(nextAgent);
    const resolver = new AgentNodeResolver();
    const store = { listTeamMetadata: metadata, getAgent } as never;

    await resolver.resolve('ws-1', 'node-1', store);
    expect(await resolver.resolve('ws-1', 'node-1', store)).toEqual({ teamId: 'next-team', agent: nextAgent });
    expect(metadata).toHaveBeenCalledTimes(2);
  });

  it('returns null when no team metadata maps the node', async () => {
    const store = {
      listTeamMetadata: vi.fn(async () => [{
        teamId: 'team-1', metadata: { agentNodeIds: { 'agent-1': 'other-node' } },
      }]),
      getAgent: vi.fn(),
    };

    await expect(new AgentNodeResolver().resolve('ws-1', 'node-1', store as never)).resolves.toBeNull();
    expect(store.getAgent).not.toHaveBeenCalled();
  });

  it('isolates the same node id between workspaces', async () => {
    const firstAgent = { id: 'agent-1', teamId: 'team-1', sessionRef: { sessionId: 'node-1' } };
    const secondAgent = { id: 'agent-2', teamId: 'team-2', sessionRef: { sessionId: 'node-1' } };
    const firstStore = {
      listTeamMetadata: vi.fn(async () => [{
        teamId: 'team-1', metadata: { agentNodeIds: { 'agent-1': 'node-1' } },
      }]),
      getAgent: vi.fn(async () => firstAgent),
    };
    const secondStore = {
      listTeamMetadata: vi.fn(async () => [{
        teamId: 'team-2', metadata: { agentNodeIds: { 'agent-2': 'node-1' } },
      }]),
      getAgent: vi.fn(async () => secondAgent),
    };
    const resolver = new AgentNodeResolver();

    expect(await resolver.resolve('ws-1', 'node-1', firstStore as never)).toEqual({
      teamId: 'team-1',
      agent: firstAgent,
    });
    expect(await resolver.resolve('ws-2', 'node-1', secondStore as never)).toEqual({
      teamId: 'team-2',
      agent: secondAgent,
    });
    expect(firstStore.listTeamMetadata).toHaveBeenCalledOnce();
    expect(secondStore.listTeamMetadata).toHaveBeenCalledOnce();
  });
});
