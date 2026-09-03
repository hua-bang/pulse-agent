import { memo, useCallback, useState } from 'react';
import { CheckIcon, CopyIcon } from '../../icons';
import { useI18n } from '../../../i18n';

export const CopyMessageButton = memo(({ content }: { content: string }) => {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }, [content]);

  return (
    <button
      type="button"
      className={`chat-message-toolbar-btn chat-message-toolbar-btn--icon${copied ? ' chat-message-toolbar-btn--copied' : ''}`}
      title={copied ? t('chat.copied') : t('chat.copyMessageMarkdown')}
      aria-label={t('chat.copyMessage')}
      onClick={handleCopy}
    >
      {copied ? <CheckIcon size={12} strokeWidth={1.8} /> : <CopyIcon size={12} />}
    </button>
  );
});
CopyMessageButton.displayName = 'CopyMessageButton';

export const ChatLoadingDots = () => (
  <div className="chat-loading">
    <div className="chat-loading-dot" />
    <div className="chat-loading-dot" />
    <div className="chat-loading-dot" />
  </div>
);
