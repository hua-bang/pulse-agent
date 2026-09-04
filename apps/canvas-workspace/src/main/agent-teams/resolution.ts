import type { RuntimeSnapshot, TeamAgentRecord, TeamTaskRecord } from 'pulse-coder-agent-teams/runtime';

export function resolveAgentReference(agents: TeamAgentRecord[], reference: string): TeamAgentRecord {
  const trimmed = reference.trim();
  if (!trimmed) throw new Error('Agent reference is required');
  const byId = agents.find((agent) => agent.id === trimmed);
  if (byId) return byId;
  const key = trimmed.toLowerCase();
  const matches = agents.filter((agent) => agent.name.trim().toLowerCase() === key);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) throw new Error(`Agent reference is ambiguous: ${reference}`);
  throw new Error(`Agent not found: ${reference}`);
}

export function resolveTaskReferences(tasks: TeamTaskRecord[], references: string[]): string[] {
  return references.map((reference) => {
    const trimmed = reference.trim();
    if (!trimmed) throw new Error('Task dependency reference is empty');
    const byId = tasks.find((task) => task.id === trimmed);
    if (byId) return byId.id;
    const key = trimmed.toLowerCase();
    const matches = tasks.filter((task) => task.title.trim().toLowerCase() === key);
    if (matches.length === 1) return matches[0].id;
    if (matches.length > 1) throw new Error(`Task dependency reference is ambiguous: ${reference}`);
    throw new Error(`Task dependency not found: ${reference}`);
  });
}

export function resolveTaskForAction(
  tasks: TeamTaskRecord[],
  taskReference: string | undefined,
  agent: TeamAgentRecord | undefined,
): TeamTaskRecord {
  if (taskReference) {
    const [taskId] = resolveTaskReferences(tasks, [taskReference]);
    const task = tasks.find((candidate) => candidate.id === taskId);
    if (task) return task;
  }
  if (agent?.currentTaskId) {
    const task = tasks.find((candidate) => candidate.id === agent.currentTaskId);
    if (task) return task;
  }
  throw new Error('Task ID required when source agent has no current task');
}

export function resolveOpenGateForAgent(
  snapshot: RuntimeSnapshot,
  agent: TeamAgentRecord,
  taskId?: string,
): RuntimeSnapshot['humanGates'][number] | undefined {
  const openGates = snapshot.humanGates.filter((gate) =>
    gate.status === 'open' && gate.agentId === agent.id);
  if (openGates.length === 0) return undefined;
  if (taskId) return openGates.find((gate) => gate.taskId === taskId);
  if (agent.currentTaskId) {
    const current = openGates.find((gate) => gate.taskId === agent.currentTaskId);
    if (current) return current;
  }
  const needsInputTaskIds = new Set(
    snapshot.tasks
      .filter((task) => task.ownerAgentId === agent.id && task.status === 'needs_input')
      .map((task) => task.id),
  );
  const candidates = openGates.filter((gate) => gate.taskId && needsInputTaskIds.has(gate.taskId));
  if (candidates.length === 1) return candidates[0];
  return openGates.length === 1 ? openGates[0] : undefined;
}
