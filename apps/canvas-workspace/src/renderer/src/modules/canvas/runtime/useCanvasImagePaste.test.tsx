// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../../types';
import { useCanvasImagePaste } from './useCanvasImagePaste';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useCanvasImagePaste text and URL clipboard', () => {
  let host: HTMLDivElement;
  let root: Root;
  let addNode: ReturnType<typeof vi.fn>;
  let updateNode: ReturnType<typeof vi.fn>;
  let onPasteUrl: ReturnType<typeof vi.fn>;
  let resolveSlot: ReturnType<typeof vi.fn>;

  const Probe = () => {
    useCanvasImagePaste({
      canvasId: 'canvas-1',
      active: true,
      containerRef: { current: host },
      screenToCanvas: (x, y) => ({ x, y }),
      addNode: addNode as unknown as (type: CanvasNode['type'], x: number, y: number) => CanvasNode,
      updateNode,
      onPasteUrl,
      resolveSlot,
    });
    return null;
  };

  const paste = (text: string) => {
    const event = new Event('paste', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(event, 'clipboardData', {
      value: {
        items: [{ type: 'text/plain' }],
        getData: (type: string) => (type === 'text/plain' ? text : ''),
      },
    });
    act(() => {
      document.body.dispatchEvent(event);
    });
  };

  beforeEach(() => {
    host = document.createElement('div');
    document.body.appendChild(host);
    addNode = vi.fn((type: CanvasNode['type'], x: number, y: number) => ({ id: 'new', type, x, y }));
    updateNode = vi.fn();
    onPasteUrl = vi.fn(() => null);
    resolveSlot = vi.fn((x: number, y: number) => ({ x: x + 500, y }));
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('makes plain multi-line notes a text node, not a web node with an escaped address', () => {
    paste('Meeting notes\nbuy milk tomorrow');
    expect(onPasteUrl).not.toHaveBeenCalled();
    expect(addNode).toHaveBeenCalledWith('text', expect.any(Number), expect.any(Number));
    expect(updateNode).toHaveBeenCalledWith('new', expect.objectContaining({
      title: 'Meeting notes',
      data: expect.objectContaining({ content: 'Meeting notes\nbuy milk tomorrow' }),
    }));
  });

  it('keeps a single sentence with spaces as text', () => {
    paste('remember to call the bank');
    expect(onPasteUrl).not.toHaveBeenCalled();
    expect(addNode).toHaveBeenCalledOnce();
  });

  it('still makes a web node for a bare domain or full URL', () => {
    paste('example.com/docs');
    paste('https://pulse.dev/a?b=1');
    expect(onPasteUrl).toHaveBeenNthCalledWith(1, 'https://example.com/docs', expect.anything());
    expect(onPasteUrl).toHaveBeenNthCalledWith(2, 'https://pulse.dev/a?b=1', expect.anything());
    expect(addNode).not.toHaveBeenCalled();
  });

  it('places the pasted node in the slot the canvas resolves', () => {
    paste('note');
    const [desiredX] = resolveSlot.mock.calls[0];
    expect(addNode).toHaveBeenCalledWith('text', desiredX + 500, expect.any(Number));
  });
});
