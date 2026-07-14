// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../types';
import { useNodes } from './useNodes';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useNodes text resize commit', () => {
  let root: Root;
  let host: HTMLElement;
  let hook: ReturnType<typeof useNodes>;
  let originalCanvasWorkspace: typeof window.canvasWorkspace;

  const node = {
    id: 'text-1',
    type: 'text',
    title: 'Text',
    x: 10,
    y: 20,
    width: 240,
    height: 100,
    data: { content: 'hello', autoSize: true },
    updatedAt: 1,
  } as CanvasNode;

  const Probe = () => {
    hook = useNodes('canvas-1');
    return null;
  };

  beforeEach(async () => {
    vi.useFakeTimers();
    originalCanvasWorkspace = window.canvasWorkspace;
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        store: {
          load: vi.fn().mockResolvedValue({ ok: true, data: { nodes: [node], edges: [] } }),
          save: vi.fn().mockResolvedValue({ ok: true }),
        },
      },
    });
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    await act(async () => {
      root.render(<Probe />);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(hook.loaded).toBe(true);
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: originalCanvasWorkspace,
    });
  });

  it('commits text geometry and auto-size mode in the same undo step', () => {
    act(() => {
      hook.resizeNode('text-1', 320, 140, 10, 20, { disableTextAutoSize: true });
      hook.commitHistory();
    });

    expect(hook.nodes[0]).toMatchObject({
      width: 320,
      height: 140,
      data: { content: 'hello', autoSize: false },
    });

    act(() => {
      expect(hook.undo()).toBe(true);
    });
    expect(hook.nodes[0]).toMatchObject({
      width: 240,
      height: 100,
      data: { content: 'hello', autoSize: true },
    });
  });
});
