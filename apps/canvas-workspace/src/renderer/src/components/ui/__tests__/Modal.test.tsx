// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Button } from '../Button';
import { Modal } from '../Modal';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

/** Controlled harness — the caller drives `open`/`onClose` like a real host.
 *  Focusable placeholders reuse the blessed Button rather than a raw tag. */
function ModalHarness({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <div>
      <Button data-testid="outside">Outside</Button>
      <Modal open={open} onClose={onClose} labelledBy="modal-title">
        <h2 id="modal-title">Title</h2>
        <Button data-testid="first">First</Button>
        <Button data-testid="last">Last</Button>
      </Modal>
    </div>
  );
}

/** Self-closing harness — Modal's own onClose flips internal state, like a
 *  typical host component would wire it. */
function SelfClosingModal({ initialOpen = true }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  return <ModalHarness open={open} onClose={() => setOpen(false)} />;
}

function render(node: React.ReactNode) {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(node);
  });
}

describe('Modal', () => {
  it('renders nothing when closed', () => {
    // Modal portals to document.body (not inside `host`), so absence must be
    // checked at the document level.
    render(<SelfClosingModal initialOpen={false} />);
    expect(document.querySelector('.ui-modal')).toBeNull();
  });

  it('renders with a dialog role and aria-modal when open', () => {
    render(<SelfClosingModal initialOpen />);
    const dialog = document.querySelector('.ui-modal');
    expect(dialog?.getAttribute('role')).toBe('dialog');
    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-labelledby')).toBe('modal-title');
  });

  it('closes on backdrop mousedown but not on a mousedown inside the card', () => {
    render(<SelfClosingModal initialOpen />);
    const card = document.querySelector('.ui-modal') as HTMLElement;

    act(() => {
      card.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.ui-modal')).not.toBeNull();

    const backdrop = document.querySelector('.ui-modal-backdrop') as HTMLElement;
    act(() => {
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.ui-modal')).toBeNull();
  });

  it('closes on Escape', () => {
    render(<SelfClosingModal initialOpen />);
    expect(document.querySelector('.ui-modal')).not.toBeNull();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(document.querySelector('.ui-modal')).toBeNull();
  });

  it('calls onClose exactly once per backdrop press', () => {
    const onClose = vi.fn();
    render(<ModalHarness open onClose={onClose} />);
    const backdrop = document.querySelector('.ui-modal-backdrop') as HTMLElement;
    act(() => {
      backdrop.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('moves focus into the modal on open and restores it to the prior element on close', () => {
    // Drive `open` from the outside (re-render with a new prop value) rather
    // than through SelfClosingModal's internal state, so the toggle is an
    // explicit, unambiguous open/close transition.
    const onClose = vi.fn();
    render(<ModalHarness open={false} onClose={onClose} />);
    const outside = host?.querySelector('[data-testid="outside"]') as HTMLButtonElement;
    outside.focus();
    expect(document.activeElement).toBe(outside);

    act(() => {
      root?.render(<ModalHarness open onClose={onClose} />);
    });
    const first = document.querySelector('[data-testid="first"]');
    expect(document.activeElement).toBe(first);

    act(() => {
      root?.render(<ModalHarness open={false} onClose={onClose} />);
    });
    expect(document.querySelector('.ui-modal')).toBeNull();
    expect(document.activeElement).toBe(outside);
  });

  it('cycles Tab from the last focusable back to the first (and Shift+Tab back to the last)', () => {
    render(<SelfClosingModal initialOpen />);
    const first = document.querySelector('[data-testid="first"]') as HTMLElement;
    const last = document.querySelector('[data-testid="last"]') as HTMLElement;

    last.focus();
    expect(document.activeElement).toBe(last);
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    });
    expect(document.activeElement).toBe(first);

    act(() => {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true, bubbles: true, cancelable: true }),
      );
    });
    expect(document.activeElement).toBe(last);
  });
});
