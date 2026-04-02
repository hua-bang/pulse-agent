import { useCallback } from 'react';
import type { AgentNodeData, AgentRuntime, AgentStatus } from '../../types';

interface Props {
  data: AgentNodeData;
  onRuntimeChange: (runtime: AgentRuntime) => void;
  onConfigToggle: () => void;
}

const STATUS_COLORS: Record<AgentStatus, string> = {
  idle: '#9ca3af',
  running: '#22c55e',
  waiting: '#eab308',
  stopping: '#f97316',
  stopped: '#9ca3af',
  completed: '#22c55e',
  failed: '#ef4444',
};

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Idle',
  running: 'Running',
  waiting: 'Waiting',
  stopping: 'Stopping',
  stopped: 'Stopped',
  completed: 'Completed',
  failed: 'Failed',
};

const RUNTIME_LABELS: Record<AgentRuntime, string> = {
  'pulse-agent': 'Pulse',
  'claude-code': 'Claude',
  'codex': 'Codex',
};

export const AgentHeader = ({ data, onRuntimeChange, onConfigToggle }: Props) => {
  const handleRuntimeChange = useCallback(
    (e: React.ChangeEvent<HTMLSelectElement>) => {
      onRuntimeChange(e.target.value as AgentRuntime);
    },
    [onRuntimeChange]
  );

  return (
    <div className="agent-header">
      <div className="agent-header-left">
        <span
          className="agent-status-dot"
          style={{ backgroundColor: STATUS_COLORS[data.status] }}
          title={STATUS_LABELS[data.status]}
        />
        <span className="agent-name">
          {data.isLead ? '\u2655 ' : ''}{data.name || 'Unnamed Agent'}
        </span>
      </div>
      <div className="agent-header-right">
        <select
          className="agent-runtime-select"
          value={data.runtime}
          onChange={handleRuntimeChange}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <option value="pulse-agent">{RUNTIME_LABELS['pulse-agent']}</option>
          <option value="claude-code">{RUNTIME_LABELS['claude-code']}</option>
          <option value="codex">{RUNTIME_LABELS['codex']}</option>
        </select>
        <button
          className="agent-config-btn"
          onClick={(e) => { e.stopPropagation(); onConfigToggle(); }}
          title="Configure"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
            <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.3" />
            <path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.05 3.05l1.41 1.41M11.54 11.54l1.41 1.41M3.05 12.95l1.41-1.41M11.54 4.46l1.41-1.41" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
        </button>
      </div>
    </div>
  );
};
