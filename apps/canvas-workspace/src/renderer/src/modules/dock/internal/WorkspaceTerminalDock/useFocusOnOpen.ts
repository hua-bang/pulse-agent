import { useCallback, useEffect, useRef } from 'react';

/**
 * Focuses a panel when the user opens it, and only then.
 *
 * `focus` returns false while the panel has nothing to focus yet (a terminal
 * still booting); call the returned function once it exists. Re-renders while
 * open never refocus: an earlier effect refocused the dock terminal on every
 * canvas click, so typed keys and new canvas nodes lost the keyboard. Opens
 * restored at launch carry no user activation and leave focus alone.
 */
export const useFocusOnOpen = (open: boolean, focus: () => boolean): (() => void) => {
  const wasOpenRef = useRef(false);
  const pendingRef = useRef(false);

  useEffect(() => {
    const opened = open && !wasOpenRef.current;
    wasOpenRef.current = open;
    pendingRef.current = false;
    if (!opened || !navigator.userActivation?.isActive) return;
    pendingRef.current = !focus();
  }, [focus, open]);

  return useCallback(() => {
    if (!pendingRef.current) return;
    pendingRef.current = false;
    focus();
  }, [focus]);
};
