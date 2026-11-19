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
});
