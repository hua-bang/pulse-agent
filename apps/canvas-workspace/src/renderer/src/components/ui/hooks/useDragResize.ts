import { useCallback, useEffect, useRef, type MouseEvent as ReactMouseEvent } from 'react';

export interface DragResizeOptions {
  /** Which axis the handle drags along. */
  axis: 'x' | 'y';
  /** Current size in px; read fresh at drag start (pass the live state). */
  value: number;
  /** Lower clamp bound in px. */
  min: number;
  /** Upper clamp bound in px (read fresh on every move — safe to derive from
   *  the viewport). */
  max: number;
  /** Called on every move with the next clamped size. */
  onChange: (next: number) => void;
  /** Invert the delta — for a handle on the leading edge of an end-anchored
   *  panel (right-dock left edge, bottom-dock top edge), where dragging toward
   *  the panel grows it. */
  invert?: boolean;
  /** Fired once when a drag begins, after the cursor/selection lock applies. */
  onDragStart?: () => void;
  /** Fired once when a drag ends, with the final clamped size (for persistence). */
  onDragEnd?: (value: number) => void;
}

export interface DragResizeHandlers {
  onMouseDown: (event: ReactMouseEvent) => void;
}

/**
 * Shared panel-resize hook, extracted from the RightDock / WorkspaceTerminalDock
 * pattern. Owns the move/up window listeners, the body cursor + text-selection
 * lock (derived from `axis`), clamping, and cleanup. Caller-specific side
 * effects (a resizing CSS class, localStorage persistence, re-fit) go through
 * `onDragStart` / `onDragEnd` / `onChange`.
 */
export const useDragResize = (options: DragResizeOptions): DragResizeHandlers => {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Live teardown for an in-flight drag, so an unmount mid-drag drops the
  // window listeners and releases the body lock (without firing onDragEnd).
  const teardownRef = useRef<(() => void) | null>(null);

  const onMouseDown = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    const { axis, invert } = optionsRef.current;
    const startPos = axis === 'x' ? event.clientX : event.clientY;
    const startValue = optionsRef.current.value;
    let latest = startValue;

    optionsRef.current.onDragStart?.();
    document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    const onMove = (moveEvent: MouseEvent) => {
      const opts = optionsRef.current;
      const current = axis === 'x' ? moveEvent.clientX : moveEvent.clientY;
      const delta = current - startPos;
      const signed = invert ? -delta : delta;
      latest = Math.min(opts.max, Math.max(opts.min, startValue + signed));
      opts.onChange(latest);
    };

    const release = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      teardownRef.current = null;
    };

    const onUp = () => {
      release();
      optionsRef.current.onDragEnd?.(latest);
    };

    teardownRef.current = release;
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, []);

  useEffect(() => () => teardownRef.current?.(), []);

  return { onMouseDown };
};
