// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../types';
import { marqueeHits, useMarqueeSelect } from './useMarqueeSelect';

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

  it('previews the hit set live while dragging and clears it on release', () => {
    begin(300, 300);
    move(301, 301);
    // Still a click: nothing previewed yet.
    expect(hook.hits).toEqual([]);
    move(150, 150);
    expect(hook.hits).toEqual([]);
    move(90, 90);
    expect(hook.hits.map((hit) => hit.id)).toEqual(['n1']);
    move(150, 150);
    expect(hook.hits).toEqual([]);
    move(100, 100);
    up();
    expect(onSelect).toHaveBeenCalledWith(['n1'], { shift: false, meta: false });
    expect(hook.hits).toEqual([]);
  });
});

describe('marqueeHits', () => {
  it('includes nodes that only touch the box edge', () => {
    const touching = { id: 't', x: 50, y: 0, width: 10, height: 10 } as CanvasNode;
    const outside = { id: 'o', x: 61, y: 0, width: 10, height: 10 } as CanvasNode;
    expect(marqueeHits([touching, outside], { x: 0, y: 0, width: 50, height: 50 }).map((hit) => hit.id))
      .toEqual(['t']);
  });
});
