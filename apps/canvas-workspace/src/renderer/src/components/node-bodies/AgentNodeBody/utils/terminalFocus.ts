/**
 * The keyboard escape hatch out of a focused terminal.
 *
 * A focused terminal is a keyboard black hole by construction: xterm's helper
 * element is a `<textarea>`, so `useCanvasKeyboard`/`useAppShortcuts` drop
 * every non-`editable: 'allow'` shortcut typed into it, and Ctrl-chords
 * rightly belong to the shell. Without a way back out, the mouse is the only
 * exit — which is what `TerminalNodeBody` fixed with a double-Escape while
 * the coding-agent node and the workspace terminal dock shipped without one
 * at all, each having hand-rolled its own xterm key handler.
 *
 * `decideTerminalKey` (in `./terminal`) is the pure arbitration rule and stays
 * there, next to its own tests. This module owns the two stateful halves that
 * every surface would otherwise copy: the double-Escape timestamp, and the
 * blur sequence that actually hands focus back.
 *
 * Kept out of `./terminal` because that file sits at the 500-line governance
 * ceiling, not because the concern is different.
 */
import { decideTerminalKey } from './terminal';

/** The subset of xterm's Terminal this module needs. */
interface BlurrableTerminal {
  blur?: () => void;
}

/**
 * Hand focus back to the host document, so the shortcut layer's editable
 * guard stops treating xterm's helper textarea as "the user is typing".
 *
 * All three steps matter: xterm's own `blur()` clears its internal focus
 * state, the container blur covers a surface whose wrapper took focus, and
 * the `activeElement` blur is the backstop for the helper textarea itself,
 * which is not either of those elements.
 */
export const releaseTerminalFocus = (
  term: BlurrableTerminal | null | undefined,
  container: HTMLElement | null | undefined,
): void => {
  term?.blur?.();
  container?.blur?.();
  (document.activeElement as HTMLElement | null)?.blur?.();
};

interface TerminalKeyArbiterOptions {
  /** Read lazily — the terminal is created after the handler is attached. */
  getTerminal: () => BlurrableTerminal | null | undefined;
  getContainer: () => HTMLElement | null | undefined;
  /** Injectable for tests; defaults to `performance.now()`. */
  now?: () => number;
}

/**
 * Builds the verdict function for an xterm `attachCustomKeyEventHandler`:
 * returns what that handler must return (`true` = let xterm have the key).
 *
 * Owns the double-Escape window internally, so no surface hand-rolls the
 * timestamp bookkeeping. Note the reset on release: after a hatch fires, the
 * next Escape starts a fresh pair rather than instantly re-triggering.
 */
export const createTerminalKeyArbiter = ({
  getTerminal,
  getContainer,
  now = () => performance.now(),
}: TerminalKeyArbiterOptions) => {
  // NOT 0: `decideTerminalKey` asks whether `now - lastEscapeAt` is inside
  // the hatch window, so a 0 sentinel means "a previous Escape at time 0" —
  // and a first Escape pressed while the clock is still under
  // TERMINAL_ESCAPE_HATCH_MS would release focus on its own. -Infinity is
  // the honest "no previous Escape".
  let lastEscapeAt = Number.NEGATIVE_INFINITY;
  return (event: KeyboardEvent): boolean => {
    const decision = decideTerminalKey(event, lastEscapeAt, now());
    if (event.key === 'Escape') {
      lastEscapeAt = decision === 'release-focus' ? Number.NEGATIVE_INFINITY : now();
    }
    if (decision === 'release-focus') {
      releaseTerminalFocus(getTerminal(), getContainer());
      return false;
    }
    return decision === 'terminal';
  };
};
