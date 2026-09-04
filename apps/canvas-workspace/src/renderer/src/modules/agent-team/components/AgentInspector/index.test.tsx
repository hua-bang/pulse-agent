// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { AgentDetailModel } from '../AgentDetail';
import { AgentInspector } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('AgentInspector', () => {
  it('delegates navigation and view changes from the large agent surface', async () => {
    const onClose = vi.fn();
    const onModeChange = vi.fn();
    const onSelectTask = vi.fn();
    const detail: AgentDetailModel = {
      agent: { key: 'agent:ada', name: 'Ada', role: 'teammate', status: 'working', taskCount: 1, doneCount: 0, runningCount: 1, blockedCount: 0, artifactCount: 0 },
      tasks: [{ key: 'task-1', title: 'Split inspector', description: '', status: 'in_progress', ownerName: 'Ada', depKeys: [], depLabels: [], artifactCount: 0 }],
      artifacts: [],
      activityLines: ['Extracting visual module'],
      workspaceLabel: '/repo',
    };
    const host = document.createElement('div');
    const root = createRoot(host);

    await act(async () => {
      root.render(<AgentInspector detail={detail} mode="activity" onClose={onClose} onModeChange={onModeChange} onSelectTask={onSelectTask} onSelectArtifact={vi.fn()} />);
    });

    expect(host.querySelector('[role="dialog"]')?.getAttribute('aria-label')).toBe('Agent detail');
    expect(host.textContent).toContain('Extracting visual module');
    await act(async () => {
      [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Close')?.click();
      [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.includes('Split inspector'))?.click();
      [...host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Terminal')?.click();
    });
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelectTask).toHaveBeenCalledWith(detail.tasks[0]);
    expect(onModeChange).toHaveBeenCalledWith('terminal');

    await act(async () => { root.unmount(); });
  });
});
