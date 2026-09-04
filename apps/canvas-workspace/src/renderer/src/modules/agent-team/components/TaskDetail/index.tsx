import type { ReactNode } from 'react';
import './index.css';
import type { AgentTeamArtifactRecord } from '../../../../types';
import { AgentIcon } from '../../../coding-agent/icon';
import type { AgentTeamGraphTask } from '../../model/workspaceModel';
import { agentArtifactLabel } from '../AgentDetail';
import { agentTeamStatusLabel } from '../visualLabels';

interface Props {
  task?: AgentTeamGraphTask;
  artifacts: AgentTeamArtifactRecord[];
  ownerAgentType?: string;
  selectedAgentKey: string;
  humanGate?: ReactNode;
  onSelectArtifact: (artifact: AgentTeamArtifactRecord) => void;
}

export const TaskDetail = ({
  task,
  artifacts,
  ownerAgentType,
  selectedAgentKey,
  humanGate,
  onSelectArtifact,
}: Props) => {
  if (!task) {
    return <div className="agent-team-detail__muted agent-team-detail__empty">Select a task to see its detail.</div>;
  }

  return (
    <>
      <div className="agent-team-graph-detail__head">
        <div><span className="agent-team-panel-heading__label">Selected task</span><strong>{task.title}</strong></div>
        <span className={`agent-team-detail__status agent-team-detail__status--${task.status}`}>{agentTeamStatusLabel(task.status)}</span>
      </div>
      <div className="agent-team-detail__facts">
        <div>
          <span className="agent-team-detail__section-title">Owner</span>
          <span className={`agent-team-owner-chip${task.ownerKey && selectedAgentKey === task.ownerKey ? ' agent-team-owner-chip--active' : ''}`}>
            {ownerAgentType && <span className="agent-team-owner-chip__logo"><AgentIcon id={ownerAgentType} size={12} /></span>}
            {task.ownerName}
          </span>
        </div>
        <div>
          <span className="agent-team-detail__section-title">Updated</span>
          <strong>{task.updatedAt ? new Date(task.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : 'Not yet'}</strong>
        </div>
      </div>
      <div className="agent-team-detail__description">{task.description.trim() || 'No task instructions yet.'}</div>
      <div className="agent-team-detail__grid">
        <div className="agent-team-detail__section">
          <span className="agent-team-detail__section-title">Dependencies</span>
          {task.depLabels.length === 0 ? <span className="agent-team-detail__muted">None</span> : task.depLabels.map((dependency) => <span key={dependency} className="agent-team-detail__pill">{dependency}</span>)}
        </div>
        <div className="agent-team-detail__section">
          <span className="agent-team-detail__section-title">Artifacts</span>
          {task.sourceTask && artifacts.length > 0 ? artifacts.map((artifact) => (
            <button key={artifact.id} type="button" className="agent-team-detail__pill agent-team-detail__pill--artifact agent-team-detail__artifact-button" title={artifact.summary ?? artifact.uri ?? ''} onClick={() => onSelectArtifact(artifact)}>{agentArtifactLabel(artifact)}</button>
          )) : (
            <span className="agent-team-detail__muted">{task.artifactCount > 0 ? `${task.artifactCount} published` : 'None yet'}</span>
          )}
        </div>
      </div>
      {task.scope && task.scope.length > 0 && <div className="agent-team-detail__result"><span className="agent-team-detail__section-title">Scope</span><span>{task.scope.join(', ')}</span></div>}
      {task.verify && <div className="agent-team-detail__result"><span className="agent-team-detail__section-title">Verify</span><span>{task.verify}</span></div>}
      {task.result && <div className="agent-team-detail__result"><span className="agent-team-detail__section-title">Result</span><span>{task.result}</span></div>}
      {task.blockedReason && <div className="agent-team-detail__result agent-team-detail__result--blocked"><span className="agent-team-detail__section-title">Blocker</span><span>{task.blockedReason}</span></div>}
      {humanGate}
    </>
  );
};
