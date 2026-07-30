import { useI18n } from '../../i18n';
import type { ChatTarget } from './ChatTargetContext';
import './ChatTargetBar.css';

export const ChatTargetBar = ({ target }: { target: ChatTarget }) => {
  const { t } = useI18n();
  const executionLabel = target.executionPolicy === 'ask'
    ? t('chat.execution.ask')
    : target.executionPolicy === 'scheduled'
      ? t('chat.execution.scheduled')
      : t('chat.execution.auto');
  const contextLabels = target.contextSnapshot.contextLabels ?? [];

  return (
    <div
      className="chat-target-bar"
      role="status"
      aria-live="polite"
      aria-label={t('chat.targetSummary')}
    >
      <span className="chat-target-bar__scope">{target.contextSnapshot.label}</span>
      {contextLabels.length > 0 && (
        <>
          <span className="chat-target-bar__separator" aria-hidden="true">·</span>
          <span className="chat-target-bar__context">
            {contextLabels.join(', ')}
          </span>
        </>
      )}
      <span className="chat-target-bar__spacer" />
      <span className="chat-target-bar__execution">{executionLabel}</span>
    </div>
  );
};
