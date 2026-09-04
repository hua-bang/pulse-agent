// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import { buildAgentTeamDagLayout, type AgentTeamGraphTask } from '../../model/workspaceModel';
import { TaskDagCanvas } from '.';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('TaskDagCanvas', () => {
  it('renders selected task/owner state and delegates task selection', async () => {
    const first: AgentTeamGraphTask = {
      key: 'build', title: 'Build', description: '', status: 'done', ownerName: 'Ada',
      ownerKey: 'agent:ada', depKeys: [], depLabels: [], artifactCount: 0,
    };
    const second: AgentTeamGraphTask = {
      key: 'verify', title: 'Verify', description: '', status: 'in_progress', ownerName: 'Ada',
      ownerKey: 'agent:ada', depKeys: ['build'], depLabels: ['Build'], artifactCount: 0,
    };
    const layout = buildAgentTeamDagLayout([{ round: 1, columns: [[first], [second]] }]);
    const onSelectTask = vi.fn();
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => {
      root.render(
        <TaskDagCanvas
          layout={layout}
          markerId="arrow"
          selectedTask={second}
          selectedAgentKey="agent:ada"
          agentTypeByOwnerKey={new Map([['agent:ada', 'codex']])}
          onSelectTask={onSelectTask}
        />,
      );
    });
    const verify = [...host.querySelectorAll<HTMLButtonElement>('button')]
      .find((button) => button.title === 'Verify');
    expect(verify?.className).toContain('agent-team-dag-node--selected');
    expect(verify?.className).toContain('agent-team-dag-node--owner-highlight');
    expect(host.querySelector('.agent-team-dag-edge--highlighted')).toBeTruthy();
    await act(async () => { verify?.click(); });
    expect(onSelectTask).toHaveBeenCalledWith(second);
    await act(async () => { root.unmount(); });
  });
});
