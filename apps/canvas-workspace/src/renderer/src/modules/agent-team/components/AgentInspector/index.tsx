import './index.css';
import { SegmentedControl } from '../../../../components/ui';
import { AGENT_REGISTRY } from '../../../../config/agentRegistry';
import type { AgentTeamArtifactRecord } from '../../../../types';
import { AgentIcon } from '../../../coding-agent/icon';
import { AgentNodeBody } from '../../../coding-agent/surface';
import type { AgentTeamGraphTask } from '../../model/workspaceModel';
import { agentTeamStatusLabel, agentTypeDisplayLabel } from '../visualLabels';
import {
  agentArtifactLabel,
  type AgentDetailMode,
  type AgentDetailModel,
  type AgentTerminalSurface,
} from '../AgentDetail';

interface Props {
  detail: AgentDetailModel;
  mode: AgentDetailMode;
  terminal?: AgentTerminalSurface;
  onClose: () => void;
  onModeChange: (mode: AgentDetailMode) => void;
  onSelectTask: (task: AgentTeamGraphTask) => void;
  onSelectArtifact: (artifact: AgentTeamArtifactRecord) => void;
}

export const AgentInspector = ({
  detail,
  mode,
  terminal,
  onClose,
  onModeChange,
  onSelectTask,
  onSelectArtifact,
}: Props) => {
  const { agent, tasks, artifacts, agentNode, activityLines, workspaceLabel } = detail;
  return (
    <div className="agent-team-agent-inspector" role="dialog" aria-label="Agent detail">
      <div className="agent-team-agent-inspector__panel">
        <div className="agent-team-agent-inspector__head">
          <div><span className="agent-team-panel-heading__label">Agent detail</span><strong>{agent.name}</strong></div>
          <button type="button" onClick={onClose}>Close</button>
        </div>
        <div className="agent-team-agent-inspector__body">
          <div className="agent-team-agent-inspector__summary">
            <div className="agent-team-agent-inspector__meta">
              <span className="agent-team-detail__agent-type"><AgentIcon id={agent.agentType ?? 'claude-code'} size={13} />{agentTypeDisplayLabel(agent.agentType, AGENT_REGISTRY)}</span>
              <span>{agentTeamStatusLabel(agent.status)}</span>
              {agent.nodeId && <code>{agent.nodeId}</code>}
            </div>
            <div className="agent-team-agent-inspector__stats">
              <span><strong>{agent.taskCount}</strong> tasks</span>
              <span><strong>{agent.runningCount}</strong> running</span>
              <span><strong>{agent.blockedCount}</strong> blocked tasks</span>
              <span><strong>{agent.artifactCount}</strong> artifacts</span>
              <span><strong>{agent.toolCount ?? '—'}</strong> tools</span>
            </div>
            <div className="agent-team-agent-inspector__section">
              <span className="agent-team-detail__section-title">Assigned tasks</span>
              {tasks.length === 0 ? <span className="agent-team-detail__muted">No assigned tasks.</span> : tasks.map((task) => (
                <button key={task.key} type="button" className={`agent-team-agent-inspector__task agent-team-agent-inspector__task--${task.status}`} onClick={() => onSelectTask(task)}>
                  <strong>{task.title}</strong><span>{agentTeamStatusLabel(task.status)}</span>
                </button>
              ))}
            </div>
            <div className="agent-team-agent-inspector__section">
              <span className="agent-team-detail__section-title">Artifacts</span>
              {artifacts.length === 0 ? <span className="agent-team-detail__muted">None yet</span> : artifacts.map((artifact) => (
                <button key={artifact.id} type="button" className="agent-team-detail__pill agent-team-detail__pill--artifact agent-team-detail__artifact-button" title={artifact.summary ?? artifact.uri ?? ''} onClick={() => onSelectArtifact(artifact)}>{agentArtifactLabel(artifact)}</button>
              ))}
            </div>
          </div>
          <div className="agent-team-agent-inspector__terminal">
            <div className="agent-team-agent-inspector__viewer-head">
              <div><span className="agent-team-panel-heading__label">Coding Agent</span><strong>{mode === 'terminal' ? 'Terminal' : 'Activity'}</strong></div>
              <SegmentedControl className="agent-team-agent-inspector__viewer-tabs" ariaPattern="tab" ariaLabel="Agent detail mode" value={mode} onChange={(id) => onModeChange(id as AgentDetailMode)} options={[{ id: 'activity', label: 'Activity' }, { id: 'terminal', label: 'Terminal' }]} />
            </div>
            {mode === 'activity' ? (
              <div className="agent-team-agent-inspector__activity">
                <div className="agent-team-agent-inspector__activity-hero">
                  <span className={`agent-team-detail__status agent-team-detail__status--${agent.status}`}>{agentTeamStatusLabel(agent.status)}</span>
                  <strong>{agent.currentTaskTitle ?? 'No active task'}</strong>
                  <span>{agent.doneCount}/{agent.taskCount} tasks complete</span>
                </div>
                <div className="agent-team-agent-inspector__activity-grid">
                  <span><strong>{agent.toolCount ?? '—'}</strong> Tools</span>
                  <span><strong>{agent.artifactCount}</strong> Artifacts</span>
                  <span><strong>{workspaceLabel === 'No workspace' ? '—' : workspaceLabel}</strong> Workspace</span>
                </div>
                <div className="agent-team-agent-inspector__recent-output">
                  <span className="agent-team-detail__section-title">Recent output</span>
                  {activityLines.length === 0 ? <span className="agent-team-detail__muted">No readable output yet.</span> : activityLines.map((line, index) => <span key={`${index}-${line}`}>{line}</span>)}
                </div>
              </div>
            ) : agentNode && terminal ? (
              <div className="agent-team-agent-inspector__terminal-body"><AgentNodeBody node={agentNode} {...terminal} terminalMode="mirror" /></div>
            ) : (
              <div className="agent-team-agent-inspector__terminal-empty"><span className="agent-team-detail__section-title">Coding Agent</span><strong>No runtime node yet</strong><span>Approve and run the plan before opening the full Coding Agent view.</span></div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
