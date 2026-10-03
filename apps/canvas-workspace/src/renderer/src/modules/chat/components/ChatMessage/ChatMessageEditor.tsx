import type { KeyboardEvent } from 'react';
import { useI18n } from '../../../../i18n';

interface ChatMessageEditorProps {
  value: string;
  /** Messages after this turn that resending removes. */
  laterMessageCount: number;
  onChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onCancel: () => void;
  onSave: () => void;
}

export const ChatMessageEditor = ({
  value,
  laterMessageCount,
  onChange,
  onKeyDown,
  onCancel,
  onSave,
}: ChatMessageEditorProps) => {
  const { t } = useI18n();
  const removesLater = laterMessageCount > 0;
  return (
    <div className="chat-message-edit">
      <textarea
        className="chat-message-edit-input"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        autoFocus
        rows={Math.min(8, Math.max(2, value.split('\n').length))}
      />
      {removesLater && (
        <p className="chat-message-edit-warning" role="note">
          {t('chat.recovery.editRemovesLater', { count: laterMessageCount })}
        </p>
      )}
      <div className="chat-message-edit-actions">
        <span className="chat-message-edit-hint">{t('chat.recovery.editHint')}</span>
        <button
          type="button"
          className="chat-message-toolbar-btn"
          onClick={onCancel}
        >
          {t('chat.recovery.cancel')}
        </button>
        <button
          type="button"
          className="chat-message-toolbar-btn chat-message-toolbar-btn--primary"
          onClick={onSave}
          disabled={!value.trim()}
        >
          {removesLater ? t('chat.recovery.saveAndRemove') : t('chat.recovery.saveAndResend')}
        </button>
      </div>
    </div>
  );
};
