import { useEffect, useState } from 'react';
import { getAgentCommand } from '../../../config/agentRegistry';
import type { AgentNodeData, AgentTeamsApi } from '../../../types';
import {
  getCodingAgentResumeBinding,
  getTeamAutoResumeDecision,
  nextTeamAutoResumeState,
  shouldConsiderTeamAutoResume,
} from './sessionLifecycle';

const DEFAULT_AGENT_TYPE = 'claude-code';
const normalizeAgentType = (agentType?: string): string =>
  agentType && getAgentCommand(agentType) ? agentType : DEFAULT_AGENT_TYPE;
const hasQueuedLaunchPrompt = (data: AgentNodeData): boolean =>
  !!(data.inlinePrompt?.trim() || data.promptFile?.trim());
const hasTeamWarmupLaunch = (data: AgentNodeData): boolean =>
  !!data.agentTeamId && data.agentTeamWarmup === true;

export interface AgentSessionActivationIntent {
  agentType: string;
  cwd: string;
  prompt: string;
  resume: boolean;
  mintSession: boolean;
  nextData?: AgentNodeData;
}

interface UseAgentSessionActivationOptions {
  data: AgentNodeData;
  viewMode: 'setup' | 'running' | 'restart';
  disabled: boolean;
  teamManaged: boolean;
  workspaceId?: string;
  rootFolder?: string;
  api?: Pick<AgentTeamsApi, 'prepareAgentAutoResume'>;
  onActivate: (intent: AgentSessionActivationIntent) => void;
}

export const useAgentSessionActivation = ({
  data,
  viewMode,
  disabled,
  teamManaged,
  workspaceId,
  rootFolder,
  api,
  onActivate,
}: UseAgentSessionActivationOptions): { pending: boolean } => {
  const [pending, setPending] = useState(false);
  const [retryTick, setRetryTick] = useState(0);

  useEffect(() => {
    if (disabled || viewMode === 'running') return;
    if (data.viewMode !== 'running' && data.status !== 'running') return;
    const hasPrompt = hasQueuedLaunchPrompt(data);
    const resume = !teamManaged && !hasPrompt && getCodingAgentResumeBinding(data).canResume;
    if (!hasPrompt && !hasTeamWarmupLaunch(data) && !resume) return;
    onActivate({
      agentType: normalizeAgentType(data.agentType),
      cwd: data.cwd || rootFolder || '',
      prompt: data.inlinePrompt || '',
      resume,
      mintSession: hasTeamWarmupLaunch(data),
    });
  }, [
    data.agentTeamWarmup,
    data.agentType,
    data.cliSessionId,
    data.codexSessionId,
    data.cwd,
    data.inlinePrompt,
    data.piSessionKey,
    data.promptFile,
    data.status,
    data.viewMode,
    disabled,
    onActivate,
    rootFolder,
    teamManaged,
    viewMode,
  ]);

  useEffect(() => {
    if (disabled || !teamManaged || viewMode === 'running') return;
    if (!workspaceId || !data.agentTeamId || !data.agentTeamAgentId || !api) return;
    if (!shouldConsiderTeamAutoResume(data)) return;
    const decision = getTeamAutoResumeDecision(data);
    if (!decision.eligible) {
      if (decision.retryAfterMs != null) {
        setPending(true);
        const timer = setTimeout(() => setRetryTick((tick) => tick + 1), decision.retryAfterMs);
        return () => clearTimeout(timer);
      }
      return;
    }

    let cancelled = false;
    setPending(true);
    void api.prepareAgentAutoResume(
      workspaceId,
      data.agentTeamId,
      data.agentTeamAgentId,
    ).catch(() => null).then((result) => {
      if (cancelled) return;
      if (!result?.ok || !result.canResume) {
        setPending(false);
        return;
      }
      onActivate({
        agentType: normalizeAgentType(data.agentType),
        cwd: data.cwd || rootFolder || '',
        prompt: '',
        resume: true,
        mintSession: true,
        nextData: {
          ...data,
          status: 'running',
          inlinePrompt: '',
          promptFile: '',
          agentTeamAutoResume: nextTeamAutoResumeState(data),
        },
      });
      setPending(false);
    });
    return () => {
      cancelled = true;
      setPending(false);
    };
  }, [
    api,
    data,
    disabled,
    onActivate,
    retryTick,
    rootFolder,
    teamManaged,
    viewMode,
    workspaceId,
  ]);

  return { pending };
};
