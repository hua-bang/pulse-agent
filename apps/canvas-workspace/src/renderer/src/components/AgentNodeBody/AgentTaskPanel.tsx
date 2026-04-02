import type { AgentTaskSummary } from '../../types';

interface Props {
  tasks: AgentTaskSummary[];
  currentTaskId?: string;
  open: boolean;
  onToggle: () => void;
}

const STATUS_ICONS: Record<AgentTaskSummary['status'], string> = {
  pending: '\u25CB',     // ○
  in_progress: '\u25B6', // ▶
  completed: '\u2713',   // ✓
  failed: '\u2717',      // ✗
};

const STATUS_CLASSES: Record<AgentTaskSummary['status'], string> = {
  pending: 'agent-task--pending',
  in_progress: 'agent-task--active',
  completed: 'agent-task--completed',
  failed: 'agent-task--failed',
};

export const AgentTaskPanel = ({ tasks, currentTaskId, open, onToggle }: Props) => {
  const completed = tasks.filter((t) => t.status === 'completed').length;

  return (
    <div className="agent-task-panel">
      <button
        className="agent-task-panel-header"
        onClick={(e) => { e.stopPropagation(); onToggle(); }}
      >
        <span className="agent-task-panel-chevron">{open ? '\u25BE' : '\u25B8'}</span>
        <span>Tasks</span>
        <span className="agent-task-panel-count">{completed}/{tasks.length}</span>
      </button>
      {open && (
        <div className="agent-task-list">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={`agent-task-item ${STATUS_CLASSES[task.status]} ${task.id === currentTaskId ? 'agent-task--current' : ''}`}
            >
              <span className="agent-task-icon">{STATUS_ICONS[task.status]}</span>
              <span className="agent-task-title">{task.title}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
