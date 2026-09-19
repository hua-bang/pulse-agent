// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { I18nProvider } from '../../../../../../i18n';
import { MarkdownContent } from '..';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root | undefined;
let host: HTMLDivElement | undefined;
let style: HTMLStyleElement | undefined;
afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  style?.remove();
});

function mount(imagePreview = true) {
  const Harness = () => {
    const ref = useRef<HTMLDivElement>(null);
    return (
      <I18nProvider>
        <MarkdownContent
          bodyRef={ref}
          imagePreview={imagePreview}
          html='<p><a href="https://example.com"><img src="https://example.com/a.png" alt="截图" /></a></p><p><img src="https://example.com/b.png" alt="长图" /></p>'
        />
      </I18nProvider>
    );
  };
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(<Harness />));
  return Array.from(host.querySelectorAll('img'));
}

it('opens linked Markdown images in the existing viewer without navigating', () => {
  const [image] = mount();
  expect(image.getAttribute('role')).toBe('button');
  expect(image.tabIndex).toBe(0);
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  act(() => { image.dispatchEvent(event); });
  expect(event.defaultPrevented).toBe(true);
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  expect(document.querySelector('.chat-image-lightbox-figure img')?.getAttribute('src')).toBe(image.src);
  act(() => {
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
  });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it.each(['Enter', ' '])('opens the selected image with %s', key => {
  const [, image] = mount();
  act(() => { image.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })); });
  expect(document.querySelector('.chat-image-lightbox-figure img')?.getAttribute('src')).toBe(image.src);
});

it('does not change non-chat Markdown previews', () => {
  const [image] = mount(false);
  expect(image.hasAttribute('role')).toBe(false);
  expect(host?.querySelector('.chat-md--image-preview')).toBeNull();
});

it('caps transcript images on both axes without cropping', () => {
  const [image] = mount();
  style = document.createElement('style');
  style.textContent = readFileSync('src/renderer/src/modules/chat/components/ChatMessage/MarkdownContent/index.css', 'utf8');
  document.head.append(style);
  const css = getComputedStyle(image);
  expect(css.maxWidth).toBe('min(100%, 360px)');
  expect(css.maxHeight).toBe('240px');
  expect(css.width).toBe('auto');
  expect(css.height).toBe('auto');
  expect(css.objectFit).toBe('contain');
});
