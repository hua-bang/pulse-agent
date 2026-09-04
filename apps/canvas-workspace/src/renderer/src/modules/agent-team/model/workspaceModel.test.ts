import { describe, expect, it } from 'vitest';
import type { AgentTeamSnapshot } from '../../../types';
import {
  buildAgentTeamDagLayout,
  createAgentTeamGraphAgents,
  createAgentTeamWorkspaceModel,
} from '..';

const snapshot = (patch: Partial<AgentTeamSnapshot> = {}): AgentTeamSnapshot => ({
  workspaceId: 'workspace-1',
  phase: 'executing',
  runtime: {
    team: {
      id: 'team-1', name: 'Team', goal: 'Ship', status: 'running',
      createdAt: 1, updatedAt: 1,
    },
    agents: [], artifacts: [], humanGates: [], events: [], messages: [],
    tasks: [
      {
        id: 'task-1', teamId: 'team-1', title: 'Build', description: 'Build it',
        status: 'done', deps: [], createdBy: 'lead', createdAt: 1, updatedAt: 2,
        metadata: { round: 1 },
      },
      {
        id: 'task-2', teamId: 'team-1', title: 'Verify', description: 'Test it',
        status: 'in_progress', deps: ['task-1'], createdBy: 'lead', createdAt: 2, updatedAt: 3,
        metadata: { round: 2 },
      },
    ],
  },
  ...patch,
});

describe('Agent Team workspace model', () => {
  it('projects runtime tasks into round-scoped DAGs without cross-round edges', () => {
    const model = createAgentTeamWorkspaceModel(snapshot());
    expect(model.phase).toBe('executing');
    expect(model.rounds.map((group) => group.round)).toEqual([1, 2]);
    expect(model.roundOptions).toEqual([
      { round: 1, taskCount: 1, doneCount: 1, status: 'done' },
      { round: 2, taskCount: 1, doneCount: 0, status: 'running' },
    ]);

    const layout = buildAgentTeamDagLayout(model.rounds, 0);
    expect(layout.nodes.map((node) => node.task.key)).toEqual(['task-1', 'task-2']);
    expect(layout.edges).toEqual([]);
  });

  it('projects proposed dependencies by canonical title and flags downstream tasks with none', () => {
    const model = createAgentTeamWorkspaceModel(snapshot({
      phase: 'plan_review',
      pendingPlan: {
        summary: 'Plan', teammates: [], createdAt: 1, updatedAt: 2,
        tasks: [
          { title: 'Build', description: 'Implement', deps: [] },
          { title: 'QA', description: 'Verify', deps: [] },
          { title: 'Release', description: 'Ship', deps: ['Build'] },
        ],
      },
    }));
    expect(model.tasks[2].depKeys).toEqual(['build']);
    expect(model.tasks[1].dependencyWarning).toBe(true);
    expect(model.tasks[2].dependencyWarning).toBe(false);
  });

  it('projects runtime agent summaries from tasks, artifacts, node identity, and session health', () => {
    const teammate = {
      id: 'agent-1', teamId: 'team-1', role: 'teammate' as const, name: 'Ada', status: 'running' as const,
      currentTaskId: 'task-2', createdAt: 1, updatedAt: 2, metadata: { toolCount: 4 },
    };
    const model = createAgentTeamWorkspaceModel(snapshot({
      runtime: {
        ...snapshot().runtime,
        agents: [teammate],
        tasks: snapshot().runtime.tasks.map((task) => task.id === 'task-2' ? { ...task, ownerAgentId: 'agent-1' } : task),
        artifacts: [{ id: 'artifact-1', teamId: 'team-1', agentId: 'agent-1', kind: 'file', title: 'report.md', createdAt: 3 }],
      },
    }));
    const agentNode = {
      id: 'node-1', type: 'agent' as const, title: 'Ada', x: 0, y: 0, width: 320, height: 240,
      data: { sessionId: 'session-1', agentType: 'codex' },
    };

    expect(createAgentTeamGraphAgents({
      phase: model.phase,
      tasks: model.tasks,
      teammates: model.teammates,
      artifacts: snapshot({ runtime: { ...snapshot().runtime, artifacts: [{ id: 'artifact-1', teamId: 'team-1', agentId: 'agent-1', kind: 'file', title: 'report.md', createdAt: 3 }] } }).runtime.artifacts,
      agentNodeByAgentId: new Map([['agent-1', agentNode]]),
      sessions: { 'agent-1': 'healthy' },
    })).toMatchObject([{
      key: 'agent:agent-1',
      agentType: 'codex',
      currentTaskTitle: 'Verify',
      taskCount: 1,
      runningCount: 1,
      artifactCount: 1,
      toolCount: 4,
      sessionHealth: 'healthy',
    }]);
  });
});
