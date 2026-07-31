import { useI18n } from '../../i18n';
import { Button } from '../ui';
import './ChatConversationStatus.css';

export interface ConversationBranchRef {
  sourceSessionId: string;
  activeSessionId: string;
}

interface ChatConversationStatusProps {
  sessionLoading?: boolean;
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
  conversationBranch?: ConversationBranchRef | null;
  branchError?: string | null;
  onOpenOriginal?: () => void | Promise<void>;
  disabled?: boolean;
}

export const ChatConversationStatus = ({
  sessionLoading = false,
  hasMessages,
  busyElsewhere = false,
  sessionError,
  onRetrySession,
  conversationBranch,
  branchError,
  onOpenOriginal,
  disabled = false,
}: ChatConversationStatusProps) => {
  const { t } = useI18n();
  const showOpeningBanner = sessionLoading && hasMessages;
  if (!showOpeningBanner && !busyElsewhere && !sessionError && !conversationBranch && !branchError) return null;

  return (
    <div className="chat-conversation-status-stack">
      {showOpeningBanner && (
        <div className="chat-conversation-status" role="status" aria-live="polite">
          <span className="chat-conversation-status__pulse" aria-hidden="true" />
          <span>{t('chat.openingConversation')}</span>
        </div>
      )}
      {busyElsewhere && (
        <div className="chat-conversation-status" role="status" aria-live="polite">
          <span className="chat-conversation-status__pulse" aria-hidden="true" />
          <span>{t('chat.generatingElsewhere')}</span>
        </div>
      )}
      {sessionError && (
        <div className="chat-conversation-status chat-conversation-status--error" role="alert">
          <span className="chat-conversation-status__message">{sessionError.message}</span>
          {onRetrySession && (
            <Button
              variant="secondary"
              size="xs"
              disabled={disabled}
              onClick={() => void onRetrySession()}
            >
              {t('chat.retry')}
            </Button>
          )}
        </div>
      )}
      {conversationBranch && (
        <div className="chat-conversation-status" role="status">
          <span className="chat-conversation-status__message">
            {t('chat.branchedFromOriginal')}
          </span>
          {onOpenOriginal && (
            <Button
              variant="secondary"
              size="xs"
              disabled={disabled}
              onClick={() => void onOpenOriginal()}
            >
              {t('chat.openOriginal')}
            </Button>
          )}
        </div>
      )}
      {branchError && (
        <div className="chat-conversation-status chat-conversation-status--error" role="alert">
          <span className="chat-conversation-status__message">{branchError}</span>
        </div>
      )}
    </div>
  );
};
