import { describe, expect, it } from 'vitest';
import type { AgentNodeData } from '../../../types';
import {
  getCodingAgentResumeBinding,
  getTeamAutoResumeDecision,
  nextTeamAutoResumeState,
  planCodingAgentLaunchCommand,
} from '..';

const agent = (patch: Partial<AgentNodeData> = {}): AgentNodeData => ({
  agentType: 'claude-code',
  sessionId: 'pty-1',
  status: 'running',
  viewMode: 'running',
  ...patch,
});

describe('coding-agent session lifecycle', () => {
  it('addresses each CLI conversation only through its persisted binding', () => {
    expect(getCodingAgentResumeBinding(agent({ cliSessionId: 'claude-1' })))
      .toEqual({ canResume: true, sessionKey: 'claude-1' });
    expect(getCodingAgentResumeBinding(agent({ agentType: 'codex', codexSessionId: 'codex-1' })))
      .toEqual({ canResume: true, sessionKey: 'codex-1' });
    expect(getCodingAgentResumeBinding(agent({ agentType: 'pi', piSessionKey: 'pi-1' })))
      .toEqual({ canResume: true, sessionKey: 'pi-1' });
    expect(getCodingAgentResumeBinding(agent({ agentType: 'codex' })))
      .toEqual({ canResume: false, sessionKey: undefined });
  });

  it('builds fresh and resumable commands without falling back to a global latest session', () => {
    expect(planCodingAgentLaunchCommand({
      agentType: 'claude-code', command: 'claude', cliSessionId: 'claude-1',
      resume: false, dangerousMode: true,
    })).toEqual({
      commandLine: "printf '\\033[2J\\033[H'; claude --session-id claude-1 --dangerously-skip-permissions\n",
    });
    expect(planCodingAgentLaunchCommand({
      agentType: 'claude-code', command: 'claude', cliSessionId: 'claude-1', resume: true,
    })).toEqual({
      commandLine: "printf '\\033[2J\\033[H'; claude --resume claude-1\n",
    });
    expect(planCodingAgentLaunchCommand({
      agentType: 'codex', command: 'codex', resume: true,
    })).toEqual({ error: 'missing-codex-session' });
    expect(planCodingAgentLaunchCommand({
      agentType: 'pi', command: 'pi', resume: true,
      piFlags: ' --session-dir "$HOME/.pi/agent/sessions/pulse-canvas/pi-1" --continue',
      teamManaged: true,
    })).toEqual({
      commandLine: "printf '\\033[2J\\033[H'; pi --session-dir \"$HOME/.pi/agent/sessions/pulse-canvas/pi-1\" --continue; exit\n",
    });
  });

  it('backs off team auto-resume after two attempts and resets after the retry window', () => {
    const data = agent({
      agentTeamId: 'team-1',
      agentTeamAgentId: 'agent-1',
      cliSessionId: 'claude-1',
      agentTeamAutoResume: { sessionKey: 'claude-1', attempts: 2, lastAttemptAt: 1_000 },
    });
    expect(getTeamAutoResumeDecision(data, 5_000)).toEqual({
      eligible: false,
      retryAfterMs: 4_000,
    });
    expect(getTeamAutoResumeDecision(data, 9_000)).toEqual({
      eligible: true,
      retryAfterMs: 0,
    });
    expect(nextTeamAutoResumeState(data, 9_000)).toEqual({
      sessionKey: 'claude-1',
      attempts: 1,
      lastAttemptAt: 9_000,
    });
  });
});
