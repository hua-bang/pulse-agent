import { GitBranch } from '@phosphor-icons/react';
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
}: Props) => {
  const { t } = useI18n();
  if (!showCopy && !onEdit && !onRegenerate && !onFork && (isStreaming || !relativeTime)) return null;
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
          title="Edit & resend"
          aria-label="Edit and resend"
          onClick={onEdit}
        >
          <PencilIcon size={12} />
        </button>
      )}
      {onRegenerate && (
        <button
          type="button"
          className="chat-message-toolbar-btn chat-message-toolbar-btn--icon"
          title="Regenerate response"
          aria-label="Regenerate response"
          onClick={onRegenerate}
        >
          <RefreshIcon size={12} />
        </button>
      )}
      {onFork && (
        <Button
          variant="icon"
          size="xs"
          title={t('chat.forkMessage')}
          aria-label={t('chat.forkMessage')}
          onClick={() => void onFork()}
        >
          <GitBranch size={13} />
        </Button>
      )}
      {showCopy && <CopyMessageButton content={content} />}
    </div>
  );
};
