import { useI18n } from '../../../../i18n';
import { ListLinesIcon, SteerIcon, TrashIcon } from '../../../../components/icons';
import { Button } from '../../../../components/ui';
import type { QueuedInput } from '../../runtime/useChatRunQueue';

interface Props {
  inputs: QueuedInput[];
  steeringInputId?: number;
  onSteer: (id: number) => Promise<boolean>;
  onRemove: (id: number) => void;
}

export const ChatRunQueue = ({ inputs, steeringInputId, onSteer, onRemove }: Props) => {
  const { t } = useI18n();
  if (inputs.length === 0) return null;

  return (
    <div className="chat-run-queue" aria-label={t('chat.queue.pending')}>
      {inputs.map(input => (
        <div className="chat-run-queue-row" key={input.id}>
          <span className="chat-run-queue-icon" aria-hidden="true"><ListLinesIcon size={13} /></span>
          <span className="chat-run-queue-text">{input.text}</span>
          <div className="chat-run-queue-actions">
            <Button
              variant="secondary"
              size="xs"
              className="chat-run-queue-steer"
              disabled={steeringInputId !== undefined}
              onClick={() => void onSteer(input.id)}
              aria-label={t('chat.queue.steerAria')}
              title={t('chat.queue.steerAria')}
            >
              <SteerIcon size={13} />
              {t('chat.steer')}
            </Button>
            <Button
              variant="icon"
              size="sm"
              disabled={steeringInputId !== undefined}
              onClick={() => onRemove(input.id)}
              aria-label={t('chat.queue.removeAria')}
              title={t('chat.queue.removeAria')}
            >
              <TrashIcon size={13} />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
};
