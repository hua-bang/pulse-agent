import type { CanvasAgentTeamMetadata } from './types';

type TeamCanvasNodeMetadata = Pick<CanvasAgentTeamMetadata, 'frameNodeId' | 'agentNodeIds'>;

interface TeamEventBroadcasterOptions {
  loadMetadata: (workspaceId: string, teamId: string) => Promise<TeamCanvasNodeMetadata | null | undefined>;
  broadcast: (
    workspaceId: string,
    nodeIds: string[],
    changeType: 'update',
    source: 'agent-teams',
  ) => void;
  delayMs?: number;
}

export class TeamEventBroadcaster {
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly delayMs: number;

  constructor(private readonly options: TeamEventBroadcasterOptions) {
    this.delayMs = options.delayMs ?? 250;
  }

  schedule(workspaceId: string, teamId: string): void {
    const key = `${workspaceId}:${teamId}`;
    if (this.timers.has(key)) return;
    const timer = setTimeout(() => {
      this.timers.delete(key);
      void this.flush(workspaceId, teamId);
    }, this.delayMs);
    timer.unref?.();
    this.timers.set(key, timer);
  }

  broadcastMetadata(workspaceId: string, metadata: TeamCanvasNodeMetadata): void {
    const nodeIds = [
      metadata.frameNodeId,
      ...Object.values(metadata.agentNodeIds),
    ].filter((nodeId): nodeId is string => !!nodeId);
    if (nodeIds.length > 0) {
      this.options.broadcast(workspaceId, nodeIds, 'update', 'agent-teams');
    }
  }

  private async flush(workspaceId: string, teamId: string): Promise<void> {
    try {
      const metadata = await this.options.loadMetadata(workspaceId, teamId);
      if (metadata) this.broadcastMetadata(workspaceId, metadata);
    } catch {
      // Team may have been deleted between the event and the flush.
    }
  }
}
