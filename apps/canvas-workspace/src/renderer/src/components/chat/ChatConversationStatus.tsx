import { ArrowClockwise, SpinnerGap, WarningCircle } from '@phosphor-icons/react';
import { useI18n } from '../../i18n';
import { Button } from '../ui';
import './ChatConversationStatus.css';

interface ChatConversationStatusProps {
  sessionLoading?: boolean;
  /** Where session-opening feedback is presented for this surface. */
  sessionLoadingFeedback?: 'inline' | 'external';
  /**
   * Whether the thread already has messages on screen. When it doesn't,
   * `ChatMessages` renders `ChatThreadSkeleton` in its place — which already
   * announces the wait (its own `role="status"`) — so this banner would be a
   * second, redundant loading indicator stacked on top of the first. Only
   * show it when stale messages are still visible and the skeleton can't
   * cover the same fetch.
   */
  hasMessages: boolean;
  busyElsewhere?: boolean;
  sessionError?: { code?: string; message: string } | null;
  onRetrySession?: () => void | Promise<void>;
  conversationError?: string | null;
  disabled?: boolean;
}

export const ChatConversationStatus = ({
  sessionLoading = false,
  sessionLoadingFeedback = 'inline',
  hasMessages,
  busyElsewhere = false,
  sessionError,
  onRetrySession,
  conversationError,
  disabled = false,
}: ChatConversationStatusProps) => {
  const { t } = useI18n();
  const showOpeningBanner = sessionLoading
    && sessionLoadingFeedback === 'inline'
    && hasMessages;
  if (!showOpeningBanner && !busyElsewhere && !sessionError && !conversationError) return null;

  return (
    <div className="chat-conversation-status-stack">
      {showOpeningBanner && (
        <div className="chat-conversation-status chat-conversation-status--loading" role="status" aria-live="polite">
          <span className="chat-conversation-status__icon" aria-hidden="true">
            <SpinnerGap size={15} className="chat-spin" />
          </span>
          <span>{t('chat.openingConversation')}</span>
        </div>
      )}
      {busyElsewhere && (
        <div className="chat-conversation-status chat-conversation-status--loading" role="status" aria-live="polite">
          <span className="chat-conversation-status__icon" aria-hidden="true">
            <SpinnerGap size={15} className="chat-spin" />
          </span>
          <span>{t('chat.generatingElsewhere')}</span>
        </div>
      )}
      {sessionError && (
        <div className="chat-conversation-status chat-conversation-status--error" role="alert">
          <span className="chat-conversation-status__icon" aria-hidden="true">
            <WarningCircle size={15} weight="fill" />
          </span>
          <span className="chat-conversation-status__message">{sessionError.message}</span>
          {onRetrySession && (
            <Button
              variant="secondary"
              size="xs"
              disabled={disabled}
              onClick={() => void onRetrySession()}
            >
              <ArrowClockwise size={12} />
              {t('chat.retry')}
            </Button>
          )}
        </div>
      )}
      {conversationError && (
        <div className="chat-conversation-status chat-conversation-status--error" role="alert">
          <span className="chat-conversation-status__icon" aria-hidden="true">
            <WarningCircle size={15} weight="fill" />
          </span>
          <span className="chat-conversation-status__message">{conversationError}</span>
        </div>
      )}
    </div>
  );
};
