// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../types';
import { useMarqueeSelect } from './useMarqueeSelect';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const node = { id: 'n1', x: 0, y: 0, width: 100, height: 100 } as CanvasNode;

describe('useMarqueeSelect', () => {
  let host: HTMLDivElement;
  let root: Root;
  let hook: ReturnType<typeof useMarqueeSelect>;
  let onSelect: ReturnType<typeof vi.fn>;

  const Probe = () => {
    hook = useMarqueeSelect({
      enabled: true,
      screenToCanvas: (x, y) => ({ x, y }),
      getContainer: () => host,
      nodes: [node],
      onSelect,
    });
    return null;
  };

  const begin = (x: number, y: number) => {
    act(() => {
      hook.begin({
        button: 0,
        altKey: false,
        shiftKey: false,
        metaKey: false,
        ctrlKey: false,
        clientX: x,
        clientY: y,
        preventDefault: () => {},
      } as unknown as React.MouseEvent);
    });
  };

  const move = (x: number, y: number) => {
    act(() => {
      window.dispatchEvent(new MouseEvent('mousemove', { clientX: x, clientY: y }));
    });
  };

  const up = () => {
    act(() => {
      window.dispatchEvent(new MouseEvent('mouseup'));
    });
  };

  beforeEach(() => {
    onSelect = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('keeps a plain click out of drag mode so click and dblclick still reach the canvas', () => {
    begin(300, 300);
    expect(hook.active).toBe(true);
    expect(hook.dragging).toBe(false);
    move(301, 301);
    expect(hook.dragging).toBe(false);
    up();
    expect(onSelect).toHaveBeenCalledWith([], { shift: false, meta: false });
    expect(hook.active).toBe(false);
  });

  it('enters drag mode after real pointer travel and reports the hit set', () => {
    begin(150, 150);
    move(50, 50);
    expect(hook.dragging).toBe(true);
    up();
    expect(onSelect).toHaveBeenCalledWith(['n1'], { shift: false, meta: false });
    expect(hook.dragging).toBe(false);
  });
});
