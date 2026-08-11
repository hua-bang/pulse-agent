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
  let save: ReturnType<typeof vi.fn>;
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
    save = vi.fn().mockResolvedValue({ ok: true });
    originalCanvasWorkspace = window.canvasWorkspace;
    Object.defineProperty(window, 'canvasWorkspace', {
      configurable: true,
      value: {
        store: {
          load: vi.fn().mockResolvedValue({
            ok: true,
            data: {
              nodes: [node],
              edges: [],
              transform: { x: 91, y: -37, scale: 0.75 },
            },
          }),
          save,
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

  // Terminal/agent scrollback+cwd autosave fires every 2s per live terminal
  // (perf findings B1/A5): routed through the default updateNode path it
  // filled the undo stack with background saves, so Ctrl+Z reverted a
  // scrollback snapshot instead of the user's last action. history:false
  // must keep the data change while leaving the undo stack untouched.
  it('updateNode with history:false applies the patch without occupying an undo slot', () => {
    act(() => {
      hook.updateNode('text-1', {
        data: { content: 'user edit', autoSize: true } as CanvasNode['data'],
      });
    });

    act(() => {
      hook.updateNode(
        'text-1',
        { data: { content: 'user edit', autoSize: true, scrollback: 'tick' } as CanvasNode['data'] },
        { history: false },
      );
    });
    expect(
      (hook.nodes[0].data as { scrollback?: string }).scrollback,
    ).toBe('tick');

    // One undo reverts the USER edit (not the silent autosave tick).
    act(() => {
      expect(hook.undo()).toBe(true);
    });
    expect((hook.nodes[0].data as { content?: string }).content).toBe('hello');
  });

  it('preserves the loaded viewport when an embedded editor saves only node changes', async () => {
    act(() => {
      hook.updateNode('text-1', { title: 'Edited in AI Chat' });
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });

    expect(save).toHaveBeenCalled();
    expect(save.mock.calls.at(-1)?.[1]).toMatchObject({
      transform: { x: 91, y: -37, scale: 0.75 },
    });
  });
});
