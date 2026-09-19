import { useEffect, useState, type MouseEventHandler, type RefObject } from 'react';
import { ChatImageLightbox, type LightboxImage } from '../../ChatImageLightbox';
import './index.css';

interface Props {
  bodyRef: RefObject<HTMLDivElement>;
  html: string;
  streaming?: boolean;
  onClick?: MouseEventHandler<HTMLDivElement>;
  imagePreview?: boolean;
}

export const MarkdownContent = ({
  bodyRef,
  html,
  streaming = false,
  onClick,
  imagePreview = false,
}: Props) => {
  const [preview, setPreview] = useState<{ images: LightboxImage[]; index: number } | null>(null);

  useEffect(() => {
    const body = bodyRef.current;
    if (!imagePreview || !body) return;
    const images = Array.from(body.querySelectorAll('img'));
    for (const image of images) {
      image.tabIndex = 0;
      image.setAttribute('role', 'button');
      image.setAttribute('aria-haspopup', 'dialog');
    }
    const openImage = (event: MouseEvent | KeyboardEvent) => {
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
        className={`chat-message-content chat-md${streaming ? ' chat-md--streaming' : ''}${imagePreview ? ' chat-md--image-preview' : ''}`}
        dangerouslySetInnerHTML={{ __html: html }}
        onClick={onClick}
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
