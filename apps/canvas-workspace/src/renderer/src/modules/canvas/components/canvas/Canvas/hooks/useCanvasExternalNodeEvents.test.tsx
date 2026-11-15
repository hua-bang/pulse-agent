// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { useCanvasExternalNodeEvents } from './useCanvasExternalNodeEvents';
import { DOCK_LINK_DRAG_TYPE } from '../../../../../../shared/dock/dock-link-drag';
import { requestAddCanvasNote } from '../../../../../../shared/canvasNoteRequest';
import type { CanvasNode } from '../../../../../../types';
import type { AddNodeOptions } from '../../../../document/useCanvasContentCommands';

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
      nodesRef: { current: [] },
      createUrlNode,
      screenToCanvas: (x, y) => ({ x: x / 2, y: y / 2 }),
      setSelectedNodeIds: vi.fn(),
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

it('adds a requested chat reply as a note on the matching canvas only', () => {
  const host = document.createElement('div');
  document.body.append(host);
  const container = document.createElement('div');
  document.body.append(container);
  const addNode = vi.fn((..._args: unknown[]) => ({ id: 'note-1' }));
  const setSelectedNodeIds = vi.fn();
  const containerRef = { current: container };
  const source = { id: 'question', type: 'text', x: 0, y: 0, width: 200, height: 100, data: {} } as CanvasNode;
  const nodesRef = { current: [source] };
  const Probe = () => {
    useCanvasExternalNodeEvents({
      addNode: addNode as never,
      canvasId: 'current',
      containerRef,
      loaded: true,
      nodesRef,
      createUrlNode: vi.fn(() => null),
      screenToCanvas: () => ({ x: 500, y: 300 }),
      setSelectedNodeIds,
    });
    return null;
  };
  const root = createRoot(host);
  try {
    act(() => root.render(<Probe />));

    expect(requestAddCanvasNote({ workspaceId: 'other', title: 'T', content: '# T' })).toBe(false);
    expect(addNode).not.toHaveBeenCalled();

    expect(requestAddCanvasNote({ workspaceId: 'current', title: 'T', content: '# T\n\nbody' })).toBe(true);
    expect(addNode).toHaveBeenCalledWith('file', expect.any(Number), expect.any(Number), expect.objectContaining({
      fileName: 'T',
      fileContent: '# T\n\nbody',
    }));
    expect(setSelectedNodeIds).toHaveBeenCalledWith(['note-1']);
    expect(addNode.mock.calls[0]?.[3]).toMatchObject({ connectFrom: undefined });

    // A reply to a question about a node lands beside it, connected.
    addNode.mockClear();
    expect(requestAddCanvasNote({
      workspaceId: 'current',
      title: 'T',
      content: 'answer',
      sourceNodeIds: ['missing', 'question'],
    })).toBe(true);
    const [, x, y, options] = addNode.mock.calls[0] as unknown as [string, number, number, AddNodeOptions];
    expect(x).toBe(280);
    expect(y).toBe(0);
    expect(options.connectFrom).toEqual({ kind: 'node', nodeId: 'question', anchor: 'auto' });
  } finally {
    act(() => root.unmount());
    host.remove();
    container.remove();
  }
});
