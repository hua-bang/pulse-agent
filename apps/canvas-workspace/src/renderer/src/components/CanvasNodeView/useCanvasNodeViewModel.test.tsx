// @vitest-environment happy-dom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CanvasNode } from '../../types';
import { useCanvasNodeViewModel } from './useCanvasNodeViewModel';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe('useCanvasNodeViewModel text resize', () => {
  let root: Root;
  let host: HTMLElement;
  let viewModel: ReturnType<typeof useCanvasNodeViewModel>;
  let onResizeStart: ReturnType<typeof vi.fn>;
  let onUpdate: ReturnType<typeof vi.fn>;

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
    viewModel = useCanvasNodeViewModel({
      embedded: false,
      focusState: 'neutral',
      isFullscreen: false,
      readOnly: false,
      isDragging: false,
      isHighlighted: false,
      isResizing: false,
      isSelected: true,
      node,
      onDragStart: vi.fn(),
      onFocus: vi.fn(),
      onRemove: vi.fn(),
      onResizeStart,
      onSelect: vi.fn(),
      onUpdate: onUpdate as (id: string, patch: Partial<CanvasNode>) => void,
    });
    return null;
  };

  beforeEach(() => {
    onResizeStart = vi.fn();
    onUpdate = vi.fn();
    host = document.createElement('div');
    document.body.appendChild(host);
    root = createRoot(host);
    act(() => root.render(<Probe />));
  });

  afterEach(() => {
    act(() => root.unmount());
    host.remove();
  });

  it('starts an ephemeral resize without disabling auto-size on mousedown', () => {
    const event = { button: 0 } as React.MouseEvent;

    act(() => viewModel.makeResizeHandler('right')(event));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(onResizeStart).toHaveBeenCalledWith(event, 'text-1', 240, 100, 'right', 40, 28);
  });
});
