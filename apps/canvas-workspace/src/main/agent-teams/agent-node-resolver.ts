import type { TeamAgentRecord } from 'pulse-coder-agent-teams/runtime';
import type { CanvasAgentTeamStore } from './store';

export interface AgentNodeMatch {
  teamId: string;
  agent: TeamAgentRecord;
}

type AgentNodeStore = Pick<CanvasAgentTeamStore, 'getAgent' | 'listTeamMetadata'>;

export class AgentNodeResolver {
  private readonly cache = new Map<string, { teamId: string; agentId: string }>();

  async resolve(
    workspaceId: string,
    nodeId: string,
    store: AgentNodeStore,
  ): Promise<AgentNodeMatch | null> {
    const key = `${workspaceId}:${nodeId}`;
    const cached = this.cache.get(key);
    if (cached) {
      const agent = await store.getAgent(cached.agentId);
      if (agent && agent.teamId === cached.teamId && agent.sessionRef?.sessionId === nodeId) {
        return { teamId: cached.teamId, agent };
      }
      this.cache.delete(key);
    }

    const match = await this.find(store, nodeId);
    if (match) this.cache.set(key, { teamId: match.teamId, agentId: match.agent.id });
    return match;
  }

  private async find(store: AgentNodeStore, nodeId: string): Promise<AgentNodeMatch | null> {
    const entries = await store.listTeamMetadata();
    for (const entry of entries) {
      const agentId = Object.entries(entry.metadata.agentNodeIds)
        .find(([, candidateNodeId]) => candidateNodeId === nodeId)?.[0];
      if (!agentId) continue;
      const agent = await store.getAgent(agentId);
      if (agent) return { teamId: entry.teamId, agent };
    }
    return null;
  }
}
