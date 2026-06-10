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
 * Slim bar pinned above the messages list after a session jump, letting the
 * user return to the conversation they came from. Stacked jumps pop one
 * level at a time.
 */
export const SessionBackBar = ({ entry, disabled, onBack }: SessionBackBarProps) => {
  const { t } = useI18n();
  return (
    <div className="chat-session-back">
      <button
        type="button"
        className="chat-session-back-btn"
        disabled={disabled}
        onClick={onBack}
        title={entry.label || t('chat.session.back')}
      >
        <span className="chat-session-back-arrow">←</span>
        <span>{t('chat.session.back')}</span>
        {entry.label && <span className="chat-session-back-label">{entry.label}</span>}
      </button>
    </div>
  );
};
