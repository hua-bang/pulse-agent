/**
 * ChatImageLightbox — fullscreen preview for images in the chat transcript.
 *
 * Re-shelled onto ui/Modal (C1): Modal owns the portal, ESC close, backdrop
 * mechanics, dialog role/aria, and focus trap. The card is stretched to
 * `position: fixed; inset: 0` (via className) so it fully covers the
 * viewport like the original bespoke overlay did — action buttons and
 * prev/next nav stay anchored to the screen corners regardless of image
 * size, matching the pre-migration layout. Because the card visually IS the
 * dim backdrop here, it carries its own backdrop-click-to-close (Modal's own
 * backdrop still closes on click too, but sits fully behind the card and is
 * never actually the click target). Only the arrow-key paging listener
 * remains bespoke — it's coupled to gallery paging state Modal doesn't
 * know about, so it lives as a plain `onKeyDown` on the card (a React
 * synthetic handler, not a raw `addEventListener('keydown'`) rather than
 * ESC, which Modal's `useEscapeClose` now owns outright.
 */

import { useCallback, useEffect, useId, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { CheckIcon, CloseIcon, CopyIcon } from '../icons';
import { Modal } from '../ui';
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

  // ESC is Modal's job now (useEscapeClose); this only locks background
  // scroll while the viewer is open — no keydown listener left here.
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  const handleArrowNav = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key === 'ArrowLeft' && count > 1) {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight' && count > 1) {
        event.preventDefault();
        goNext();
      }
    },
    [count, goPrev, goNext],
  );

  useEffect(() => {
    setCopied(false);
  }, [index]);

  const titleId = useId();
  const safeIndex = Math.min(Math.max(index, 0), Math.max(count - 1, 0));
  const current = images[safeIndex];
  if (!current) return null;

  return (
    <Modal open onClose={onClose} labelledBy={titleId} className="chat-image-lightbox-card">
      <div
        className="chat-image-lightbox-surface"
        onKeyDown={handleArrowNav}
        onClick={(event) => {
          // Only a click on the dim surface itself dismisses (not a
          // mousedown, so a text-selection drag that ends over empty space
          // doesn't accidentally close it); clicks on the image, caption, or
          // controls fall through to their own handlers. The card fully
          // covers Modal's own backdrop (this IS the visible dim area), so
          // it needs its own copy of the click-outside-the-image-to-close
          // pattern Modal's backdrop uses.
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <h2 id={titleId} className="chat-image-lightbox-visually-hidden">
          {current.caption ?? t('chat.imageViewer')}
        </h2>
        <button
          type="button"
          className="chat-image-lightbox-action chat-image-lightbox-copy"
          onClick={() => void handleCopy()}
          aria-label="Copy image"
          title={copied ? 'Copied!' : 'Copy image'}
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
      </div>
    </Modal>
  );
};
