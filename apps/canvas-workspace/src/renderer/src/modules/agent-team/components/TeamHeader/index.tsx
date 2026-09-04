import './index.css';
import type { AgentTeamPhase, AgentTeamStatus } from '../../../../types';
import { agentTeamStatusLabel } from '../visualLabels';

export interface TeamHeaderView {
  title: string;
  phaseTitle: string;
  cwd: string;
  doneTaskCount: number;
  taskCount: number;
  activeTaskCount: number;
  phase: AgentTeamPhase;
  status: AgentTeamStatus;
  loading: boolean;
  error?: string | null;
  readOnly: boolean;
  teamAction: 'pause' | 'resume' | 'delete' | 'dispatch' | null;
  planAction: 'confirm' | 'advance' | 'finalize' | null;
  checkpointRound?: number;
  canPause: boolean;
  canResume: boolean;
  canDispatch: boolean;
}

export interface TeamHeaderActions {
  pause: () => void;
  resume: () => void;
  dispatch: () => void;
  deleteTeam: () => void;
  advanceRound: () => void;
  finalizeCheckpoint: () => void;
}

const compactPath = (value: string, maxLength = 54): string => {
  const path = value.trim();
  if (!path || path.length <= maxLength) return path;
  const parts = path.split('/').filter(Boolean);
  if (parts.length >= 2) {
    const compact = `.../${parts.slice(-2).join('/')}`;
    if (compact.length <= maxLength) return compact;
  }
  return `...${path.slice(Math.max(0, path.length - maxLength + 3))}`;
};

export const TeamHeader = ({ view, actions }: { view: TeamHeaderView; actions: TeamHeaderActions }) => {
  const checkpoint = view.status === 'round_checkpoint';
  return (
    <>
      <div className="agent-team-frame__top">
        <div className="agent-team-frame__identity">
          <div className="agent-team-frame__title">
            {view.title}
            <span className="agent-team-frame__phase-label"> · {view.phaseTitle}</span>
          </div>
          <div className="agent-team-frame__mission">
            {view.cwd && <code title={view.cwd}>{compactPath(view.cwd)}</code>}
            <span>{view.doneTaskCount}/{view.taskCount} tasks</span>
            {view.activeTaskCount > 0 && <span>{view.activeTaskCount} active</span>}
          </div>
        </div>
        <div className="agent-team-frame__actions">
          <div
            className={`agent-team-frame__status agent-team-frame__status--${view.status}`}
            title={view.loading ? 'Refreshing team snapshot' : undefined}
          >
            {view.phase === 'briefing'
              ? 'briefing'
              : view.phase === 'starting'
                ? 'starting'
                : agentTeamStatusLabel(view.status)}
          </div>
          {view.canResume && (
            <button type="button" className="agent-team-frame__primary-action" onClick={actions.resume} disabled={view.readOnly || view.teamAction !== null}>
              {view.teamAction === 'resume' ? 'Resuming' : 'Resume'}
            </button>
          )}
          {view.canDispatch && (
            <button type="button" className="agent-team-frame__primary-action" onClick={actions.dispatch} disabled={view.readOnly || view.teamAction !== null}>
              {view.teamAction === 'dispatch' ? 'Dispatching' : 'Dispatch'}
            </button>
          )}
          {view.canPause && (
            <button type="button" className="agent-team-frame__secondary-action" onClick={actions.pause} disabled={view.readOnly || view.teamAction !== null}>
              {view.teamAction === 'pause' ? 'Pausing' : 'Pause'}
            </button>
          )}
          <button type="button" className="agent-team-frame__danger-action" onClick={actions.deleteTeam} disabled={view.readOnly || view.teamAction !== null}>
            {view.teamAction === 'delete' ? 'Deleting' : 'Delete'}
          </button>
        </div>
      </div>
      {view.error && <div className="agent-team-frame__error">{view.error}</div>}
      {checkpoint && (
        <div className="agent-team-checkpoint-banner">
          <div className="agent-team-checkpoint-banner__copy">
            <strong>Round {view.checkpointRound} complete</strong>
            <span>Review results, then continue to plan the next round or finish up.</span>
          </div>
          <div className="agent-team-checkpoint-banner__actions">
            <button type="button" className="agent-team-frame__secondary-action" onClick={actions.finalizeCheckpoint} disabled={view.readOnly || view.planAction !== null}>
              {view.planAction === 'finalize' ? 'Finishing…' : 'Finish'}
            </button>
            <button type="button" className="agent-team-frame__primary-action" onClick={actions.advanceRound} disabled={view.readOnly || view.planAction !== null}>
              {view.planAction === 'advance' ? 'Starting…' : `Continue to Round ${(view.checkpointRound ?? 0) + 1}`}
            </button>
          </div>
        </div>
      )}
    </>
  );
};
