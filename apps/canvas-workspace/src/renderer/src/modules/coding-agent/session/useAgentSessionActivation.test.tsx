// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import type { AgentNodeData } from '../../../types';
import { useAgentSessionActivation } from '..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('agent session activation', () => {
  it('prepares an eligible team session and emits one resumable launch intent', async () => {
    const onActivate = vi.fn();
    const api = { prepareAgentAutoResume: vi.fn().mockResolvedValue({ ok: true, canResume: true }) };
    const data: AgentNodeData = {
      agentType: 'claude-code', sessionId: 'pty-old', cliSessionId: 'claude-1',
      status: 'done', viewMode: 'restart', cwd: '/repo',
      agentTeamId: 'team-1', agentTeamAgentId: 'agent-1',
    };
    const Harness = () => {
      useAgentSessionActivation({
        data,
        viewMode: 'restart',
        disabled: false,
        teamManaged: true,
        workspaceId: 'workspace-1',
        rootFolder: '/repo',
        api,
        onActivate,
      });
      return null;
    };
    const root = createRoot(document.createElement('div'));
    await act(async () => { root.render(<Harness />); });
    await act(async () => { await Promise.resolve(); });
    expect(api.prepareAgentAutoResume).toHaveBeenCalledWith('workspace-1', 'team-1', 'agent-1');
    expect(onActivate).toHaveBeenCalledWith(expect.objectContaining({
      agentType: 'claude-code', cwd: '/repo', prompt: '', resume: true, mintSession: true,
      nextData: expect.objectContaining({ status: 'running', inlinePrompt: '', promptFile: '' }),
    }));
    await act(async () => { root.unmount(); });
  });
});
