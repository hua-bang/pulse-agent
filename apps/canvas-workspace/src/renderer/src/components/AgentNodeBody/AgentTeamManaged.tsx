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

const leaderBody = (status?: string): string => {
  if (status === 'running') {
    return 'Use the team command bar for normal changes. Open the terminal only when you want to inspect or debug the leader directly.';
  }
  if (status === 'done') {
    return 'The last leader run has finished. New instructions should still go through the team command bar.';
  }
  if (status === 'error') {
    return 'The leader terminal reported an error. Open the advanced terminal to inspect or restart it.';
  }
  return 'Use the team frame to ask for a plan. This agent will start automatically and turn the brief into teammates and tasks.';
};

const summarizePrompt = (prompt?: string): string =>
  prompt?.trim().replace(/\s+/g, ' ').slice(0, 120) || 'Waiting for the next team command.';

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
  const displayCwd = cwd ? truncatePath(cwd, 36) : 'workspace root';
  const actionItems = recentActions && recentActions.length > 0
    ? recentActions
    : ['Waiting for team updates.'];

  return (
    <div className="agent-body-wrap agent-body-wrap--team-managed">
      <div className="agent-card agent-card--team-managed">
        <div className="agent-team-managed">
          <div className="agent-team-managed__icon">
            <AgentIcon id={agentType} size={22} />
          </div>
          <div className="agent-team-managed__copy">
            <div className="agent-team-managed__eyebrow">Team Leader</div>
            <div className="agent-team-managed__title">{leaderTitle(status)}</div>
            <div className="agent-team-managed__body">
              {leaderBody(status)}
            </div>
            <div className="agent-team-managed__decision">
              <span>Current decision</span>
              <strong>{summarizePrompt(lastPrompt)}</strong>
            </div>
            <div className="agent-team-managed__actions">
              <span>Recent actions</span>
              <ul>
                {actionItems.map((action) => (
                  <li key={action}>{action}</li>
                ))}
              </ul>
            </div>
            <div className="agent-team-managed__meta">
              {agentDef?.label ?? agentType} · {displayCwd}
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
    </div>
  );
};
