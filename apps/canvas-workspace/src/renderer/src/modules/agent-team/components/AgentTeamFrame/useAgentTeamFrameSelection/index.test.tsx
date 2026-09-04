// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import type { AgentTeamTaskRecord } from '../../../../../types';
import type { AgentTeamGraphAgent, AgentTeamGraphTask } from '../../../model/workspaceModel';
import { useAgentTeamFrameSelection, type AgentTeamFrameSelection } from './index';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('useAgentTeamFrameSelection', () => {
  it('selects the default task and clears an agent that disappears from the graph', () => {
    const task: AgentTeamTaskRecord = {
      id: 'task-1',
      teamId: 'team-1',
      title: 'Implement',
      description: '',
      status: 'todo',
      deps: [],
      createdBy: 'lead-1',
      createdAt: 1,
      updatedAt: 1,
    };
    const graphTask: AgentTeamGraphTask = {
      key: task.id,
      title: task.title,
      description: '',
      status: task.status,
      ownerName: 'Ada',
      ownerKey: 'agent:ada',
      depKeys: [],
      depLabels: [],
      artifactCount: 0,
      sourceTask: task,
    };
    const agent: AgentTeamGraphAgent = {
      key: 'agent:ada',
      name: 'Ada',
      role: 'teammate',
      status: 'idle',
      taskCount: 1,
      doneCount: 0,
      runningCount: 0,
      blockedCount: 0,
      artifactCount: 0,
    };
    let latest: AgentTeamFrameSelection | undefined;

    const Harness = ({ agents }: { agents: AgentTeamGraphAgent[] }) => {
      latest = useAgentTeamFrameSelection({
        phase: 'executing',
        artifacts: [],
        graphTasks: [graphTask],
        graphAgents: agents,
        orderedTasks: [task],
        taskById: new Map([[task.id, task]]),
        defaultTask: task,
      });
      return null;
    };

    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);

    act(() => root?.render(<Harness agents={[agent]} />));
    expect(latest?.selectedTask?.id).toBe('task-1');
    expect(latest?.selectedGraphTask?.key).toBe('task-1');

    act(() => latest?.selectGraphAgent(agent));
    expect(latest?.selectedAgentKey).toBe('agent:ada');
    expect(latest?.detailPanelMode).toBe('agent');

    act(() => root?.render(<Harness agents={[]} />));
    expect(latest?.selectedAgentKey).toBe('');
    expect(latest?.detailPanelMode).toBe('task');
    expect(latest?.agentInspectorOpen).toBe(false);
  });
});
