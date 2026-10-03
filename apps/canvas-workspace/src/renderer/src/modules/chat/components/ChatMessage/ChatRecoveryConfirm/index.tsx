import './index.css';
import { WarningCircle } from '@phosphor-icons/react';
import { useI18n } from '../../../../../i18n';
import { Button } from '../../../../../components/ui';

interface ChatRecoveryConfirmProps {
  /** Messages after this turn that regenerating would remove. */
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
  /** Non-destructive alternative: continue from here in a new chat. */
  onFork?: () => void;
}

/**
 * Regenerating an older turn cuts the conversation at that turn. The user
 * confirms the removal, or forks a new chat that keeps this one intact.
 */
export const ChatRecoveryConfirm = ({
  count,
  onConfirm,
  onCancel,
  onFork,
}: ChatRecoveryConfirmProps) => {
  const { t } = useI18n();
  const message = t('chat.recovery.regenerateRemovesLater', { count });
  return (
    <div className="chat-recovery-confirm" role="group" aria-label={message}>
      <span className="chat-recovery-confirm__icon" aria-hidden="true">
        <WarningCircle size={14} weight="fill" />
      </span>
      <span className="chat-recovery-confirm__message">{message}</span>
      <div className="chat-recovery-confirm__actions">
        <Button variant="secondary" size="xs" onClick={onCancel}>
          {t('chat.recovery.cancel')}
        </Button>
        {onFork && (
          <Button variant="secondary" size="xs" onClick={onFork}>
            {t('chat.recovery.forkInstead')}
          </Button>
        )}
        <Button variant="danger" size="xs" onClick={onConfirm} autoFocus>
          {t('chat.recovery.confirmRemove')}
        </Button>
      </div>
    </div>
  );
};
