import { useEffect } from 'react';
import { acquireInteractionShield } from '../utils/interactionShield';

/**
 * Hold the guest pointer shield for as long as an overlay is open above an
 * embedded page.
 *
 * A `<webview>` guest runs in its own process: a click inside it never
 * reaches the host document, so `useClickOutside` — which every dropdown,
 * popover and menu in this app relies on — simply never fires and the overlay
 * stays stranded on top of the page. The shield sets `pointer-events: none`
 * on the guests, which makes that click hit-test through to the host, so the
 * normal dismissal path works. The dismissing click is consumed rather than
 * also acting on the page, which is what a menu should do anyway.
 *
 * Reuses the refcounted shield that drag gestures already share, so an
 * overlay opened mid-drag cannot clobber the drag's acquisition.
 */
export const useGuestInteractionShield = (active: boolean): void => {
  useEffect(() => {
    if (!active) return;
    return acquireInteractionShield();
  }, [active]);
};
