// @vitest-environment happy-dom
import { act, useRef } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it } from 'vitest';
import { useMenuKeyboardNav } from './useMenuKeyboardNav';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

describe('useMenuKeyboardNav', () => {
  it('does not steal arrow keys while an IME composition is active', () => {
    const Harness = () => {
      const menuRef = useRef<HTMLDivElement>(null);
      useMenuKeyboardNav(menuRef, undefined, { autoFocus: false });
      return (
        <div ref={menuRef}>
          <button type="button">First</button>
          <button type="button">Second</button>
        </div>
      );
    };

    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));

    const composing = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
      isComposing: true,
    });
    act(() => window.dispatchEvent(composing));
    expect(composing.defaultPrevented).toBe(false);
    expect(document.activeElement).toBe(document.body);

    const ordinary = new KeyboardEvent('keydown', {
      key: 'ArrowDown',
      bubbles: true,
      cancelable: true,
    });
    act(() => window.dispatchEvent(ordinary));
    expect(ordinary.defaultPrevented).toBe(true);
    expect(document.activeElement?.textContent).toBe('First');
  });

  // Regression: the auto-focused first item and the hovered item were both
  // highlighted, so the menu showed two "current" rows.
  it('moves focus to the hovered item, but never out of a search field', () => {
    const Harness = () => {
      const menuRef = useRef<HTMLDivElement>(null);
      useMenuKeyboardNav(menuRef);
      return (
        <div ref={menuRef}>
          <input aria-label="Filter" />
          <button type="button">First</button>
          <button type="button">Second</button>
        </div>
      );
    };

    host = document.createElement('div');
    document.body.append(host);
    root = createRoot(host);
    act(() => root?.render(<Harness />));
    const [first, second] = Array.from(host.querySelectorAll('button'));
    expect(document.activeElement).toBe(first);

    act(() => second.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(document.activeElement).toBe(second);

    const filter = host.querySelector('input') as HTMLInputElement;
    filter.focus();
    act(() => first.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })));
    expect(document.activeElement).toBe(filter);
  });
});
