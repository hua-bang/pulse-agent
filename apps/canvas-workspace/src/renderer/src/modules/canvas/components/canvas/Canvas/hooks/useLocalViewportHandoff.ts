import { useEffect, useLayoutEffect, useRef, type MutableRefObject } from 'react';
import type { CanvasTransform } from '../../../../../../types';

interface Options {
  /** Only local-viewport hosts take a handoff; a persisted viewport owns itself. */
  persistViewport: boolean;
  initialViewport?: CanvasTransform;
  onViewportChange?: (transform: CanvasTransform) => void;
  loaded: boolean;
  moving: boolean;
  transform: CanvasTransform;
  setTransform: (transform: CanvasTransform) => void;
  hasAutoFittedRef: MutableRefObject<boolean>;
}

/**
 * Keeps an embedded editor's viewport continuous with the read-only surface
 * that hosts it. The editor starts from the host's framing instead of running
 * its own first-load auto-fit, and reports settled pan/zoom back so leaving
 * Edit mode returns to the same framing.
 */
export const useLocalViewportHandoff = ({
  persistViewport,
  initialViewport,
  onViewportChange,
  loaded,
  moving,
  transform,
  setTransform,
  hasAutoFittedRef,
}: Options) => {
  // Read once: later host renders must not pull the editor's viewport back.
  const initialViewportRef = useRef(persistViewport ? undefined : initialViewport);

  useLayoutEffect(() => {
    const viewport = initialViewportRef.current;
    if (!viewport) return;
    hasAutoFittedRef.current = true;
    setTransform(viewport);
  }, [hasAutoFittedRef, setTransform]);

  useEffect(() => {
    if (persistViewport || !loaded || moving) return;
    onViewportChange?.(transform);
  }, [loaded, moving, onViewportChange, persistViewport, transform]);
};
