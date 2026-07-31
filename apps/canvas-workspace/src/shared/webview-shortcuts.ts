/**
 * Shortcuts that must survive focus being inside an embedded `<webview>`.
 *
 * A webview guest runs in its own renderer process, so a keystroke aimed at
 * it never reaches the host window's `keydown` listeners. That made every
 * embedded page a keyboard black hole: click into a link node and the
 * command palette, workspace switching, canvas zoom, and Escape all went
 * dead with no way back except the mouse.
 *
 * Main watches `before-input-event` on each registered guest, and for the
 * chords below only it swallows the keystroke and forwards it to the host
 * renderer, which re-dispatches it as an ordinary `keydown`.
 *
 * The list is deliberately narrow — anything a web page might legitimately
 * want (Cmd+F find-in-page, Cmd+C/V, arrows, Delete) stays with the guest.
 * It lives in `shared/` because main cannot import the renderer's shortcut
 * registry; `shortcuts/registry.test.ts` asserts every chord here still
 * corresponds to a real registry binding, so the two cannot drift.
 */
export interface ForwardedChord {
  /** `KeyboardEvent.key`, compared case-insensitively. */
  key: string;
  /** Cmd on macOS, Ctrl elsewhere — matched as meta OR control. */
  mod?: boolean;
  /** Literal Control on every platform. */
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export const WEBVIEW_FORWARDED_CHORDS: ForwardedChord[] = [
  // Command palette + its macOS-safe alternate.
  { key: 'k', mod: true },
  { key: 'h', ctrl: true },
  // Node cycling.
  { key: 'Tab', ctrl: true },
  { key: 'Tab', ctrl: true, shift: true },
  // Canvas zoom.
  { key: '0', mod: true },
  { key: '=', mod: true },
  { key: '-', mod: true },
  // Panels.
  { key: 'a', mod: true, shift: true },
  { key: 'e', mod: true, shift: true },
  { key: 'l', mod: true, shift: true },
  { key: '\\', mod: true },
  // Workspace switching.
  ...Array.from({ length: 9 }, (_, index) => ({ key: String(index + 1), mod: true })),
  // Escape is the way back out of a guest that has swallowed focus.
  { key: 'Escape' },
];

/** Modifier state as reported by Electron's `before-input-event`. */
export interface ChordInput {
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}

const matchesChord = (input: ChordInput, chord: ForwardedChord): boolean => {
  if (input.key.toLowerCase() !== chord.key.toLowerCase()) return false;
  if (chord.ctrl) {
    if (!input.control || input.meta) return false;
  } else if (chord.mod) {
    if (!(input.meta || input.control)) return false;
  } else if (input.meta || input.control) {
    return false;
  }
  if (!!chord.alt !== input.alt) return false;
  if (!!chord.shift !== input.shift) return false;
  return true;
};

export const isForwardedShortcut = (input: ChordInput): boolean =>
  WEBVIEW_FORWARDED_CHORDS.some((chord) => matchesChord(input, chord));

/** Payload re-dispatched as a `keydown` in the host renderer. */
export interface ForwardedShortcut {
  key: string;
  control: boolean;
  meta: boolean;
  alt: boolean;
  shift: boolean;
}
