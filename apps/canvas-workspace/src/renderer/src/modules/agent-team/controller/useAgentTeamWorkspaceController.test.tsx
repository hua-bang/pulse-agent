// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { AgentTeamSnapshot, AgentTeamsApi } from '../../../types';
import { useAgentTeamWorkspaceController } from './useAgentTeamWorkspaceController';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const makeSnapshot = (status: 'running' | 'paused'): AgentTeamSnapshot => ({
  workspaceId: 'workspace-1',
  phase: 'executing',
  runtime: {
    team: { id: 'team-1', name: 'Team', goal: 'Ship', status, createdAt: 1, updatedAt: 1 },
    agents: [], tasks: [], artifacts: [], humanGates: [], events: [], messages: [],
  },
});

describe('useAgentTeamWorkspaceController', () => {
  it('owns snapshot mutations for team commands', async () => {
    const pause = vi.fn().mockResolvedValue({ ok: true, snapshot: makeSnapshot('paused') });
    const api = { pause } as unknown as AgentTeamsApi;
    let controller: ReturnType<typeof useAgentTeamWorkspaceController> | undefined;
    const Harness = () => {
      controller = useAgentTeamWorkspaceController({
        api,
        workspaceId: 'workspace-1',
        teamId: 'team-1',
        workspaceActive: false,
      });
      return <output>{controller.snapshot?.runtime.team.status ?? 'empty'}</output>;
    };
    const host = document.createElement('div');
    const root = createRoot(host);
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await controller?.pauseTeam(); });
    expect(pause).toHaveBeenCalledWith('workspace-1', 'team-1');
    expect(host.textContent).toBe('paused');
    expect(controller?.teamAction).toBeNull();
    await act(async () => { root.unmount(); });
  });
});
