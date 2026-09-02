import { useMemo, useState } from 'react';
import type { ChatImageAttachment } from '../../../types';
import { useI18n } from '../../../i18n';
import { toFileUrl } from '../../../utils/fileUrl';
import { ImageIcon } from '../../icons';
import { ChatImageLightbox, type LightboxImage } from '../ChatImageLightbox';

interface Props {
  attachments: ChatImageAttachment[];
  readyAttachments: ChatImageAttachment[];
  interactionDisabled: boolean;
  onRemoveAttachment?: (id: string) => void;
  onRetryAttachment?: (id: string) => void;
}

export const ChatInputAttachments = ({
  attachments,
  readyAttachments,
  interactionDisabled,
  onRemoveAttachment,
  onRetryAttachment,
}: Props) => {
  const { t } = useI18n();
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);
  const lightboxImages = useMemo<LightboxImage[]>(() => readyAttachments.map(attachment => ({
    src: toFileUrl(attachment.path),
    caption: attachment.fileName,
  })), [readyAttachments]);

  return (
    <>
      {attachments.length > 0 && (
        <div className="chat-attachment-strip" aria-label={t('chat.pendingImages')}>
          {attachments.map((attachment) => {
            const status = attachment.status ?? 'ready';
            const canPreview = status === 'ready' && Boolean(attachment.path);
            const attachmentLabel = attachment.fileName ?? t('chat.imageFallback');
            const previewIndex = readyAttachments.findIndex(item => item.id === attachment.id);
            return (
              <div
                key={attachment.id}
                className={`chat-attachment-chip chat-attachment-chip--${status}`}
                data-status={status}
              >
                {canPreview ? (
                  <button
                    type="button"
                    className="chat-attachment-preview"
                    title={attachmentLabel}
                    aria-label={`${t('chat.imageViewer')}: ${attachmentLabel}`}
                    onClick={() => setLightboxIndex(previewIndex)}
                  >
                    <img src={toFileUrl(attachment.path)} alt={attachment.fileName ?? t('chat.attachmentAlt')} />
                  </button>
                ) : (
                  <span className="chat-attachment-placeholder" aria-hidden="true">
                    <ImageIcon size={16} strokeWidth={1.35} />
                  </span>
                )}
                <span className="chat-attachment-details">
                  <span className="chat-attachment-name">{attachmentLabel}</span>
                  {status === 'uploading' && (
                    <span className="chat-attachment-status" role="status">
                      {t('chat.attachmentUploading')}
                    </span>
                  )}
                  {status === 'failed' && (
                    <span className="chat-attachment-error" role="alert">
                      {attachment.error ?? t('chat.attachmentFailed')}
                    </span>
                  )}
                </span>
                {status === 'failed' && attachment.retryable !== false && onRetryAttachment && (
                  <button
                    type="button"
                    className="chat-attachment-retry"
                    onClick={() => onRetryAttachment(attachment.id)}
                    disabled={interactionDisabled}
                    aria-label={t('chat.retryAttachment', { name: attachmentLabel })}
                  >
                    {t('chat.retry')}
                  </button>
                )}
                <button
                  type="button"
                  className="chat-attachment-remove"
                  onClick={() => onRemoveAttachment?.(attachment.id)}
                  disabled={interactionDisabled || status === 'uploading'}
                  aria-label={t('chat.removeImage', { name: attachmentLabel })}
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}
      {lightboxIndex !== null && lightboxImages[lightboxIndex] && (
        <ChatImageLightbox
          images={lightboxImages}
          startIndex={lightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
};
