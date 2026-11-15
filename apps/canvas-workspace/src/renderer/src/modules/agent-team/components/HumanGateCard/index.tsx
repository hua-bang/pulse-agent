import './index.css';
import type {
  AgentTeamAgentRecord,
  AgentTeamHumanGateRecord,
  AgentTeamTaskRecord,
} from '../../../../types';
import type { AgentTeamGraphTask } from '../../model/workspaceModel';
import { useI18n } from '../../../../i18n';
import { isImeComposing } from '../../../../utils/ime';
import { hasConcreteHumanGatePrompt } from '../../model/humanGates';

export { hasConcreteHumanGatePrompt, isHumanFacingGate } from '../../model/humanGates';

interface Props {
  gate: AgentTeamHumanGateRecord;
  agent?: AgentTeamAgentRecord;
  task?: AgentTeamTaskRecord;
  graphTask?: AgentTeamGraphTask;
  selectedTaskId?: string;
  answer: string;
  compact?: boolean;
  readOnly?: boolean;
  onAnswerChange: (answer: string) => void;
  onAnswer: () => void;
  onViewTask: (task: AgentTeamGraphTask) => void;
}

export const HumanGateCard = ({
  gate,
  agent,
  task,
  graphTask,
  selectedTaskId,
  answer,
  compact = false,
  readOnly = false,
  onAnswerChange,
  onAnswer,
  onViewTask,
}: Props) => {
  const { t } = useI18n();
  const hasPrompt = hasConcreteHumanGatePrompt(gate.prompt);
  const displayedPrompt = hasPrompt ? gate.prompt : t('agentTeam.gate.missingPrompt');
  const canAnswer = !readOnly && answer.trim().length > 0;
  const reason = gate.reason?.trim();
  const showReason = !!reason && reason !== gate.prompt && !/^agent requested human input\.?$/i.test(reason);
  return (
    <div className={`agent-team-human-gate${compact ? ' agent-team-human-gate--compact' : ''}${hasPrompt ? '' : ' agent-team-human-gate--missing-prompt'}`}>
      <div className="agent-team-human-gate__copy">
        <span className="agent-team-detail__section-title">{t('agentTeam.gate.title')}</span>
        <strong>{displayedPrompt}</strong>
        <span className="agent-team-human-gate__meta">
          {agent ? t('agentTeam.gate.from', { name: agent.name }) : t('agentTeam.gate.fromTeammate')}
          {task ? ` · ${t('agentTeam.gate.task', { title: task.title })}` : ''}
          {showReason ? ` · ${reason}` : ''}
        </span>
        {!hasPrompt && (
          <span className="agent-team-human-gate__hint">
            {t('agentTeam.gate.missingHint')}
          </span>
        )}
      </div>
      <div className="agent-team-human-gate__actions">
        {graphTask && selectedTaskId !== gate.taskId && (
          <button type="button" onClick={() => onViewTask(graphTask)}>{t('agentTeam.gate.viewTask')}</button>
        )}
        <input
          value={answer}
          onChange={(event) => onAnswerChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || isImeComposing(event.nativeEvent)) return;
            event.preventDefault();
            if (canAnswer) onAnswer();
          }}
          placeholder={hasPrompt ? t('agentTeam.gate.answerPlaceholder') : t('agentTeam.gate.clarifyPlaceholder')}
          disabled={readOnly}
        />
        <button type="button" onClick={onAnswer} disabled={!canAnswer}>
          {t('agentTeam.gate.answer')}
        </button>
      </div>
    </div>
  );
};
