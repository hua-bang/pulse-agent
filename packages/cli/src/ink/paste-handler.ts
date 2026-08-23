import type { ClipboardImageResult } from '../shared/clipboard-image.js';

/**
 * Paste handler dependencies. `readImage` reads the system clipboard (the
 * terminal protocol never carries bitmaps — when the clipboard holds an image,
 * a bracketed paste fires with an empty payload). `submitImage` hands the
 * result to the same image-part channel as `/paste-image` / `@image.png`.
 */
export interface PasteHandlerDeps {
  insertPastedText: (text: string) => void;
  readImage: () => Promise<ClipboardImageResult | null>;
  submitImage: (result: ClipboardImageResult) => void;
}

/**
 * Builds the `usePaste` handler.
 *
 * Text pastes keep the classic composer insertion (paste a URL, a diff, a
 * wall of text — unchanged). An EMPTY paste payload means the clipboard holds
 * a bitmap: terminals cannot transmit images, so the app must read the system
 * clipboard itself. When the clipboard really has an image it is submitted as
 * an image message; an empty text clipboard stays silently ignored (copying
 * whitespace is not a reason to warn).
 */
export function buildPasteHandler(deps: PasteHandlerDeps): (text: string) => void {
  const { insertPastedText, readImage, submitImage } = deps;
  return (text) => {
    if (text && text.trim().length > 0) {
      insertPastedText(text);
      return;
    }
    void readImage().then((result) => {
      if (result) {
        submitImage(result);
      }
    }).catch(() => {
      // No image (or platform unsupported): nothing to paste, stay silent.
    });
  };
}
