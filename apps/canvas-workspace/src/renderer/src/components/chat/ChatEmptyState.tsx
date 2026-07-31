import {
  GLOBAL_QUICK_ACTIONS,
  KNOWLEDGE_QUICK_ACTIONS,
  QUICK_ACTIONS,
  type EmptyStateQuickAction,
} from './constants';
import { AppLogoIcon } from '../icons';
import { useI18n, type I18nKey } from '../../i18n';

function QuickActionIcon({ action }: { action: EmptyStateQuickAction }) {
  switch (action.key) {
    case 'summarize_canvas':
    case 'summarize_knowledge':
    case 'review_recent_work':
      return (
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
          <path d="M2.5 4h11M2.5 8h7.5M2.5 12h9" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" />
        </svg>
      );
    case 'analyze_relations':
    case 'discover_themes':
    case 'find_connections':
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
    case 'improve_node':
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
  variant?: ChatEmptyStateVariant;
}

export type ChatEmptyStateVariant = 'canvas' | 'global' | 'knowledge';

const EMPTY_STATE_CONTENT = {
  canvas: {
    greetingKey: 'chat.emptyGreeting',
    quickActions: QUICK_ACTIONS,
  },
  global: {
    greetingKey: 'chat.emptyGlobalGreeting',
    quickActions: GLOBAL_QUICK_ACTIONS,
  },
  knowledge: {
    greetingKey: 'chat.emptyKnowledgeGreeting',
    quickActions: KNOWLEDGE_QUICK_ACTIONS,
  },
} satisfies Record<
  ChatEmptyStateVariant,
  { greetingKey: I18nKey; quickActions: readonly EmptyStateQuickAction[] }
>;

export const ChatEmptyState = ({
  selectedCount = 0,
  onQuickAction,
  variant = 'canvas',
}: ChatEmptyStateProps) => {
  const { t } = useI18n();
  const { greetingKey, quickActions } = EMPTY_STATE_CONTENT[variant];
  return (
    <div className="chat-empty-state">
      <div className="chat-empty-icon">
        <AppLogoIcon size={36} />
      </div>
      <div className="chat-empty-greeting">
        {t(greetingKey)}
      </div>
      <div className="chat-quick-actions">
        {quickActions
          .filter(action => !action.requiresSelection || selectedCount > 0).map(action => (
          <button
            key={action.key}
            className="chat-quick-action"
            onClick={() => onQuickAction(t(action.promptKey), action.key)}
          >
            <span className="chat-quick-action-icon">
              <QuickActionIcon action={action} />
            </span>
            <span>{t(action.labelKey)}</span>
          </button>
        ))}
      </div>
    </div>
  );
};
