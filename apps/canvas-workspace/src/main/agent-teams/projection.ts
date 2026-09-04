import type { RuntimeSnapshot, TeamTaskRecord } from 'pulse-coder-agent-teams/runtime';
import type { CanvasAgentTeamMetadata, CanvasAgentTeamPhase } from './types';

export function inferPhase(
  metadata: CanvasAgentTeamMetadata | undefined,
  snapshot: RuntimeSnapshot,
): CanvasAgentTeamPhase {
  if (metadata?.phase) return metadata.phase;
  if (metadata?.pendingPlan) return 'plan_review';
  if (snapshot.agents.some((agent) => agent.role === 'teammate') || snapshot.tasks.length > 0) {
    return 'executing';
  }
  return snapshot.team.status === 'waiting_approval' ? 'plan_review' : 'briefing';
}

const isTaskReadyForDispatch = (task: TeamTaskRecord, tasks: TeamTaskRecord[]): boolean =>
  task.deps.every((dependencyId) => tasks.find((candidate) => candidate.id === dependencyId)?.status === 'done');

export function plannedStartupAgentIds(snapshot: RuntimeSnapshot): string[] {
  const ids = new Set<string>();
  if (snapshot.team.leadAgentId) ids.add(snapshot.team.leadAgentId);
  const byId = new Map(snapshot.agents.map((agent) => [agent.id, agent]));
  const teammates = snapshot.agents.filter((agent) => agent.role === 'teammate');
  const readyTasks = snapshot.tasks.filter((task) =>
    task.status === 'todo' && isTaskReadyForDispatch(task, snapshot.tasks));
  for (const task of readyTasks) {
    const owner = task.ownerAgentId ? byId.get(task.ownerAgentId) : undefined;
    if (owner?.role === 'teammate') ids.add(owner.id);
    else for (const teammate of teammates) ids.add(teammate.id);
  }
  if (ids.size === 1 && teammates[0]) ids.add(teammates[0].id);
  return [...ids];
}

export function agentNodeIdsForAgents(
  metadata: CanvasAgentTeamMetadata | undefined,
  agentIds: string[],
): string[] {
  return agentIds
    .map((agentId) => metadata?.agentNodeIds[agentId])
    .filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.length > 0);
}

export function metadataCanvasNodeIds(metadata: CanvasAgentTeamMetadata | undefined): string[] {
  return [
    metadata?.frameNodeId,
    ...Object.values(metadata?.agentNodeIds ?? {}),
  ].filter((nodeId): nodeId is string => typeof nodeId === 'string' && nodeId.length > 0);
}
