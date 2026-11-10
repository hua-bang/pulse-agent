// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { contentOwnsWheel } from './contentOwnsWheel';

const surface = document.createElement('div');
const scroller = document.createElement('div');
const paragraph = document.createElement('p');
scroller.appendChild(paragraph);
surface.appendChild(scroller);
document.body.appendChild(surface);

const size = (element: HTMLElement, key: string, value: number) => {
  Object.defineProperty(element, key, { configurable: true, value });
};

const wheel = (overrides: Partial<Parameters<typeof contentOwnsWheel>[0]> = {}) => ({
  ctrlKey: false,
  metaKey: false,
  deltaX: 0,
  deltaY: 40,
  target: paragraph,
  currentTarget: surface,
  ...overrides,
});

describe('contentOwnsWheel', () => {
  afterEach(() => {
    scroller.removeAttribute('style');
    for (const key of ['scrollHeight', 'clientHeight', 'scrollWidth', 'clientWidth']) {
      size(scroller, key, 0);
    }
  });

  it('leaves the wheel to the canvas when the note content fits', () => {
    scroller.style.overflowY = 'auto';
    size(scroller, 'scrollHeight', 200);
    size(scroller, 'clientHeight', 200);
    expect(contentOwnsWheel(wheel())).toBe(false);
  });

  it('keeps the wheel when the note has more content to scroll', () => {
    scroller.style.overflowY = 'auto';
    size(scroller, 'scrollHeight', 900);
    size(scroller, 'clientHeight', 200);
    expect(contentOwnsWheel(wheel())).toBe(true);
    // A vertical overflow does not claim a horizontal wheel.
    expect(contentOwnsWheel(wheel({ deltaX: 40, deltaY: 0 }))).toBe(false);
  });

  it('never keeps a zoom gesture', () => {
    scroller.style.overflowY = 'auto';
    size(scroller, 'scrollHeight', 900);
    size(scroller, 'clientHeight', 200);
    expect(contentOwnsWheel(wheel({ ctrlKey: true }))).toBe(false);
    expect(contentOwnsWheel(wheel({ metaKey: true }))).toBe(false);
  });

  it('ignores clipped content that cannot scroll', () => {
    scroller.style.overflowY = 'hidden';
    size(scroller, 'scrollHeight', 900);
    size(scroller, 'clientHeight', 200);
    expect(contentOwnsWheel(wheel())).toBe(false);
  });
});
