import { useEffect, useState, type MouseEvent, type MouseEventHandler, type RefObject } from 'react';
import { dispatchFocusNodeOnCanvas, parseNodeLinkHref } from '../../../../../utils/openNodeBridge';
import { ChatImageLightbox, type LightboxImage } from '../../ChatImageLightbox';
import './index.css';

interface Props {
  bodyRef: RefObject<HTMLDivElement>;
  html: string;
  onClick?: MouseEventHandler<HTMLDivElement>;
  imagePreview?: boolean;
  /** Replaces the chat typography classes for hosts with their own document styles. */
  className?: string;
}

export const MarkdownContent = ({
  bodyRef,
  html,
  onClick,
  imagePreview = false,
  className,
}: Props) => {
  const [preview, setPreview] = useState<{ images: LightboxImage[]; index: number } | null>(null);

  const handleClick = (event: MouseEvent<HTMLDivElement>) => {
    const target = event.target instanceof HTMLElement ? event.target.closest('a[href]') : null;
    const href = target?.getAttribute('href');
    if (href) {
      const parsed = parseNodeLinkHref(href);
      if (parsed) {
        event.preventDefault();
        event.stopPropagation();
        dispatchFocusNodeOnCanvas({
          workspaceId: parsed.workspaceId ?? '',
          nodeId: parsed.nodeId,
        });
        return;
      }
    }
    onClick?.(event);
  };

  useEffect(() => {
    const body = bodyRef.current;
    if (!imagePreview || !body) return;
    const images = Array.from(body.querySelectorAll('img'));
    for (const image of images) {
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-haspopup', 'dialog');
    }
    const openImage = (event: globalThis.MouseEvent | KeyboardEvent) => {
      if (!(event.target instanceof HTMLImageElement)) return;
      if (event instanceof KeyboardEvent && event.key !== 'Enter' && event.key !== ' ') return;
      const index = images.indexOf(event.target);
      if (index < 0) return;
      event.preventDefault();
      event.stopPropagation();
      setPreview({
        images: images.map(image => ({ src: image.src, caption: image.alt })),
        index,
      });
    };
    body.addEventListener('click', openImage);
    body.addEventListener('keydown', openImage);
    return () => {
      body.removeEventListener('click', openImage);
      body.removeEventListener('keydown', openImage);
    };
  }, [bodyRef, html, imagePreview]);

  return (
    <>
      <div
        ref={bodyRef}
        className={className
          ?? `chat-message-content chat-md${imagePreview ? ' chat-md--image-preview' : ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={handleClick}
      />
      {preview && (
        <ChatImageLightbox
          images={preview.images}
          startIndex={preview.index}
          onClose={() => setPreview(null)}
        />
      )}
    </>
  );
};
