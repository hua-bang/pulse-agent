// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { TaskWorkspace, type TaskWorkspaceActions, type TaskWorkspaceView } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TaskWorkspace', () => {
  it('owns the empty graph state and delegates agent selection', async () => {
    const selectAgent = vi.fn();
    const view: TaskWorkspaceView = {
      markerId: 'team-1-arrow',
      phase: 'briefing',
      graphTitle: 'Task graph',
      graphSubtitle: 'Brief Team Lead to generate a plan.',
      rounds: [],
      roundOptions: [],
      agents: [{ key: 'agent:ada', name: 'Ada', role: 'teammate', status: 'idle', taskCount: 0, doneCount: 0, runningCount: 0, blockedCount: 0, artifactCount: 0 }],
      selectedAgentKey: '',
      agentTypeByOwnerKey: new Map(),
      detailMode: 'task',
      agentViewMode: 'activity',
      taskArtifacts: [],
      readOnly: false,
      agentOptions: [],
      planAction: null,
    };
    const actions: TaskWorkspaceActions = {
      selectTask: vi.fn(),
      selectAgent,
      changeAgentType: vi.fn(),
      changeDetailMode: vi.fn(),
      changeAgentViewMode: vi.fn(),
      expandAgent: vi.fn(),
      selectArtifact: vi.fn(),
      confirmPlan: vi.fn(),
      advanceRound: vi.fn(),
      finalizeCheckpoint: vi.fn(),
    };
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => { root.render(<TaskWorkspace view={view} actions={actions} />); });
    expect(host.textContent).toContain('Waiting for Team Lead to propose tasks.');
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Select Ada"]')?.click(); });
    expect(selectAgent).toHaveBeenCalledWith(view.agents[0]);
    await act(async () => { root.unmount(); });
  });
});
