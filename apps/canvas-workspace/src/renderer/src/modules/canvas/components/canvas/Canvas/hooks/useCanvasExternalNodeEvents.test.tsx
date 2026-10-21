// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useCanvasExternalNodeEvents } from './useCanvasExternalNodeEvents';
import { DOCK_LINK_DRAG_TYPE } from '../../../../../../shared/dock/dock-link-drag';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const dropEvent = (type: string, payload: string) => {
  const event = new MouseEvent('drop', { clientX: 600, clientY: 400, bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', {
    value: { types: [type], getData: (key: string) => key === type ? payload : '' },
  });
  return event;
};

it('places a dropped dock web tab as a web node once the canvas has loaded', () => {
  const host = document.createElement('div'); document.body.append(host);
  const container = document.createElement('div'); document.body.append(container);
  const createUrlNode = vi.fn(() => null);
  // Like CanvasRootView, the ref is attached only once the canvas has loaded.
  const containerRef: { current: HTMLDivElement | null } = { current: null };
  const Probe = ({ loaded }: { loaded: boolean }) => {
    useCanvasExternalNodeEvents({
      addNode: vi.fn(),
      canvasId: 'current',
      containerRef,
      loaded,
      createUrlNode,
      screenToCanvas: (x, y) => ({ x: x / 2, y: y / 2 }),
      setSelectedNodeIds: vi.fn(),
      updateNode: vi.fn(),
    });
    return null;
  };
  const root = createRoot(host);
  try {
    act(() => root.render(<Probe loaded={false} />));
    containerRef.current = container;
    act(() => root.render(<Probe loaded />));

    const tabDrop = dropEvent(DOCK_LINK_DRAG_TYPE, JSON.stringify({ url: 'https://example.com/a', title: 'Example' }));
    act(() => container.dispatchEvent(tabDrop));
    expect(createUrlNode).toHaveBeenCalledWith('https://example.com/a', { at: { x: 300, y: 200 }, title: 'Example' });
    expect(tabDrop.defaultPrevented).toBe(true);

    // Other drags are left to their own handlers.
    createUrlNode.mockClear();
    const otherDrop = dropEvent('text/plain', 'https://example.com');
    act(() => container.dispatchEvent(otherDrop));
    expect(createUrlNode).not.toHaveBeenCalled();
    expect(otherDrop.defaultPrevented).toBe(false);
  } finally { act(() => root.unmount()); host.remove(); container.remove(); }
});
