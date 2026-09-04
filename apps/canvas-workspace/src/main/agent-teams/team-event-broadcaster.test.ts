import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamEventBroadcaster } from './team-event-broadcaster';

describe('TeamEventBroadcaster', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('debounces each workspace/team pair and broadcasts its canvas nodes', async () => {
    vi.useFakeTimers();
    const loadMetadata = vi.fn(async () => ({
      frameNodeId: 'frame-1',
      agentNodeIds: { lead: 'node-1', missing: '' },
    }));
    const broadcast = vi.fn();
    const broadcaster = new TeamEventBroadcaster({ loadMetadata, broadcast });

    broadcaster.schedule('ws-1', 'team-1');
    broadcaster.schedule('ws-1', 'team-1');
    await vi.advanceTimersByTimeAsync(250);

    expect(loadMetadata).toHaveBeenCalledOnce();
    expect(loadMetadata).toHaveBeenCalledWith('ws-1', 'team-1');
    expect(broadcast).toHaveBeenCalledWith('ws-1', ['frame-1', 'node-1'], 'update', 'agent-teams');
  });

  it('broadcasts supplied metadata synchronously with the canvas update contract', () => {
    const broadcast = vi.fn();
    const broadcaster = new TeamEventBroadcaster({
      loadMetadata: vi.fn(),
      broadcast,
    });

    broadcaster.broadcastMetadata('ws-1', {
      frameNodeId: 'frame-1',
      agentNodeIds: { lead: 'node-1' },
    });

    expect(broadcast).toHaveBeenCalledWith('ws-1', ['frame-1', 'node-1'], 'update', 'agent-teams');
  });

  it('does not merge timers for different workspaces', async () => {
    vi.useFakeTimers();
    const loadMetadata = vi.fn(async (workspaceId: string) => ({
      frameNodeId: `frame-${workspaceId}`,
      agentNodeIds: {},
    }));
    const broadcast = vi.fn();
    const broadcaster = new TeamEventBroadcaster({ loadMetadata, broadcast });

    broadcaster.schedule('ws-1', 'team-1');
    broadcaster.schedule('ws-2', 'team-1');
    await vi.advanceTimersByTimeAsync(250);

    expect(loadMetadata).toHaveBeenCalledTimes(2);
    expect(broadcast).toHaveBeenCalledTimes(2);
  });

  it('ignores deleted teams and metadata read failures', async () => {
    vi.useFakeTimers();
    const loadMetadata = vi.fn()
      .mockResolvedValueOnce(null)
      .mockRejectedValueOnce(new Error('deleted'));
    const broadcast = vi.fn();
    const broadcaster = new TeamEventBroadcaster({ loadMetadata, broadcast });

    broadcaster.schedule('ws-1', 'team-1');
    broadcaster.schedule('ws-1', 'team-2');
    await vi.advanceTimersByTimeAsync(250);

    expect(broadcast).not.toHaveBeenCalled();
  });
});
