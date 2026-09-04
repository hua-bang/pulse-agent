import type { AgentNodeData } from '../../../types';

const TEAM_AUTO_RESUME_MAX_ATTEMPTS = 2;
const TEAM_AUTO_RESUME_RETRY_AFTER_MS = 8_000;
const CLEAR_TERMINAL_COMMAND = "printf '\\033[2J\\033[H'";

const shellQuote = (value: string): string => `'${value.replace(/'/g, "'\\''")}'`;

const hasQueuedLaunchPrompt = (data: AgentNodeData): boolean =>
  !!(data.inlinePrompt?.trim() || data.promptFile?.trim());

const hasTeamWarmupLaunch = (data: AgentNodeData): boolean =>
  !!data.agentTeamId && data.agentTeamWarmup === true;

export type CodingAgentView = 'setup' | 'running' | 'restart';

export const resolveCodingAgentView = (data: AgentNodeData): CodingAgentView => {
  if (data.viewMode) return data.viewMode;
  const hasPriorSession = !!data.sessionId || !!data.scrollback;
  if (hasPriorSession) return 'restart';
  if (data.status === 'running' || data.status === 'done' || data.status === 'error') return 'running';
  return 'setup';
};

export interface CodingAgentResumeBinding {
  canResume: boolean;
  sessionKey: string | undefined;
}

/** The only persisted identifiers that may address a previous CLI conversation. */
export const getCodingAgentResumeBinding = (data: AgentNodeData): CodingAgentResumeBinding => {
  const sessionKey = data.agentType === 'claude-code'
    ? data.cliSessionId
    : data.agentType === 'codex'
      ? data.codexSessionId
      : data.agentType === 'pi'
        ? data.piSessionKey
        : undefined;
  return { canResume: !!sessionKey, sessionKey };
};

export const shouldAutoResumeCodingAgentSession = (data: AgentNodeData): boolean => {
  if (data.status !== 'running' || data.viewMode !== 'running') return false;
  if (hasQueuedLaunchPrompt(data) || hasTeamWarmupLaunch(data)) return false;
  if (!data.sessionId && !data.scrollback) return false;
  return getCodingAgentResumeBinding(data).canResume;
};

export const shouldConsiderTeamAutoResume = (data: AgentNodeData): boolean => {
  if (!getCodingAgentResumeBinding(data).canResume) return false;
  if (hasQueuedLaunchPrompt(data)) return false;
  return data.viewMode !== 'setup';
};

export interface TeamAutoResumeDecision {
  eligible: boolean;
  retryAfterMs: number | null;
}

export const getTeamAutoResumeDecision = (
  data: AgentNodeData,
  now = Date.now(),
): TeamAutoResumeDecision => {
  const { sessionKey } = getCodingAgentResumeBinding(data);
  if (!sessionKey) return { eligible: false, retryAfterMs: null };
  const previous = data.agentTeamAutoResume;
  if (previous?.sessionKey !== sessionKey) return { eligible: true, retryAfterMs: null };
  if ((previous?.attempts ?? 0) < TEAM_AUTO_RESUME_MAX_ATTEMPTS) {
    return { eligible: true, retryAfterMs: null };
  }
  const retryAfterMs = previous.lastAttemptAt
    ? Math.max(0, TEAM_AUTO_RESUME_RETRY_AFTER_MS - (now - previous.lastAttemptAt))
    : 0;
  return { eligible: retryAfterMs === 0, retryAfterMs };
};

export const nextTeamAutoResumeState = (
  data: AgentNodeData,
  now = Date.now(),
): NonNullable<AgentNodeData['agentTeamAutoResume']> => {
  const { sessionKey } = getCodingAgentResumeBinding(data);
  const previous = data.agentTeamAutoResume;
  const previousExpired = previous?.lastAttemptAt
    ? now - previous.lastAttemptAt >= TEAM_AUTO_RESUME_RETRY_AFTER_MS
    : false;
  const attempts = previous?.sessionKey === sessionKey && !previousExpired
    ? previous?.attempts ?? 0
    : 0;
  return { sessionKey, attempts: attempts + 1, lastAttemptAt: now };
};

