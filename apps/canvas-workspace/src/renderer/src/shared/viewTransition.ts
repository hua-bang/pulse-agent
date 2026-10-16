import { flushSync } from 'react-dom';

/**
 * Page-level view transitions. Route, workspace-tab, and settings-section
 * switches run through `runViewTransition`, so the old page cross-fades into
 * the new one instead of vanishing for a blank frame. The class below names
 * the sidebar and the route view only while a transition runs (see
 * app/App/index.css), so the two morph their width with the switch.
 *
 * The update runs inside the transition callback with `flushSync`, so React
 * commits it before the browser captures the new state. A call made while a
 * callback runs applies at once: nested switches join the outer transition.
 * Reduced motion keeps the transition but turns its animations off in CSS.
 */
export const VIEW_TRANSITION_CLASS = 'app-view-transition';

let updating = false;
let running = 0;

export const runViewTransition = (update: () => void): void => {
  if (updating || !document.startViewTransition) {
    update();
    return;
  }
  const root = document.documentElement;
  running += 1;
  root.classList.add(VIEW_TRANSITION_CLASS);
  const transition = document.startViewTransition(() => {
    updating = true;
    try {
      flushSync(update);
    } finally {
      updating = false;
    }
  });
  // A newer transition skips this one; keep the class until the last ends.
  const cleanup = () => {
    running -= 1;
    if (running === 0) root.classList.remove(VIEW_TRANSITION_CLASS);
  };
  transition.finished.then(cleanup, cleanup);
};
