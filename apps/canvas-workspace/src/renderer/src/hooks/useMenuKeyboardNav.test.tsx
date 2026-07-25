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
});
