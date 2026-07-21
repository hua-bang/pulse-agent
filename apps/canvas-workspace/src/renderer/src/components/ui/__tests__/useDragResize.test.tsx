// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useDragResize, type DragResizeOptions } from '../hooks/useDragResize';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let host: HTMLDivElement | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  document.body.style.cursor = '';
  document.body.style.userSelect = '';
});

function DragHandle({ options }: { options: DragResizeOptions }) {
  const { onMouseDown } = useDragResize(options);
  return <div data-testid="handle" onMouseDown={onMouseDown} />;
}

function renderHandle(options: DragResizeOptions): HTMLElement {
  host = document.createElement('div');
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root?.render(<DragHandle options={options} />);
  });
  return host.querySelector('[data-testid="handle"]') as HTMLElement;
}

const mousedown = (el: HTMLElement, clientX: number) => {
  act(() => {
    el.dispatchEvent(
      new MouseEvent('mousedown', { bubbles: true, cancelable: true, clientX, clientY: 0, button: 0 }),
    );
  });
};
const mousemove = (clientX: number) => {
  act(() => {
    document.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX, clientY: 0 }));
  });
};
const mouseup = () => {
  act(() => {
    document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  });
};

describe('useDragResize', () => {
  it('updates via onChange while dragging, clamped to min/max', () => {
    const onChange = vi.fn();
    const handle = renderHandle({ axis: 'x', value: 100, min: 50, max: 300, onChange });

    mousedown(handle, 100);
    mousemove(150);
    expect(onChange).toHaveBeenLastCalledWith(150);

    mousemove(1000); // far past max
    expect(onChange).toHaveBeenLastCalledWith(300);

    mousemove(-1000); // far past min
    expect(onChange).toHaveBeenLastCalledWith(50);
  });

  it('invert reverses the drag direction', () => {
    const onChange = vi.fn();
    const handle = renderHandle({ axis: 'x', value: 100, min: 0, max: 300, invert: true, onChange });

    mousedown(handle, 100);
    mousemove(150); // moved right 50px -> inverted -> value decreases
    expect(onChange).toHaveBeenLastCalledWith(50);

    mousemove(50); // moved left 50px from start -> inverted -> value increases
    expect(onChange).toHaveBeenLastCalledWith(150);
  });

  it('fires onDragEnd with the final value and unlocks the body cursor/userSelect on mouseup', () => {
    const onChange = vi.fn();
    const onDragEnd = vi.fn();
    const handle = renderHandle({ axis: 'x', value: 100, min: 0, max: 300, onChange, onDragEnd });

    mousedown(handle, 100);
    expect(document.body.style.cursor).toBe('col-resize');
    expect(document.body.style.userSelect).toBe('none');

    mousemove(140);
    mouseup();

    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledWith(140);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');
  });

  it('unmounting mid-drag fires onDragEnd, unlocks the body, and removes the listeners', () => {
    const onChange = vi.fn();
    const onDragEnd = vi.fn();
    const handle = renderHandle({ axis: 'x', value: 100, min: 0, max: 300, onChange, onDragEnd });

    mousedown(handle, 100);
    mousemove(130);
    expect(onDragEnd).not.toHaveBeenCalled();

    act(() => {
      root?.unmount();
    });
    root = null; // already unmounted here; skip the afterEach unmount

    expect(onDragEnd).toHaveBeenCalledTimes(1);
    expect(onDragEnd).toHaveBeenCalledWith(130);
    expect(document.body.style.cursor).toBe('');
    expect(document.body.style.userSelect).toBe('');

    const callsBeforeFurtherMove = onChange.mock.calls.length;
    mousemove(200); // listeners were torn down on unmount — this must be a no-op
    expect(onChange.mock.calls.length).toBe(callsBeforeFurtherMove);
  });

  describe('interaction shield (webview drag deadlock guard)', () => {
    const findShield = () => document.body.querySelector('.canvas-interaction-shield');

    it('mounts the full-window shield synchronously on mousedown and removes it on mouseup', () => {
      const handle = renderHandle({ axis: 'x', value: 100, min: 0, max: 300, onChange: vi.fn() });
      expect(findShield()).toBeNull();

      mousedown(handle, 100);
      expect(findShield()).not.toBeNull();

      mouseup();
      expect(findShield()).toBeNull();
    });

    it('removes the shield when the component unmounts mid-drag', () => {
      const handle = renderHandle({ axis: 'x', value: 100, min: 0, max: 300, onChange: vi.fn() });
      mousedown(handle, 100);
      expect(findShield()).not.toBeNull();

      act(() => {
        root?.unmount();
      });
      root = null; // already unmounted here; skip the afterEach unmount
      expect(findShield()).toBeNull();
    });
  });
});
