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

// --- rect-anchor mode test helpers ---------------------------------------
// happy-dom has no real layout engine — getBoundingClientRect()/offsetWidth/
// offsetHeight/window.innerWidth/innerHeight are all 0 (or a fixed default)
// unless explicitly stubbed. These helpers stub exactly what
// useAnchorRectPosition reads, and register their own restoration so one
// test's stub never leaks into the next.
let restoreFns: Array<() => void> = [];

afterEach(() => {
  restoreFns.forEach((fn) => fn());
  restoreFns = [];
});

/** A detached-from-React anchor element with a fixed, stubbed rect — a
 *  RefObject can point straight at it without mounting it via React. */
function createAnchor(rect: Partial<DOMRect>): { current: HTMLElement } {
  const el = document.createElement('button');
  document.body.appendChild(el);
  setAnchorRect(el, rect);
  return { current: el };
}

/** Re-stubs an existing anchor's rect (simulates the page scrolling the
 *  anchor to a new viewport position). */
function setAnchorRect(el: HTMLElement, rect: Partial<DOMRect>) {
  const full: DOMRect = {
    top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0,
    toJSON() { return this; },
    ...rect,
  } as DOMRect;
  Object.defineProperty(el, 'getBoundingClientRect', { value: () => full, configurable: true });
}

/** Stubs EVERY element's offsetWidth/offsetHeight to a fixed size — happy-dom
 *  never lays out real content, so this is the only way to give the panel a
 *  non-zero measured size for the placement/flip/clamp math to react to. */
function mockPanelSize(width: number, height: number) {
  const widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');
  const heightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => width });
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => height });
  restoreFns.push(() => {
    if (widthDesc) Object.defineProperty(HTMLElement.prototype, 'offsetWidth', widthDesc);
    if (heightDesc) Object.defineProperty(HTMLElement.prototype, 'offsetHeight', heightDesc);
  });
}

