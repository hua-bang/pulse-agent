import type { ReactNode } from 'react';
import { AGENT_REGISTRY } from '../../config/agentRegistry';
import { AgentIcon } from './AgentIcon';
import { truncatePath } from './utils/terminal';

interface AgentTeamManagedProps {
  agentType: string;
  cwd?: string;
  status?: string;
  lastPrompt?: string;
  recentActions?: string[];
  commandSlot?: ReactNode;
  onOpenTerminal?: () => void;
}

const leaderTitle = (status?: string): string => {
  if (status === 'running') return 'Coordinating team work';
  if (status === 'done') return 'Leader run finished';
  if (status === 'error') return 'Leader needs attention';
  return 'Waiting for a brief';
};

const statusLabel = (status?: string): string => {
  if (status === 'running') return 'Running';
  if (status === 'done') return 'Done';
  if (status === 'error') return 'Error';
  return 'Idle';
};

const summarizePrompt = (prompt?: string): string =>
  prompt?.trim().replace(/\s+/g, ' ').slice(0, 160) || 'Waiting for the next team command.';

export const AgentTeamManaged = ({
  agentType,
  cwd,
  status,
  lastPrompt,
  recentActions,
  commandSlot,
  onOpenTerminal,
}: AgentTeamManagedProps) => {
  const agentDef = AGENT_REGISTRY.find((agent) => agent.id === agentType);
  const displayCwd = cwd ? truncatePath(cwd, 40) : 'workspace root';
  const actionItems = (recentActions && recentActions.length > 0
    ? recentActions
    : ['Waiting for team updates.']
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
            <div className="agent-team-managed__title">{leaderTitle(status)}</div>
            <span className="agent-team-managed__status">{statusLabel(status)}</span>
          </div>

          <div className="agent-team-managed__facts">
            <div className="agent-team-managed__fact agent-team-managed__fact--decision">
              <span>Decision</span>
              <strong title={lastPrompt?.trim() || undefined}>{summarizePrompt(lastPrompt)}</strong>
            </div>
            <div className="agent-team-managed__fact">
              <span>Activity</span>
              <strong title={latestAction}>{latestAction}</strong>
            </div>
            <div className="agent-team-managed__fact">
              <span>Agent</span>
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
              Advanced terminal
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
