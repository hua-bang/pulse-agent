// @vitest-environment happy-dom
import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useEscapeClose } from './useEscapeClose';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
});

function StackedLayers({ onOuterClose, onInnerClose }: { onOuterClose: () => void; onInnerClose: () => void }) {
  const [outerOpen, setOuterOpen] = useState(true);
  const [innerOpen, setInnerOpen] = useState(true);

  useEscapeClose(outerOpen, () => {
    setOuterOpen(false);
    onOuterClose();
  });

  useEscapeClose(innerOpen, () => {
    setInnerOpen(false);
    onInnerClose();
  });

  return (
    <div>
      {outerOpen && <span data-layer="outer" />}
      {innerOpen && <span data-layer="inner" />}
    </div>
  );
}

function ChildLayer({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  useEscapeClose(open, () => {
    setOpen(false);
    onClose();
  });
  return open ? <span data-layer="child" /> : null;
}

function ParentLayer({
  onParentClose,
  onChildClose,
  childStartsOpen,
}: {
  onParentClose: () => void;
  onChildClose: () => void;
  childStartsOpen: boolean;
}) {
  const [open, setOpen] = useState(true);
  const [childOpen, setChildOpen] = useState(childStartsOpen);
  useEscapeClose(open, () => {
    setOpen(false);
    onParentClose();
  });
  return (
    <div data-layer="parent">
      {childOpen ? <ChildLayer onClose={() => { setChildOpen(false); onChildClose(); }} /> : null}
      <button type="button" onClick={() => setChildOpen(true)}>open-child</button>
    </div>
  );
}

describe('useEscapeClose', () => {
  it('closes stacked overlays in LIFO order, one layer per Escape press', () => {
    const onOuterClose = vi.fn();
    const onInnerClose = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(<StackedLayers onOuterClose={onOuterClose} onInnerClose={onInnerClose} />);
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onInnerClose).toHaveBeenCalledTimes(1);
    expect(onOuterClose).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onOuterClose).toHaveBeenCalledTimes(1);
  });

  it('closes the child before the parent when both mount in the same commit', () => {
    const onParentClose = vi.fn();
    const onChildClose = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <ParentLayer onParentClose={onParentClose} onChildClose={onChildClose} childStartsOpen />,
      );
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onChildClose).toHaveBeenCalledTimes(1);
    expect(onParentClose).not.toHaveBeenCalled();

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onParentClose).toHaveBeenCalledTimes(1);
  });

  it('puts a child that opens later above a parent that is already open', () => {
    const onParentClose = vi.fn();
    const onChildClose = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <ParentLayer onParentClose={onParentClose} onChildClose={onChildClose} childStartsOpen={false} />,
      );
    });
    act(() => {
      host?.querySelector('button')?.click();
    });

    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });
    expect(onChildClose).toHaveBeenCalledTimes(1);
    expect(onParentClose).not.toHaveBeenCalled();
  });
});
