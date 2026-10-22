const escapeText = (text: string): string => text
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;');

/** Plain text as escaped HTML with one <br> per line break. */
export function plainTextToHtml(text: string): string {
  return text.split(/\r\n|\r|\n/).map(escapeText).join('<br>');
}

/**
 * Insert plain text at the caret of the focused contentEditable as ONE editing
 * step. `insertText` splits multi-line text into one paragraph insertion per
 * line and fires two `input` events per line; a 400-line paste then re-runs the
 * composer's input handler about 800 times and freezes the window for seconds.
 * `insertHTML` with <br> line breaks fires one `input` event and keeps undo.
 */
export function insertPlainText(text: string): void {
  if (!/[\r\n]/.test(text)) {
    document.execCommand('insertText', false, text);
    return;
  }
  document.execCommand('insertHTML', false, plainTextToHtml(text));
}
