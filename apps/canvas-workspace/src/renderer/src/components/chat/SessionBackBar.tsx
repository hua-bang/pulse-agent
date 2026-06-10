import { useI18n } from '../../i18n';

/** One entry in the session back-navigation stack (where a jump started). */
export interface SessionBackEntry {
  sessionId: string;
  /** Session-store id — `__global_chat__` for global chat. */
  workspaceId: string;
  /** Short human label for the session (first user message, trimmed). */
  label: string;
}

interface SessionBackBarProps {
  entry: SessionBackEntry;
  /** Back is blocked while a turn is streaming, same as session jumps. */
  disabled?: boolean;
  onBack: () => void;
}

/**
 * Slim one-line bar pinned above the messages list after a session jump.
 * Shows "← label" so the user can return with a single click.
 */
export const SessionBackBar = ({ entry, disabled, onBack }: SessionBackBarProps) => {
  const { t } = useI18n();
  const label = entry.label || t('chat.session.back');
  return (
    <div className="chat-session-back">
      <button
        type="button"
        className="chat-session-back-btn"
        disabled={disabled}
        onClick={onBack}
        title={label}
      >
        <svg className="chat-session-back-icon" width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
          <path d="M7.5 2L3.5 6L7.5 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <span className="chat-session-back-prefix">{t('chat.session.back')}</span>
        <span className="chat-session-back-label">{label}</span>
      </button>
    </div>
  );
};
