import type {
  AgentTeamAgentRecord,
  AgentTeamHumanGateRecord,
  AgentTeamTaskRecord,
} from '../../../../types';
import type { AgentTeamGraphTask } from '../../model/workspaceModel';

export const hasConcreteHumanGatePrompt = (prompt: string): boolean => {
  const normalized = prompt.trim().replace(/\s+/g, ' ');
  if (!normalized) return false;
  if (/^agent requested human input\.?$/i.test(normalized)) return false;
  if (/^human input requested\.?$/i.test(normalized)) return false;
  return true;
};

interface HumanGateCardProps {
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
}: HumanGateCardProps) => {
  const hasPrompt = hasConcreteHumanGatePrompt(gate.prompt);
  const displayedPrompt = hasPrompt
    ? gate.prompt
    : 'This agent asked for help but did not include a concrete question.';
  const reason = gate.reason?.trim();
  const showReason = !!reason && reason !== gate.prompt && !/^agent requested human input\.?$/i.test(reason);
  return (
    <div className={`agent-team-human-gate${compact ? ' agent-team-human-gate--compact' : ''}${hasPrompt ? '' : ' agent-team-human-gate--missing-prompt'}`}>
      <div className="agent-team-human-gate__copy">
        <span className="agent-team-detail__section-title">Needs input</span>
        <strong>{displayedPrompt}</strong>
        <span className="agent-team-human-gate__meta">
          {agent ? `From ${agent.name}` : 'From teammate'}
          {task ? ` · Task: ${task.title}` : ''}
          {showReason ? ` · ${reason}` : ''}
        </span>
        {!hasPrompt && (
          <span className="agent-team-human-gate__hint">
            No actionable question was provided. Ask the owner to clarify or send a team command with the missing decision.
          </span>
        )}
      </div>
      <div className="agent-team-human-gate__actions">
        {graphTask && selectedTaskId !== gate.taskId && (
          <button type="button" onClick={() => onViewTask(graphTask)}>View task</button>
        )}
        <input
          value={answer}
          onChange={(event) => onAnswerChange(event.target.value)}
          placeholder={hasPrompt ? 'Answer this question' : 'Optional clarification'}
          disabled={readOnly}
        />
        <button type="button" onClick={onAnswer} disabled={readOnly || !answer.trim()}>
          Answer
        </button>
      </div>
    </div>
  );
};
