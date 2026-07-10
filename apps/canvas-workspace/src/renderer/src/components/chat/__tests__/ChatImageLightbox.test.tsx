// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '../../../i18n';
import { ChatImageLightbox, type LightboxImage } from '../ChatImageLightbox';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
}

const IMAGES: LightboxImage[] = [
  { src: 'a.png', caption: 'First' },
  { src: 'b.png', caption: 'Second' },
];

/**
 * Re-shelled onto ui/Modal (C1). These specs pin the behavior the migration
 * had to preserve by hand (arrow-key paging as a plain onKeyDown, since
 * Modal only owns Escape) plus what Modal now provides for free (Escape,
 * dialog role, portal).
 */
describe('ChatImageLightbox', () => {
  it('renders through a portal with a dialog role (Modal)', () => {
    render(
      <I18nProvider>
        <ChatImageLightbox images={IMAGES} startIndex={0} onClose={() => undefined} />
      </I18nProvider>,
    );
    // Modal portals to document.body — the lightbox card is not inside `host`.
    expect(host?.querySelector('.chat-image-lightbox-card')).toBeNull();
    const card = document.querySelector('.chat-image-lightbox-card');
    expect(card?.getAttribute('role')).toBe('dialog');
    expect(card?.getAttribute('aria-modal')).toBe('true');
    expect(document.querySelector('.chat-image-lightbox-surface img')?.getAttribute('src')).toBe('a.png');
  });

  it('closes on Escape via Modal\'s useEscapeClose', () => {
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <ChatImageLightbox images={IMAGES} startIndex={0} onClose={onClose} />
      </I18nProvider>,
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('pages with ArrowRight/ArrowLeft via a plain onKeyDown (no raw addEventListener)', () => {
    render(
      <I18nProvider>
        <ChatImageLightbox images={IMAGES} startIndex={0} onClose={() => undefined} />
      </I18nProvider>,
    );
    const surface = document.querySelector('.chat-image-lightbox-surface') as HTMLElement;
    expect(document.querySelector('.chat-image-lightbox-figure img')?.getAttribute('src')).toBe('a.png');

    act(() => {
      surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.chat-image-lightbox-figure img')?.getAttribute('src')).toBe('b.png');

    act(() => {
      surface.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.chat-image-lightbox-figure img')?.getAttribute('src')).toBe('a.png');
  });

  it('closes on a click on the dim surface, but not on the image or a control', () => {
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <ChatImageLightbox images={IMAGES} startIndex={0} onClose={onClose} />
      </I18nProvider>,
    );
    const img = document.querySelector('.chat-image-lightbox-figure img') as HTMLElement;
    act(() => {
      img.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    const surface = document.querySelector('.chat-image-lightbox-surface') as HTMLElement;
    act(() => {
      surface.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('the close button calls onClose', () => {
    const onClose = vi.fn();
    render(
      <I18nProvider>
        <ChatImageLightbox images={IMAGES} startIndex={0} onClose={onClose} />
      </I18nProvider>,
    );
    const closeBtn = document.querySelector('.chat-image-lightbox-close') as HTMLElement;
    act(() => {
      closeBtn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
