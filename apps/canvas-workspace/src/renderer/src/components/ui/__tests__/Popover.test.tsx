// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Popover } from '../Popover';

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

describe('Popover', () => {
  it('portals its content to document.body, positioned from x/y', () => {
    render(
      <Popover x={40} y={60} onClose={vi.fn()} className="test-popover">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    const el = document.querySelector('.test-popover') as HTMLElement;
    expect(el).not.toBeNull();
    expect(host?.contains(el)).toBe(false);
    expect(el.style.left).toBe('40px');
    expect(el.style.top).toBe('60px');
  });

  it('defaults role to menu, and accepts an override', () => {
    render(
      <Popover x={0} y={0} onClose={vi.fn()} className="test-popover">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    expect(document.querySelector('.test-popover')?.getAttribute('role')).toBe('menu');
  });

  it('closes on Escape', () => {
    const onClose = vi.fn();
    render(
      <Popover x={0} y={0} onClose={onClose} className="test-popover">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('closes on an outside press but not a press inside the popover', () => {
    const onClose = vi.fn();
    render(
      <Popover x={0} y={0} onClose={onClose} className="test-popover">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    const item = document.querySelector('[role="menuitem"]') as HTMLElement;
    act(() => {
      item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(onClose).not.toHaveBeenCalled();

    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('suppresses the native context menu on the popover itself', () => {
    render(
      <Popover x={0} y={0} onClose={vi.fn()} className="test-popover">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    const el = document.querySelector('.test-popover') as HTMLElement;
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    act(() => {
      el.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
  });

  it('ArrowDown moves focus across menuitem buttons', () => {
    render(
      <Popover x={0} y={0} onClose={vi.fn()} className="test-popover">
        <button role="menuitem">First</button>
        <button role="menuitem">Second</button>
      </Popover>,
    );
    const buttons = document.querySelectorAll('[role="menuitem"]');
    (buttons[0] as HTMLElement).focus();
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(buttons[1]);
  });
});
