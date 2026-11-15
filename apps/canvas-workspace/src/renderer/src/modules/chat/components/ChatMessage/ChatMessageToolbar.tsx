import { GitBranch, NotePencil } from '@phosphor-icons/react';
import { PencilIcon, RefreshIcon } from '../../../../components/icons';
import { Button } from '../../../../components/ui';
import { useI18n } from '../../../../i18n';
import { CopyMessageButton } from './ChatMessageActions';

interface Props {
  content: string;
  timestamp: number;
  relativeTime: string;
  absoluteTime: string;
  isStreaming: boolean;
  showCopy: boolean;
  onEdit?: () => void;
  onRegenerate?: () => void;
  onFork?: () => Promise<boolean> | void;
  /** Keep this reply on the canvas as a note. */
  onAddToCanvas?: () => void;
}

export const ChatMessageToolbar = ({
  content,
  timestamp,
  relativeTime,
  absoluteTime,
  isStreaming,
  showCopy,
  onEdit,
  onRegenerate,
  onFork,
  onAddToCanvas,
}: Props) => {
  const { t } = useI18n();
  const hasAction = showCopy || onEdit || onRegenerate || onFork || onAddToCanvas;
  if (!hasAction && (isStreaming || !relativeTime)) return null;
  return (
    <div className="chat-message-toolbar">
      {!isStreaming && relativeTime && (
        <time className="chat-message-timestamp" dateTime={new Date(timestamp).toISOString()} title={absoluteTime}>
          {relativeTime}
        </time>
      )}
      {onEdit && (
        <button
          type="button"
          className="chat-message-toolbar-btn chat-message-toolbar-btn--icon"
          title={t('chat.recovery.editTitle')}
          aria-label={t('chat.recovery.editAction')}
          onClick={onEdit}
        >
          <PencilIcon size={12} />
        </button>
      )}
      {onRegenerate && (
        <button
          type="button"
          className="chat-message-toolbar-btn chat-message-toolbar-btn--icon"
          title={t('chat.recovery.regenerateAction')}
          aria-label={t('chat.recovery.regenerateAction')}
          onClick={onRegenerate}
        >
          <RefreshIcon size={12} />
        </button>
      )}
      {onFork && (
        <Button
          variant="icon"
          size="sm"
          className="chat-message-toolbar-btn chat-message-toolbar-btn--icon"
          title={t('chat.forkMessage')}
          aria-label={t('chat.forkMessage')}
          onClick={() => void onFork()}
        >
          <GitBranch size={12} />
        </Button>
      )}
      {onAddToCanvas && (
        <Button
          variant="icon"
          size="sm"
          className="chat-message-toolbar-btn chat-message-toolbar-btn--icon"
          title={t('chat.addToCanvas')}
          aria-label={t('chat.addToCanvas')}
          onClick={onAddToCanvas}
        >
          <NotePencil size={12} />
        </Button>
      )}
      {showCopy && <CopyMessageButton content={content} />}
    </div>
  );
};
