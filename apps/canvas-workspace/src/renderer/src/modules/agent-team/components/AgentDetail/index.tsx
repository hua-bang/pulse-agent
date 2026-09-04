import './index.css';
import { SegmentedControl } from '../../../../components/ui';
import { AgentIcon } from '../../../coding-agent/icon';
import { AgentNodeBody, type AgentNodeBodyProps } from '../../../coding-agent/surface';
import type { AgentTeamArtifactRecord } from '../../../../types';
import type { AgentTeamGraphTask } from '../../model/workspaceModel';
import { AGENT_REGISTRY } from '../../../../config/agentRegistry';
import { agentSessionHealthSuffix, agentTeamStatusLabel, agentTypeDisplayLabel } from '../visualLabels';
import { agentArtifactLabel, type AgentDetailModel } from './model';

export type { AgentDetailModel } from './model';
export { agentArtifactLabel, createAgentDetailModel, recentAgentActivity } from './model';

export type AgentDetailMode = 'activity' | 'terminal';

export type AgentTerminalSurface = Omit<
  AgentNodeBodyProps,
  'node' | 'terminalMode' | 'teamLeadBriefSlot' | 'agentTeamStatus' | 'forceTeamWarmup'
>;

interface Props {
  detail?: AgentDetailModel;
  mode: AgentDetailMode;
  terminal?: AgentTerminalSurface;
  onModeChange: (mode: AgentDetailMode) => void;
  onExpand: () => void;
  onSelectTask: (task: AgentTeamGraphTask) => void;
  onSelectArtifact: (artifact: AgentTeamArtifactRecord) => void;
}

export const AgentDetail = ({
  detail,
  mode,
  terminal,
  onModeChange,
  onExpand,
  onSelectTask,
  onSelectArtifact,
}: Props) => {
  if (!detail) {
    return <div className="agent-team-detail__muted agent-team-detail__empty">Select an agent to see its detail.</div>;
  }

  const { agent, tasks, artifacts, agentNode, activityLines, workspaceLabel } = detail;
  return (
    <>
      <div className="agent-team-graph-detail__head">
        <div>
          <span className="agent-team-panel-heading__label">Selected agent</span>
          <strong>{agent.name}</strong>
        </div>
        <span className={`agent-team-detail__status agent-team-detail__status--${agent.status}`}>
          {agentTeamStatusLabel(agent.status)}{agentSessionHealthSuffix(agent.sessionHealth)}
        </span>
      </div>

      <div className={`agent-team-agent-detail__viewer${mode === 'terminal' ? ' agent-team-agent-detail__viewer--terminal' : ''}`}>
        <div className="agent-team-subtabs">
          <SegmentedControl
            ariaPattern="tab"
            ariaLabel="Agent view"
            value={mode}
            onChange={(id) => onModeChange(id as AgentDetailMode)}
            options={[
              { id: 'activity', label: 'Activity' },
              { id: 'terminal', label: 'Terminal' },
            ]}
          />
          <button type="button" className="agent-team-subtab-expand" title="Open in large view" aria-label="Open in large view" onClick={onExpand}>⤢</button>
        </div>

        {mode === 'activity' ? (
          <div className="agent-team-agent-detail__activity">
            <div className="agent-team-agent-detail__meta">
              <span className="agent-team-detail__agent-type">
                <AgentIcon id={agent.agentType ?? 'claude-code'} size={13} />
                {agentTypeDisplayLabel(agent.agentType, AGENT_REGISTRY)}
              </span>
              {agent.nodeId && <code>{agent.nodeId}</code>}
              <span>{workspaceLabel}</span>
            </div>
            <div className="agent-team-agent-detail__stats">
              <span><strong>{agent.taskCount}</strong> tasks</span>
              <span><strong>{agent.runningCount}</strong> running</span>
              <span><strong>{agent.blockedCount}</strong> blocked</span>
              <span><strong>{agent.artifactCount}</strong> artifacts</span>
            </div>
            <div className="agent-team-agent-detail__section">
              <span className="agent-team-detail__section-title">Current task</span>
              <strong>{agent.currentTaskTitle ?? 'No active task'}</strong>
            </div>
            <div className="agent-team-agent-detail__section">
              <span className="agent-team-detail__section-title">Assigned tasks</span>
              {tasks.length === 0 ? <span className="agent-team-detail__muted">No assigned tasks.</span> : tasks.map((task) => (
                <button key={task.key} type="button" className={`agent-team-agent-detail__task agent-team-agent-detail__task--${task.status}`} onClick={() => onSelectTask(task)}>
                  <strong>{task.title}</strong><span>{agentTeamStatusLabel(task.status)}</span>
                </button>
              ))}
            </div>
            <div className="agent-team-agent-detail__section">
              <span className="agent-team-detail__section-title">Artifacts</span>
              {artifacts.length === 0 ? <span className="agent-team-detail__muted">None yet</span> : artifacts.map((artifact) => (
                <button key={artifact.id} type="button" className="agent-team-detail__pill agent-team-detail__pill--artifact agent-team-detail__artifact-button" title={artifact.summary ?? artifact.uri ?? ''} onClick={() => onSelectArtifact(artifact)}>
                  {agentArtifactLabel(artifact)}
                </button>
              ))}
            </div>
            <div className="agent-team-agent-detail__section">
              <span className="agent-team-detail__section-title">Recent output</span>
              {activityLines.length === 0 ? <span className="agent-team-detail__muted">No readable output yet.</span> : activityLines.map((line, index) => (
                <span key={`${index}-${line}`} className="agent-team-agent-detail__output">{line}</span>
              ))}
            </div>
          </div>
        ) : agentNode && terminal ? (
          <div className="agent-team-agent-detail__inline-terminal">
            <AgentNodeBody node={agentNode} {...terminal} terminalMode="mirror" />
          </div>
        ) : (
          <div className="agent-team-detail__muted agent-team-detail__empty">No runtime node yet. Approve &amp; run the plan to stream the terminal.</div>
        )}
      </div>
    </>
  );
};
