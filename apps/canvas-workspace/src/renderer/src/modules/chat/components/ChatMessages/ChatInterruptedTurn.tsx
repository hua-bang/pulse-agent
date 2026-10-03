import { BotAvatarIcon } from '../../../../components/icons';
import { useI18n } from '../../../../i18n';
import { ChatTurnOutcome } from '../ChatMessage/ChatTurnMeta';

interface ChatInterruptedTurnProps {
  /** Index of the user message that has no reply. */
  userIndex: number;
  onRetry?: (index: number) => Promise<boolean> | void;
}

/**
 * The thread ends with a user message although no turn is running: the app
 * quit or crashed before the reply was saved, or the turn never started.
 * Show the outcome in place of the missing reply so the user can retry.
 */
export const ChatInterruptedTurn = ({ userIndex, onRetry }: ChatInterruptedTurnProps) => {
  const { t } = useI18n();
  return (
    <div className="chat-message chat-message-assistant" role="article" aria-label={t('chat.assistantSpeaker')}>
      <div className="chat-message-avatar">
        <BotAvatarIcon size={20} />
      </div>
      <div className="chat-message-body">
        <ChatTurnOutcome
          status="failed"
          failureKind="interrupted"
          retryable
          onRetry={onRetry ? () => void onRetry(userIndex) : undefined}
        />
      </div>
    </div>
  );
};
