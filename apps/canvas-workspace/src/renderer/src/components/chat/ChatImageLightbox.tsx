/**
 * ChatImageLightbox — fullscreen preview for images in the chat transcript.
 *
 * Renders through a portal (matching SettingsDrawer / context menus) so the
 * overlay escapes the chat panel's stacking + overflow. Supports keyboard
 * (Esc to close, ←/→ to page when a message has several images), backdrop
 * click-to-close, and an on-screen prev/next + counter for galleries.
 */

import { useCallback, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { CheckIcon, CloseIcon, CopyIcon } from '../icons';
import { useI18n } from '../../i18n';
import { copyTextToClipboard } from '../../utils/clipboard';
import { toFileUrl } from '../../utils/fileUrl';

export interface LightboxImage {
  src: string;
  filePath?: string;
  caption?: string;
}

interface ChatImageLightboxProps {
  images: LightboxImage[];
  startIndex: number;
  onClose: () => void;
}

export const ChatImageLightbox = ({ images, startIndex, onClose }: ChatImageLightboxProps) => {
  const { t } = useI18n();
  const [index, setIndex] = useState(startIndex);
  const [copied, setCopied] = useState(false);
  const count = images.length;

  // Re-sync when the caller opens a different image without unmounting (e.g.
  // clicking a second thumbnail while the viewer is already open).
  useEffect(() => {
    setIndex(startIndex);
  }, [startIndex]);

  const goPrev = useCallback(() => {
    setIndex(prev => (prev - 1 + count) % count);
  }, [count]);
  const goNext = useCallback(() => {
    setIndex(prev => (prev + 1) % count);
  }, [count]);

  const handleCopy = useCallback(async () => {
    const image = images[Math.min(Math.max(index, 0), Math.max(count - 1, 0))];
    if (!image) return;
    try {
      if (image.filePath) {
        const result = await window.canvasWorkspace.file.copyImage(image.filePath);
        if (result.ok) {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
          return;
        }
      }
      await copyTextToClipboard(image.filePath ? toFileUrl(image.filePath) : image.src);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      /* clipboard unavailable — keep viewer open */
    }
  }, [count, images, index]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      } else if (event.key === 'ArrowLeft' && count > 1) {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight' && count > 1) {
        event.preventDefault();
        goNext();
      }
    };
    window.addEventListener('keydown', handler);
    // Lock background scroll while the viewer is open.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', handler);
      document.body.style.overflow = previousOverflow;
    };
  }, [count, goPrev, goNext, onClose]);

  useEffect(() => {
    setCopied(false);
  }, [index]);

  const safeIndex = Math.min(Math.max(index, 0), Math.max(count - 1, 0));
  const current = images[safeIndex];
  if (!current) return null;

  return createPortal(
    <div
      className="chat-image-lightbox-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={current.caption ?? t('chat.imageViewer')}
      onClick={(event) => {
        // Only a click on the dim backdrop itself dismisses; clicks on the
        // image, caption, or controls fall through to their own handlers.
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button
        type="button"
        className="chat-image-lightbox-action chat-image-lightbox-copy"
        onClick={() => void handleCopy()}
        aria-label={t('chat.copyImage')}
        title={copied ? t('chat.imageCopied') : t('chat.copyImage')}
      >
        {copied ? <CheckIcon size={18} strokeWidth={1.8} /> : <CopyIcon size={18} />}
      </button>

      <button
        type="button"
        className="chat-image-lightbox-action chat-image-lightbox-close"
        onClick={onClose}
        aria-label={t('chat.closeImage')}
        title={t('chat.closeImage')}
      >
        <CloseIcon size={18} />
      </button>

      {count > 1 && (
        <button
          type="button"
          className="chat-image-lightbox-nav chat-image-lightbox-nav--prev"
          onClick={goPrev}
          aria-label={t('chat.previousImage')}
          title={t('chat.previousImage')}
        >
          ‹
        </button>
      )}

      <figure className="chat-image-lightbox-figure">
        <img src={current.src} alt={current.caption ?? t('chat.imageViewer')} draggable={false} />
        {(current.caption || count > 1) && (
          <figcaption className="chat-image-lightbox-caption">
            {current.caption && <span>{current.caption}</span>}
            {count > 1 && (
              <span className="chat-image-lightbox-counter">{safeIndex + 1} / {count}</span>
            )}
          </figcaption>
        )}
      </figure>

      {count > 1 && (
        <button
          type="button"
          className="chat-image-lightbox-nav chat-image-lightbox-nav--next"
          onClick={goNext}
          aria-label={t('chat.nextImage')}
          title={t('chat.nextImage')}
        >
          ›
        </button>
      )}
    </div>,
    document.body,
  );
};