export interface CodingAgentLaunchCommandRequest {
  agentType: string;
  command: string | undefined;
  resume: boolean;
  cliSessionId?: string;
  codexSessionId?: string;
  piFlags?: string;
  prompt?: string;
  promptFile?: string;
  codexBindingPrompt?: string;
  dangerousMode?: boolean;
  agentArgs?: string;
  teamManaged?: boolean;
}

export type CodingAgentLaunchCommandPlan =
  | { commandLine: string }
  | { error: 'unknown-agent' | 'missing-codex-session' };

/**
 * Produces the one shell command that starts or resumes a coding CLI.
 * It never invents a "latest" session fallback: resume requires a node-owned
 * binding supplied by the caller.
 */
export const planCodingAgentLaunchCommand = (
  request: CodingAgentLaunchCommandRequest,
): CodingAgentLaunchCommandPlan => {
  if (!request.command) return { error: 'unknown-agent' };

  const effectivePrompt = request.prompt ?? '';
  const bindingPrompt = request.codexBindingPrompt ?? '';
  const promptForCommand = bindingPrompt && effectivePrompt
    ? `${effectivePrompt}\n\n${bindingPrompt}`
    : bindingPrompt && !request.promptFile
      ? bindingPrompt
      : effectivePrompt;
  const dangerousFlag = request.dangerousMode
    ? request.agentType === 'claude-code'
      ? ' --dangerously-skip-permissions'
      : request.agentType === 'codex'
        ? ' --dangerously-bypass-approvals-and-sandbox'
        : ''
    : '';
  const commonFlags = dangerousFlag + (request.agentArgs ? ` ${request.agentArgs}` : '');
  const teamExitSuffix = request.teamManaged ? '; exit' : '';

  if (
    request.agentType === 'claude-code'
    && request.resume
    && request.cliSessionId
    && !effectivePrompt
    && !request.promptFile
  ) {
    return {
      commandLine: `${CLEAR_TERMINAL_COMMAND}; ${request.command} --resume ${request.cliSessionId}${commonFlags}${teamExitSuffix}\n`,
    };
  }

  if (
    request.agentType === 'codex'
    && request.resume
    && !effectivePrompt
    && !request.promptFile
  ) {
    if (!request.codexSessionId) return { error: 'missing-codex-session' };
    return {
      commandLine: `${CLEAR_TERMINAL_COMMAND}; ${request.command}${commonFlags} resume ${shellQuote(request.codexSessionId)}${teamExitSuffix}\n`,
    };
  }

  const flags = (
    request.agentType === 'claude-code'
      ? ` ${request.resume && request.cliSessionId ? '--resume' : '--session-id'} ${request.cliSessionId ?? ''}`
      : request.piFlags ?? ''
  ) + commonFlags;

  if (promptForCommand) {
    return {
      commandLine: `${CLEAR_TERMINAL_COMMAND}; ${request.command}${flags} ${shellQuote(promptForCommand)}${teamExitSuffix}\n`,
    };
  }
  if (request.promptFile) {
    if (bindingPrompt) {
      return {
        commandLine: `__prompt=$(printf '%s\\n\\n%s' "$(cat ${shellQuote(request.promptFile)})" ${shellQuote(bindingPrompt)}) && ${CLEAR_TERMINAL_COMMAND} && ${request.command}${flags} "$__prompt"${teamExitSuffix}\n`,
      };
    }
    return {
      commandLine: `__prompt=$(cat ${request.promptFile}) && ${CLEAR_TERMINAL_COMMAND} && ${request.command}${flags} "$__prompt"${teamExitSuffix}\n`,
    };
  }
  return {
    commandLine: `${CLEAR_TERMINAL_COMMAND}; ${request.command}${flags}${teamExitSuffix}\n`,
  };
};
