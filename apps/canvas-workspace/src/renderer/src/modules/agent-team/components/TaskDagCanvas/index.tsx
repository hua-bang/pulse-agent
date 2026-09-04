import './index.css';
import { AgentIcon } from '../../../coding-agent/icon';
import type {
  AgentTeamDagLayout,
  AgentTeamGraphTask,
} from '../../model/workspaceModel';

interface Props {
  layout: AgentTeamDagLayout;
  markerId: string;
  fullscreen?: boolean;
  selectedTask?: AgentTeamGraphTask;
  selectedAgentKey?: string;
  agentTypeByOwnerKey: ReadonlyMap<string, string | undefined>;
  onSelectTask: (task: AgentTeamGraphTask) => void;
}

const statusLabel = (status: string) => ({
  proposed: 'Proposed', planned: 'Planned', todo: 'Todo', in_progress: 'Running',
  needs_input: 'Needs input', needs_review: 'Needs review', blocked: 'Blocked',
  done: 'Done', failed: 'Failed', round_checkpoint: 'Checkpoint',
}[status] ?? status.replace(/_/g, ' '));

export const TaskDagCanvas = ({
  layout,
  markerId,
  fullscreen = false,
  selectedTask,
  selectedAgentKey,
  agentTypeByOwnerKey,
  onSelectTask,
}: Props) => (
  <div
    className={`agent-team-dag-canvas${fullscreen ? ' agent-team-dag-canvas--fullscreen' : ''}`}
    style={{ width: layout.width, height: layout.height }}
  >
    <svg
      className="agent-team-dag-edges"
      width={layout.width}
      height={layout.height}
      viewBox={`0 0 ${layout.width} ${layout.height}`}
      aria-hidden="true"
    >
      <defs>
        <marker id={markerId} markerWidth="8" markerHeight="8" refX="7" refY="4" orient="auto" markerUnits="strokeWidth">
          <path d="M 0 0 L 8 4 L 0 8 z" />
        </marker>
      </defs>
      {layout.edges.map((edge) => {
        const highlighted = selectedTask
          ? edge.sourceKey === selectedTask.key || edge.targetKey === selectedTask.key
          : false;
        return (
          <path
            key={edge.key}
            className={`agent-team-dag-edge${highlighted ? ' agent-team-dag-edge--highlighted' : ''}`}
            d={edge.path}
            markerEnd={`url(#${markerId})`}
          />
        );
      })}
    </svg>

    {layout.rounds.map((round) => round.showDivider ? (
      <div
        key={`${round.key}-divider`}
        className="agent-team-dag-round-divider"
        style={{ top: round.dividerTop, width: layout.width }}
      />
    ) : null)}
    {layout.rounds.map((round) => round.showLabel ? (
      <span
        key={`${round.key}-label`}
        className="agent-team-dag-round-label"
        style={{ left: 38, top: round.labelTop }}
      >
        {round.label}
      </span>
    ) : null)}
    {layout.stages.map((stage) => (
      <span key={stage.key} className="agent-team-dag-stage" style={{ left: stage.x, top: stage.y }}>
        <span className="agent-team-dag-stage__index">{stage.index}</span>
        {stage.label}
      </span>
    ))}
    {layout.nodes.map((item) => {
      const task = item.task;
      const selected = selectedTask?.key === task.key;
      const ownerHighlighted = !!selectedAgentKey && task.ownerKey === selectedAgentKey;
      const agentType = task.ownerKey ? agentTypeByOwnerKey.get(task.ownerKey) : undefined;
      return (
        <button
          key={task.key}
          type="button"
          className={`agent-team-dag-node agent-team-dag-node--${task.status}${selected ? ' agent-team-dag-node--selected' : ''}${ownerHighlighted ? ' agent-team-dag-node--owner-highlight' : ''}${task.dependencyWarning ? ' agent-team-dag-node--warning' : ''}`}
          style={{ left: item.x, top: item.y, width: item.width, height: item.height }}
          onClick={() => onSelectTask(task)}
          title={task.title}
        >
          <span className={`agent-team-task-row__dot agent-team-task-row__dot--${task.status}`} />
          <span className="agent-team-dag-node__copy">
            <strong>{task.title}</strong>
            <span className="agent-team-dag-node__meta">
              <span>{statusLabel(task.status)}</span>
              <span className={`agent-team-owner-chip${task.ownerKey && selectedAgentKey === task.ownerKey ? ' agent-team-owner-chip--active' : ''}`}>
                {agentType && (
                  <span className="agent-team-owner-chip__logo">
                    <AgentIcon id={agentType} size={12} />
                  </span>
                )}
                {task.ownerName}
              </span>
            </span>
          </span>
        </button>
      );
    })}
  </div>
);
