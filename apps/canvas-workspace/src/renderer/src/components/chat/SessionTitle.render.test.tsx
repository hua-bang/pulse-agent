// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it } from 'vitest';
import { SessionTitle } from './SessionTitle';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('SessionTitle', () => {
  it('keeps every reference chip and its label when the title carries several mentions plus a long unbroken run', () => {
    const value = '@[file:node-1|Roadmap] @[file:node-2|Launch plan] @[file:node-3|Q3 goals]'
      + ' 学习 https://github.com/solo-example/some-very-long-repository-name-that-cannot-wrap';
    const host = document.createElement('div');
    const root = createRoot(host);
    act(() => root.render(<SessionTitle value={value} />));

    const chips = host.querySelectorAll('.chat-session-title-reference');
    expect(chips).toHaveLength(3);
    expect(Array.from(chips).map(chip => chip.textContent)).toEqual(['Roadmap', 'Launch plan', 'Q3 goals']);

    // The free-form segments (the spaces between chips, and the trailing
    // text) are what's meant to give way under space pressure — each needs a
    // real element to hang truncation styling on, not a bare text node the
    // chips' fixed sizing would otherwise have to share shrink budget with.
    const textSegments = Array.from(host.querySelectorAll('.chat-session-title-text'));
    expect(textSegments.some(el => el.textContent?.includes('https://github.com/solo-example'))).toBe(true);

    act(() => root.unmount());
  });
});
