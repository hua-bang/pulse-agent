import type { KeyboardEvent as ReactKeyboardEvent } from 'react';

/**
 * True while the user is mid-IME-composition (typing Chinese/Japanese/Korean
 * with a candidate window open). Enter/Escape handlers that submit, commit,
 * or cancel must bail out in that state — the keypress is aimed at the IME
 * (confirm/dismiss the candidate), not at the app.
 *
 * `keyCode === 229` covers Chromium/WebKit reporting the IME placeholder
 * code on the keydown that ends a composition, where `isComposing` may
 * already be false.
 */
export const isImeComposing = (
  e: ReactKeyboardEvent<Element> | KeyboardEvent,
): boolean => {
  const native: KeyboardEvent =
    (e as ReactKeyboardEvent<Element>).nativeEvent ?? (e as KeyboardEvent);
  return native.isComposing || native.keyCode === 229;
};
