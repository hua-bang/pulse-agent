// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { AgentDetail, recentAgentActivity, type AgentDetailModel } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const detail: AgentDetailModel = {
  agent: {
    key: 'agent:ada',
    name: 'Ada',
    role: 'teammate',
    agentType: 'codex',
    status: 'working',
    taskCount: 2,
    doneCount: 1,
    runningCount: 1,
    blockedCount: 0,
    artifactCount: 1,
    currentTaskTitle: 'Extract renderer module',
  },
  tasks: [{
    key: 'task-1',
    title: 'Extract renderer module',
    description: 'Move the visual boundary.',
    status: 'in_progress',
    ownerName: 'Ada',
    ownerKey: 'agent:ada',
    depKeys: [],
    depLabels: [],
    artifactCount: 1,
  }],
  artifacts: [{
    id: 'artifact-1',
    teamId: 'team-1',
    agentId: 'ada',
    kind: 'file',
    title: 'migration.md',
    createdAt: 1,
  }],
  activityLines: ['Implemented the public seam'],
  workspaceLabel: '/repo/pulse-agent',
};

describe('AgentDetail', () => {
  it('projects recent readable terminal activity without ANSI noise or duplicates', () => {
    expect(recentAgentActivity([
      '\u001b[32mImplemented the public seam\u001b[0m',
      'working',
      'Implemented the public seam',
      'Validated owner-local tests',
    ].join('\n'))).toEqual([
      'Implemented the public seam',
      'Validated owner-local tests',
    ]);
  });

  it('shows the selected agent activity and delegates task and artifact selection', async () => {
    const onSelectTask = vi.fn();
    const onSelectArtifact = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => {
      root.render(
        <AgentDetail
          detail={detail}
          mode="activity"
          onModeChange={vi.fn()}
          onExpand={vi.fn()}
          onSelectTask={onSelectTask}
          onSelectArtifact={onSelectArtifact}
        />,
      );
    });

    expect(host.textContent).toContain('Ada');
    expect(host.textContent).toContain('Extract renderer module');
    expect(host.textContent).toContain('migration.md');
    expect(host.textContent).toContain('Implemented the public seam');

    const buttons = [...host.querySelectorAll<HTMLButtonElement>('button')];
    await act(async () => {
      buttons.find((button) => button.textContent?.includes('Extract renderer module'))?.click();
      buttons.find((button) => button.textContent?.includes('migration.md'))?.click();
    });
    expect(onSelectTask).toHaveBeenCalledWith(detail.tasks[0]);
    expect(onSelectArtifact).toHaveBeenCalledWith(detail.artifacts[0]);

    await act(async () => { root.unmount(); });
  });
});
