import { QUICK_ACTIONS } from './constants';
import type { QuickAction } from './types';

function QuickActionIcon({ action }: { action: QuickAction }) {
  switch (action.key) {
    case 'summarize_canvas':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2.5 4h11M2.5 8h7.5M2.5 12h9" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        </svg>
      );
    case 'analyze_relations':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="4" cy="8" r="1.7" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="12" cy="4" r="1.7" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="12" cy="12" r="1.7" stroke="currentColor" strokeWidth="1.25" />
          <path d="M5.6 7.4l4.8-2.6M5.6 8.6l4.8 2.6" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      );
    case 'create_mindmap':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="4" cy="8" r="1.6" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="12" cy="3.8" r="1.4" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="12" cy="8" r="1.4" stroke="currentColor" strokeWidth="1.25" />
          <circle cx="12" cy="12.2" r="1.4" stroke="currentColor" strokeWidth="1.25" />
          <path d="M5.5 8l5-4M5.6 8h4.8M5.5 8l5 4" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round" />
        </svg>
      );
    case 'organize_selection':
    default:
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.25" />
          <path d="M5 8.2l2 2 4-4.4" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      );
  }
}

interface ChatEmptyStateProps {
  selectedCount?: number;
  onQuickAction: (prompt: string, quickAction?: string) => void;
}

export const ChatEmptyState = ({ selectedCount = 0, onQuickAction }: ChatEmptyStateProps) => (
  <div className="chat-empty-state">
    <div className="chat-empty-icon">
      <svg width="34" height="34" viewBox="0 0 512 512" fill="none">
        <rect x="32" y="32" width="448" height="448" rx="96" ry="96" fill="currentColor" opacity="0.06" />
        <path
          d="M80 268H188L228 178L260 370L292 148L328 268H432"
          stroke="currentColor"
          strokeWidth="22"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
    <div className="chat-empty-greeting">想怎么处理这张画布？</div>
    <div className="chat-quick-actions">
      {QUICK_ACTIONS.filter(action => !action.requiresSelection || selectedCount > 0).map(action => (
        <button
          key={action.key}
          className="chat-quick-action"
          onClick={() => onQuickAction(action.prompt, action.key)}
        >
          <span className="chat-quick-action-icon">
            <QuickActionIcon action={action} />
          </span>
          <span>{action.label}</span>
        </button>
      ))}
    </div>
  </div>
);
