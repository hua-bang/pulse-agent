// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { __escapeStackDepth, useEscapeClose } from './useEscapeClose';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

const Subscriber = ({ active, onClose }: { active: boolean; onClose: () => void }) => {
  useEscapeClose(active, onClose);
  return null;
};

const render = async (element: React.ReactNode) => {
  if (!root) {
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
  }
  await act(async () => { root?.render(element); });
};

const pressEscape = async (target: EventTarget = document.body) => {
  await act(async () => {
    target.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Escape',
      bubbles: true,
      cancelable: true,
    }));
  });
};

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  expect(__escapeStackDepth()).toBe(0);
  vi.restoreAllMocks();
});

describe('useEscapeClose', () => {
  it('closes the only open subscriber', async () => {
    const onClose = vi.fn();
    await render(<Subscriber active onClose={onClose} />);

    await pressEscape();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  /**
   * A `ui/Select` opened inside a `ui/Modal`. Both subscribe on `document` in
   * the capture phase, and same-node listeners run in REGISTRATION order, so
   * the modal — open first — used to answer first and take the whole unsaved
   * form with it. `stopPropagation` never had a say: it does not reach
   * siblings.
   */
  it('gives Escape to the innermost overlay, not the one that opened first', async () => {
    const closeModal = vi.fn();
    const closeMenu = vi.fn();

    await render(<Subscriber active onClose={closeModal} />);
    await render(
      <>
        <Subscriber active onClose={closeModal} />
        <Subscriber active onClose={closeMenu} />
      </>,
    );

    await pressEscape();
    expect(closeMenu).toHaveBeenCalledTimes(1);
    expect(closeModal).not.toHaveBeenCalled();

    // The menu closed; the next press belongs to the modal behind it.
    await render(<Subscriber active onClose={closeModal} />);
    await pressEscape();
    expect(closeModal).toHaveBeenCalledTimes(1);
    expect(closeMenu).toHaveBeenCalledTimes(1);
  });

  it('hands the press back after an inner subscriber merely deactivates', async () => {
    const outer = vi.fn();
    const inner = vi.fn();
    const tree = (innerActive: boolean) => (
      <>
        <Subscriber active onClose={outer} />
        <Subscriber active={innerActive} onClose={inner} />
      </>
    );

    await render(tree(true));
    await pressEscape();
    expect(inner).toHaveBeenCalledTimes(1);

    await render(tree(false));
    await pressEscape();
    expect(outer).toHaveBeenCalledTimes(1);
    expect(inner).toHaveBeenCalledTimes(1);
  });

  /**
   * The press is consumed so it cannot also reach window-level shortcuts or
   * the bubble-phase Escape owners — but only while something is open.
   */
  it('consumes the press while open and leaves it alone once nothing is', async () => {
    const bubbleListener = vi.fn();
    document.addEventListener('keydown', bubbleListener);
    try {
      await render(<Subscriber active onClose={vi.fn()} />);
      await pressEscape();
      expect(bubbleListener).not.toHaveBeenCalled();

      await render(<Subscriber active={false} onClose={vi.fn()} />);
      await pressEscape();
      expect(bubbleListener).toHaveBeenCalledTimes(1);
    } finally {
      document.removeEventListener('keydown', bubbleListener);
    }
  });

  it('ignores an Escape that is dismissing an IME candidate window', async () => {
    const onClose = vi.fn();
    await render(<Subscriber active onClose={onClose} />);

    await act(async () => {
      document.body.dispatchEvent(new KeyboardEvent('keydown', {
        key: 'Escape',
        keyCode: 229,
        bubbles: true,
        cancelable: true,
      }));
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it('unsubscribes on unmount so a closed overlay cannot swallow Escape', async () => {
    const onClose = vi.fn();
    await render(<Subscriber active onClose={onClose} />);
    expect(__escapeStackDepth()).toBe(1);

    await render(<></>);
    expect(__escapeStackDepth()).toBe(0);

    await pressEscape();
    expect(onClose).not.toHaveBeenCalled();
  });
});
