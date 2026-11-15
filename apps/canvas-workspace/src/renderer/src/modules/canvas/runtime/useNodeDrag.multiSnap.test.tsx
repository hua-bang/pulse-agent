// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../types';
import { useNodeDrag } from './useNodeDrag';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const box = (id: string, x: number, y: number) => ({ id, x, y, width: 100, height: 50 }) as CanvasNode;
const nodes = [box('a', 0, 0), box('b', 200, 0), box('target', 500, 300)];

describe('useNodeDrag multi-selection snapping', () => {
  let root: Root | null = null;

  afterEach(() => {
    act(() => root?.unmount());
    root = null;
    vi.unstubAllGlobals();
  });

  it('snaps the outer edge of a non-primary selected node', () => {
    vi.stubGlobal('requestAnimationFrame', () => 1);
    vi.stubGlobal('cancelAnimationFrame', () => {});
    const moveNodes = vi.fn();
    let hook!: ReturnType<typeof useNodeDrag>;
    const Probe = () => {
      hook = useNodeDrag(vi.fn(), moveNodes, 1, nodes, ['a', 'b']);
      return null;
    };
    root = createRoot(document.createElement('div'));
    act(() => root?.render(<Probe />));

    act(() => {
      hook.onDragStart({ button: 0, altKey: false, clientX: 0, clientY: 0, stopPropagation: () => {} } as unknown as React.MouseEvent, nodes[0]);
      // b's right edge lands at 495, 5px from the target's left edge (500).
      hook.onDragMove(new MouseEvent('mousemove', { clientX: 195, clientY: 0 }));
    });
    act(() => hook.onDragEnd());

    expect(moveNodes).toHaveBeenCalledWith([
      { id: 'a', x: 200, y: 0 },
      { id: 'b', x: 400, y: 0 },
    ]);
  });
});