function setViewport(width: number, height: number) {
  const widthDesc = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const heightDesc = Object.getOwnPropertyDescriptor(window, 'innerHeight');
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  restoreFns.push(() => {
    if (widthDesc) Object.defineProperty(window, 'innerWidth', widthDesc);
    if (heightDesc) Object.defineProperty(window, 'innerHeight', heightDesc);
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

  it('autofocuses the first menuitem on mount by default', () => {
    render(
      <Popover x={0} y={0} onClose={vi.fn()} className="test-popover">
        <button role="menuitem">First</button>
        <button role="menuitem">Second</button>
      </Popover>,
    );
    const buttons = document.querySelectorAll('[role="menuitem"]');
    expect(document.activeElement).toBe(buttons[0]);
  });

  it('autoFocus={false} leaves focus untouched, for combobox-style callers anchoring next to a live filter input', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    input.focus();
    expect(document.activeElement).toBe(input);

    render(
      <Popover x={0} y={0} onClose={vi.fn()} className="test-popover" autoFocus={false}>
        <button role="menuitem">First</button>
        <button role="menuitem">Second</button>
      </Popover>,
    );
    expect(document.activeElement).toBe(input);
    input.remove();
  });

  it('autoFocus={false} still closes on Escape and still navigates via ArrowDown', () => {
    const onClose = vi.fn();
    render(
      <Popover x={0} y={0} onClose={onClose} className="test-popover" autoFocus={false}>
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

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('renders ariaLabel and panelId when provided, for a trigger to point aria-controls at', () => {
    render(
      <Popover x={0} y={0} onClose={vi.fn()} className="test-popover" ariaLabel="Choose a model" panelId="my-panel">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    const el = document.querySelector('.test-popover') as HTMLElement;
    expect(el.id).toBe('my-panel');
    expect(el.getAttribute('aria-label')).toBe('Choose a model');
  });
});

describe('Popover — rect anchor mode (anchorRef)', () => {
  it('positions the panel below the anchor by default (placement="bottom", align="start")', () => {
    setViewport(1000, 800);
    mockPanelSize(80, 40);
    const anchor = createAnchor({ top: 100, left: 50, right: 150, bottom: 130, width: 100, height: 30 });

    render(
      <Popover anchorRef={anchor} onClose={vi.fn()} className="test-popover">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    const el = document.querySelector('.test-popover') as HTMLElement;
    // bottom placement: top = anchor.bottom + gap(8) = 138; align start: left = anchor.left = 50.
    expect(el.style.top).toBe('138px');
    expect(el.style.left).toBe('50px');
  });

  it('aligns "end" to the anchor\'s right edge', () => {
    setViewport(1000, 800);
    mockPanelSize(80, 40);
    const anchor = createAnchor({ top: 100, left: 50, right: 150, bottom: 130, width: 100, height: 30 });

    render(
      <Popover anchorRef={anchor} onClose={vi.fn()} className="test-popover" align="end">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    const el = document.querySelector('.test-popover') as HTMLElement;
    // align end: left = anchor.right - panelWidth = 150 - 80 = 70.
    expect(el.style.left).toBe('70px');
  });

  it('flips from "top" to below when there is no room above the anchor (ModelSwitcher\'s exact shape)', () => {
    setViewport(1000, 800);
    mockPanelSize(292, 200);
    // Anchor sits near the top of the viewport — 200 + gap(8) = 208 > anchor.top (20), so
    // placement="top" doesn't fit above and must flip below.
    const anchor = createAnchor({ top: 20, left: 700, right: 800, bottom: 50, width: 100, height: 30 });

    render(
      <Popover anchorRef={anchor} onClose={vi.fn()} className="test-popover" placement="top" align="end" gap={8} viewportMargin={12}>
        <button role="menuitem">Item</button>
      </Popover>,
    );
    const el = document.querySelector('.test-popover') as HTMLElement;
    // Flipped: top = anchor.bottom + gap = 58 (fits comfortably under 800 - 200 - 12).
    expect(el.style.top).toBe('58px');
  });

  it('renders above the anchor when placement="top" fits', () => {
    setViewport(1000, 800);
    mockPanelSize(292, 200);
    // Plenty of room above: anchor.top(400) - panelHeight(200) - gap(8) = 192 >= margin(12).
    const anchor = createAnchor({ top: 400, left: 700, right: 800, bottom: 430, width: 100, height: 30 });

    render(
      <Popover anchorRef={anchor} onClose={vi.fn()} className="test-popover" placement="top" align="end" gap={8} viewportMargin={12}>
        <button role="menuitem">Item</button>
      </Popover>,
    );
    const el = document.querySelector('.test-popover') as HTMLElement;
    expect(el.style.top).toBe('192px');
    expect(el.style.left).toBe('508px'); // anchor.right(800) - panelWidth(292)
  });

  it('clamps the panel inside the viewport when the anchor sits near an edge', () => {
    setViewport(300, 300);
    mockPanelSize(200, 200);
    // Anchor near the bottom-right corner; unclamped left/top would overflow past the viewport.
    const anchor = createAnchor({ top: 280, left: 280, right: 290, bottom: 295, width: 10, height: 15 });

    render(
      <Popover anchorRef={anchor} onClose={vi.fn()} className="test-popover">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    const el = document.querySelector('.test-popover') as HTMLElement;
    // Horizontal: align start's left(280) clamps down to 300 - 200 - 8 = 92.
    // Vertical: default placement="bottom" doesn't fit below (bottom(295)+gap(8)+
    // panelHeight(200) overflows), flips to above: anchor.top(280) - panelHeight(200)
    // - gap(8) = 72, which is already within [margin, viewportHeight-panelHeight-margin]
    // so the flip's own clamp doesn't need to move it further.
    expect(el.style.left).toBe('92px');
    expect(el.style.top).toBe('72px');
  });

  it('reanchors when the window resizes', () => {
    setViewport(1000, 800);
    mockPanelSize(80, 40);
    const anchor = createAnchor({ top: 100, left: 50, right: 150, bottom: 130, width: 100, height: 30 });

    render(
      <Popover anchorRef={anchor} onClose={vi.fn()} className="test-popover">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    const el = document.querySelector('.test-popover') as HTMLElement;
    expect(el.style.top).toBe('138px');

    // Simulate the trigger moving (e.g. a responsive layout reflow) and the
    // window firing 'resize' — the listener should re-measure and reposition.
    setAnchorRect(anchor.current, { top: 300, left: 50, right: 150, bottom: 330, width: 100, height: 30 });
    act(() => {
      window.dispatchEvent(new Event('resize'));
    });
    expect(el.style.top).toBe('338px');
  });

  it('reanchors on capture-phase scroll (ancestor scroll containers do not bubble a plain scroll listener)', () => {
    setViewport(1000, 800);
    mockPanelSize(80, 40);
    const anchor = createAnchor({ top: 100, left: 50, right: 150, bottom: 130, width: 100, height: 30 });

    render(
      <Popover anchorRef={anchor} onClose={vi.fn()} className="test-popover">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    const el = document.querySelector('.test-popover') as HTMLElement;
    expect(el.style.top).toBe('138px');

    // Simulate an ancestor scroll container moving the anchor's viewport rect.
    // Real nested-scroll-container events don't bubble to window; only a
    // window listener registered in the CAPTURE phase observes them — this
    // dispatches straight at window (the capture listener's own target), the
    // one piece of that contract happy-dom can actually exercise. Whether a
    // capture-phase listener genuinely observes an inner scrollable div's
    // native scroll event is standard DOM behavior this test doesn't
    // reprove; what it DOES prove is that Popover's rect-anchor mode wires
    // a scroll listener that re-measures and repositions when fired.
    setAnchorRect(anchor.current, { top: 20, left: 50, right: 150, bottom: 50, width: 100, height: 30 });
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(el.style.top).toBe('58px');
  });

  it('still closes on Escape — the shared hooks bind to the rect-anchor ref just like the point-anchor one', () => {
    setViewport(1000, 800);
    mockPanelSize(80, 40);
    const anchor = createAnchor({ top: 100, left: 50, right: 150, bottom: 130, width: 100, height: 30 });
    const onClose = vi.fn();

    render(
      <Popover anchorRef={anchor} onClose={onClose} className="test-popover">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('still dismisses on an outside press', () => {
    setViewport(1000, 800);
    mockPanelSize(80, 40);
    const anchor = createAnchor({ top: 100, left: 50, right: 150, bottom: 130, width: 100, height: 30 });
    const onClose = vi.fn();

    render(
      <Popover anchorRef={anchor} onClose={onClose} className="test-popover">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    act(() => {
      document.body.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('does NOT treat a press on the anchor itself as an outside press (the anchor is the trigger)', () => {
    setViewport(1000, 800);
    mockPanelSize(80, 40);
    const anchor = createAnchor({ top: 100, left: 50, right: 150, bottom: 130, width: 100, height: 30 });
    const onClose = vi.fn();

    render(
      <Popover anchorRef={anchor} onClose={onClose} className="test-popover">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    act(() => {
      anchor.current.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('stays off-screen and hidden until the anchor has no rect to measure (e.g. anchorRef.current is null)', () => {
    setViewport(1000, 800);
    mockPanelSize(80, 40);
    const emptyAnchor = { current: null };

    render(
      <Popover anchorRef={emptyAnchor} onClose={vi.fn()} className="test-popover">
        <button role="menuitem">Item</button>
      </Popover>,
    );
    const el = document.querySelector('.test-popover') as HTMLElement;
    expect(el.style.left).toBe('-9999px');
    expect(el.style.top).toBe('-9999px');
    expect(el.style.visibility).toBe('hidden');
  });
});
