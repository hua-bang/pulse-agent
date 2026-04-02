import type { AgentStatus } from '../../types';

interface Props {
  status: AgentStatus;
}

export const AgentTerminalPlaceholder = ({ status }: Props) => {
  const isActive = status === 'running' || status === 'waiting';

  return (
    <div className="agent-terminal-placeholder">
      {isActive ? (
        <div className="agent-terminal-active">
          <span className="agent-terminal-cursor">_</span>
        </div>
      ) : (
        <div className="agent-terminal-idle">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" opacity="0.3">
            <rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" strokeWidth="1.5" />
            <path d="M7 12l3 2-3 2M13 16h4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          <span>Terminal will activate when agent starts</span>
        </div>
      )}
    </div>
  );
};
