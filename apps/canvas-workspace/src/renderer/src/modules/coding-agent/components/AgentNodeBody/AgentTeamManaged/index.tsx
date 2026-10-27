import './index.css';
import type { ReactNode } from 'react';
import { AGENT_REGISTRY } from '../../../../../config/agentRegistry';
import { AgentIcon } from '../AgentIcon';
import { truncatePath } from '../utils/terminal';
import { useI18n } from '../../../../../i18n';
import { agentCardCopy, type AgentCardCopy } from '../copy';

interface AgentTeamManagedProps {
  agentType: string;
  cwd?: string;
  status?: string;
  lastPrompt?: string;
  recentActions?: string[];
  commandSlot?: ReactNode;
  onOpenTerminal?: () => void;
}

const leaderTitle = (copy: AgentCardCopy, status?: string): string => {
  if (status === 'running') return copy.leaderRunning;
  if (status === 'done') return copy.leaderDone;
  if (status === 'error') return copy.leaderError;
  return copy.leaderIdle;
};

const statusLabel = (copy: AgentCardCopy, status?: string): string => {
  if (status === 'running') return copy.statusRunning;
  if (status === 'done') return copy.statusDone;
  if (status === 'error') return copy.statusError;
  return copy.statusIdle;
};

const summarizePrompt = (copy: AgentCardCopy, prompt?: string): string =>
  prompt?.trim().replace(/\s+/g, ' ').slice(0, 160) || copy.waitingCommand;

export const AgentTeamManaged = ({
  agentType,
  cwd,
  status,
  lastPrompt,
  recentActions,
  commandSlot,
  onOpenTerminal,
}: AgentTeamManagedProps) => {
  const copy = agentCardCopy(useI18n().language);
  const agentDef = AGENT_REGISTRY.find((agent) => agent.id === agentType);
  const displayCwd = cwd ? truncatePath(cwd, 40) : copy.workspaceRoot;
  const actionItems = (recentActions && recentActions.length > 0
    ? recentActions
    : [copy.waitingUpdates]
  ).slice(0, 3);
  const latestAction = actionItems[0];

  const statusClass = status ? `agent-team-managed--${status}` : 'agent-team-managed--idle';

  return (
    <div className="agent-body-wrap agent-body-wrap--team-managed">
      <div className="agent-card agent-card--team-managed">
        <div className={`agent-team-managed ${statusClass}`}>
          <div className="agent-team-managed__header">
            <div className="agent-team-managed__icon">
              <AgentIcon id={agentType} size={20} />
            </div>
            <div className="agent-team-managed__title">{leaderTitle(copy, status)}</div>
            <span className="agent-team-managed__status">{statusLabel(copy, status)}</span>
          </div>

          <div className="agent-team-managed__facts">
            <div className="agent-team-managed__fact agent-team-managed__fact--decision">
              <span>{copy.decision}</span>
              <strong title={lastPrompt?.trim() || undefined}>{summarizePrompt(copy, lastPrompt)}</strong>
            </div>
            <div className="agent-team-managed__fact">
              <span>{copy.activity}</span>
              <strong title={latestAction}>{latestAction}</strong>
            </div>
            <div className="agent-team-managed__fact">
              <span>{copy.agent}</span>
              <strong title={cwd}>{agentDef?.label ?? agentType} · {displayCwd}</strong>
            </div>
          </div>

          {commandSlot && (
            <div className="agent-team-managed__command">
              {commandSlot}
            </div>
          )}

          {onOpenTerminal && (
            <button type="button" className="agent-team-managed__terminal-button" onClick={onOpenTerminal}>
              {copy.advancedTerminal}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

