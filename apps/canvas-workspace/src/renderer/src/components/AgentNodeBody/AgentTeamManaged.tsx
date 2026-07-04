import type { ReactNode } from 'react';
import { AGENT_REGISTRY } from '../../config/agentRegistry';
import { AgentIcon } from './AgentIcon';
import { truncatePath } from './utils/terminal';
import { useI18n } from '../../i18n';
import type { I18nKey } from '../../i18n/messages';

interface AgentTeamManagedProps {
  agentType: string;
  cwd?: string;
  status?: string;
  lastPrompt?: string;
  recentActions?: string[];
  commandSlot?: ReactNode;
  onOpenTerminal?: () => void;
}

const leaderTitleKey = (status?: string): I18nKey => {
  if (status === 'running') return 'agentTeamManaged.leaderTitleRunning';
  if (status === 'done') return 'agentTeamManaged.leaderTitleDone';
  if (status === 'error') return 'agentTeamManaged.leaderTitleError';
  return 'agentTeamManaged.leaderTitleIdle';
};

const statusLabelKey = (status?: string): I18nKey => {
  if (status === 'running') return 'agentTeamManaged.statusRunning';
  if (status === 'done') return 'agentTeamManaged.statusDone';
  if (status === 'error') return 'agentTeamManaged.statusError';
  return 'agentTeamManaged.statusIdle';
};

export const AgentTeamManaged = ({
  agentType,
  cwd,
  status,
  lastPrompt,
  recentActions,
  commandSlot,
  onOpenTerminal,
}: AgentTeamManagedProps) => {
  const { t } = useI18n();
  const agentDef = AGENT_REGISTRY.find((agent) => agent.id === agentType);
  const displayCwd = cwd ? truncatePath(cwd, 40) : t('agentTeamManaged.workspaceRootFallback');
  const summarizedPrompt =
    lastPrompt?.trim().replace(/\s+/g, ' ').slice(0, 160) || t('agentTeamManaged.waitingForCommand');
  const actionItems = (recentActions && recentActions.length > 0
    ? recentActions
    : [t('agentTeamManaged.waitingForUpdates')]
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
            <div className="agent-team-managed__title">{t(leaderTitleKey(status))}</div>
            <span className="agent-team-managed__status">{t(statusLabelKey(status))}</span>
          </div>

          <div className="agent-team-managed__facts">
            <div className="agent-team-managed__fact agent-team-managed__fact--decision">
              <span>{t('agentTeamManaged.decision')}</span>
              <strong title={lastPrompt?.trim() || undefined}>{summarizedPrompt}</strong>
            </div>
            <div className="agent-team-managed__fact">
              <span>{t('agentTeamManaged.activity')}</span>
              <strong title={latestAction}>{latestAction}</strong>
            </div>
            <div className="agent-team-managed__fact">
              <span>{t('agentTeamManaged.agent')}</span>
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
              {t('agentTeamManaged.advancedTerminal')}
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
