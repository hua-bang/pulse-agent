import { useId } from 'react';
import { useI18n } from '../../i18n';
import { isImeComposing } from '../../utils/ime';
import { BotAvatarIcon } from '../icons';
import { Button } from '../ui';
import type { PendingClarification } from './types';

interface ChatClarificationCardProps {
  pendingClarify: PendingClarification;
  clarifyInput: string;
  answering: boolean;
  disabled?: boolean;
  error: string | null;
  onInputChange: (value: string) => void;
  onAnswer: (answerOverride?: string) => Promise<void>;
}

export const ChatClarificationCard = ({
  pendingClarify,
  clarifyInput,
  answering,
  disabled = false,
  error,
  onInputChange,
  onAnswer,
}: ChatClarificationCardProps) => {
  const { t } = useI18n();
  const errorId = useId();
  const approval = pendingClarify.kind === 'approval';
  const defaultAction = pendingClarify.defaultAnswer?.trim().toLowerCase() === 'yes'
    ? t('chat.approve')
    : t('chat.reject');

  return (
    <div
      className="chat-message chat-message-assistant chat-message--clarification"
      role="status"
      aria-live="polite"
      aria-busy={answering || undefined}
    >
      <div className="chat-message-avatar">
        <BotAvatarIcon size={18} />
      </div>
      <div className="chat-message-body">
        <div className="chat-clarify-card">
          <div className="chat-clarify-label">
            {t(approval ? 'chat.approvalRequired' : 'chat.needsClarification')}
          </div>
          <div className="chat-clarify-question">{pendingClarify.question}</div>
          {pendingClarify.context && (
            <div className="chat-clarify-context">{pendingClarify.context}</div>
          )}
          {approval ? (
            <>
              <div className="chat-clarify-approval-actions">
                <Button
                  variant="primary"
                  size="sm"
                  disabled={answering || disabled}
                  onClick={() => void onAnswer('Yes')}
                >
                  {t('chat.approve')}
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={answering || disabled}
                  onClick={() => void onAnswer('No')}
                >
                  {t('chat.reject')}
                </Button>
              </div>
              {pendingClarify.defaultAnswer && (
                <div className="chat-clarify-approval-default">
                  {t('chat.approvalDefault', { answer: defaultAction })}
                </div>
              )}
            </>
          ) : <div className="chat-clarify-form">
            <input
              type="text"
              className="chat-clarify-input"
              value={clarifyInput}
              onChange={(event) => onInputChange(event.target.value)}
              onKeyDown={(event) => {
                if (
                  !answering
                  && !disabled
                  && event.key === 'Enter'
                  && !event.shiftKey
                  && !isImeComposing(event)
                ) {
                  event.preventDefault();
                  void onAnswer();
                }
              }}
              placeholder={t('chat.typeAnswer')}
              disabled={answering || disabled}
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
            />
            <button
              type="button"
              className="chat-clarify-submit"
              onClick={() => void onAnswer()}
              disabled={!clarifyInput.trim() || answering || disabled}
            >
              {answering ? t('chat.sendingReply') : t('chat.reply')}
            </button>
          </div>}
          {error && (
            <div id={errorId} className="chat-clarify-error" role="alert">
              {error}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
