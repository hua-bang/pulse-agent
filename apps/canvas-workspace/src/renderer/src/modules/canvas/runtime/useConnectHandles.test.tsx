// @vitest-environment happy-dom
import { act } from 'react';
import type React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../types';
import { useConnectHandles } from './useConnectHandles';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useConnectHandles', () => {
  let root: Root;
  let host: HTMLElement;
  let hook: ReturnType<typeof useConnectHandles>;
  let enabled: boolean;
  let beginConnect: ReturnType<typeof vi.fn>;
  const sortedNodes: CanvasNode[] = [
    { id: 'a', x: 0, y: 0, width: 100, height: 60 } as CanvasNode,
  ];

  const Probe = () => {
    hook = useConnectHandles({
      enabled,
      sortedNodes,
      screenToCanvas: (x, y) => ({ x, y }),
      getContainer: () => host,
      beginConnect,
    });
    return null;
  };

  const hover = (clientX: number, clientY: number, buttons = 0) => {
    act(() => hook.handleMouseMove({ clientX, clientY, buttons } as React.MouseEvent));
  };

  beforeEach(() => {
    enabled = true;
    beginConnect = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('keeps the hovered node while the pointer travels to an outside handle', () => {
    hover(50, 30);
    expect(hook.hoverNodeId).toBe('a');

    // The right handle sits outside the node border, inside the slop.
    hover(114, 30);
    expect(hook.hoverNodeId).toBe('a');

    hover(200, 30);
    expect(hook.hoverNodeId).toBeNull();
  });

  it('hides handles while a button is pressed or the hook is disabled', () => {
    hover(50, 30, 1);
    expect(hook.hoverNodeId).toBeNull();

    hover(50, 30);
    enabled = false;
    act(() => root.render(<Probe />));
    expect(hook.hoverNodeId).toBeNull();
  });

  it('starts an auto-anchored connect bound to the handle node', () => {
    const event = {
      button: 0,
      clientX: 114,
      clientY: 30,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent;

    act(() => hook.beginFromHandle('a', event));

    expect(event.stopPropagation).toHaveBeenCalled();
    expect(beginConnect).toHaveBeenCalledWith(114, 30, { kind: 'node', nodeId: 'a', anchor: 'auto' });
    act(() => window.dispatchEvent(new MouseEvent('mouseup')));
  });

  const startHandleDrag = () => {
    const event = {
      button: 0,
      clientX: 114,
      clientY: 30,
      preventDefault: vi.fn(),
      stopPropagation: vi.fn(),
    } as unknown as React.MouseEvent;
    act(() => hook.beginFromHandle('a', event));
  };

  const clickReaches = (): boolean => {
    const onClick = vi.fn();
    host.addEventListener('click', onClick);
    host.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    host.removeEventListener('click', onClick);
    return onClick.mock.calls.length > 0;
  };

  it('swallows only the click that ends the handle drag', () => {
    startHandleDrag();
    const onClick = vi.fn();
    host.addEventListener('click', onClick);
    host.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    host.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    host.removeEventListener('click', onClick);

    expect(onClick).not.toHaveBeenCalled();
    expect(clickReaches()).toBe(true);
  });

  it('keeps the next click when the drag ends without a mouseup', () => {
    // Window blur or a release outside the window: no mouseup arrives.
    startHandleDrag();

    expect(clickReaches()).toBe(true);
  });
});
