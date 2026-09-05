import { isPlaceholderHumanInputText } from './output-markers';
import type { CanvasAgentTeamStore } from './store';

const LEGACY_OUTPUT_BLOCK_REASON = 'Blocked by agent output marker.';

/**
 * Apply persisted-state compatibility repairs in their established order.
 * Placeholder gates run last so answered-gate recovery cannot prematurely
 * resume a task that still has a concrete open question.
 */
export async function repairAgentTeamState(store: CanvasAgentTeamStore, teamId: string): Promise<void> {
  await repairLegacyOutputMarkerBlocks(store, teamId);
  await repairAnsweredHumanGateBlocks(store, teamId);
  await repairPlaceholderHumanGates(store, teamId);
}

async function repairLegacyOutputMarkerBlocks(store: CanvasAgentTeamStore, teamId: string): Promise<void> {
  const [tasks, agents] = await Promise.all([
    store.listTasks(teamId),
    store.listAgents(teamId),
  ]);
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const now = Date.now();
  for (const task of tasks) {
    if (task.status !== 'blocked' || task.blockedReason !== LEGACY_OUTPUT_BLOCK_REASON || !task.ownerAgentId) {
      continue;
    }
    const agent = agentsById.get(task.ownerAgentId);
    if (!agent || agent.currentTaskId !== task.id) continue;
    task.status = 'in_progress';
    task.blockedReason = undefined;
    task.updatedAt = now;
    await store.saveTask(task);
    if (agent.status === 'blocked') {
      agent.status = 'running';
      agent.updatedAt = now;
      await store.saveAgent(agent);
    }
  }
}

async function repairPlaceholderHumanGates(store: CanvasAgentTeamStore, teamId: string): Promise<void> {
  const gates = await store.listHumanGates(teamId);
  const junk = gates.filter((gate) => gate.status === 'open' && isPlaceholderHumanInputText(gate.prompt.trim()));
  if (junk.length === 0) return;

  const now = Date.now();
  for (const gate of junk) {
    gate.status = 'cancelled';
    gate.updatedAt = now;
    await store.saveHumanGate(gate);
  }

  const [tasks, agents, refreshedGates] = await Promise.all([
    store.listTasks(teamId),
    store.listAgents(teamId),
    store.listHumanGates(teamId),
  ]);
  const remainingOpen = refreshedGates.filter((gate) => gate.status === 'open');
  const openTaskIds = new Set(remainingOpen.map((gate) => gate.taskId).filter(Boolean));
  const openAgentIds = new Set(remainingOpen.map((gate) => gate.agentId).filter(Boolean));
  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));

  for (const gate of junk) {
    if (gate.taskId && !openTaskIds.has(gate.taskId)) {
      const task = tasks.find((candidate) => candidate.id === gate.taskId);
      if (task && task.status === 'needs_input') {
        task.status = task.ownerAgentId ? 'in_progress' : 'todo';
        task.blockedReason = undefined;
        task.updatedAt = now;
        await store.saveTask(task);
      }
    }
    if (gate.agentId && !openAgentIds.has(gate.agentId)) {
      const agent = agentsById.get(gate.agentId);
      if (agent && agent.status === 'needs_input') {
        agent.status = agent.currentTaskId ? 'running' : 'idle';
        agent.updatedAt = now;
        await store.saveAgent(agent);
      }
    }
  }
}

async function repairAnsweredHumanGateBlocks(store: CanvasAgentTeamStore, teamId: string): Promise<void> {
  const [gates, tasks, agents] = await Promise.all([
    store.listHumanGates(teamId),
    store.listTasks(teamId),
    store.listAgents(teamId),
  ]);
  const openTaskGateIds = new Set(
    gates
      .filter((gate) => gate.status === 'open' && gate.taskId)
      .map((gate) => gate.taskId as string),
  );
  const answeredTaskGateIds = new Set(
    gates
      .filter((gate) => gate.status === 'answered' && gate.taskId)
      .map((gate) => gate.taskId as string),
  );
  if (answeredTaskGateIds.size === 0) return;

  const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
  const now = Date.now();
  for (const task of tasks) {
    if (
      task.status !== 'needs_input'
      || !answeredTaskGateIds.has(task.id)
      || openTaskGateIds.has(task.id)
    ) {
      continue;
    }

    task.status = task.ownerAgentId ? 'in_progress' : 'todo';
    task.blockedReason = undefined;
    task.updatedAt = now;
    await store.saveTask(task);

    if (!task.ownerAgentId) continue;
    const agent = agentsById.get(task.ownerAgentId);
    if (!agent || agent.status !== 'needs_input' || agent.currentTaskId !== task.id) continue;
    agent.status = 'running';
    agent.updatedAt = now;
    await store.saveAgent(agent);
  }
}
