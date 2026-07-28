/**
 * Terminal scrollback text normalization — the single source of truth for the
 * rules that turn raw PTY/xterm output into something an agent can read.
 *
 * Deliberately split out of `scrollback.ts`: that module owns the live
 * per-session capture and therefore imports `pty-manager`, which pulls in
 * `electron` + the `node-pty` native binding. The persisted-node read path
 * (`agent/context-builder.ts`) needs the cleaning rules without either.
 *
 * Two callers, one ruleset:
 * - `getSessionScrollback` (live terminal tab, `canvas_read_tab`)
 * - `normalizeNodeScrollback` (persisted node data, `canvas_read_node`)
 */

/**
 * Tail kept when a persisted node's scrollback is read. The stored cap is
 * 50k chars (renderer `MAX_SCROLLBACK_CHARS`), and a TUI agent fills that with
 * redrawn frames and box padding, so returning it whole put ~50k chars of
 * mostly-noise into the model's context — or tripped the engine's 30k offload
 * threshold and cost an extra file read. 16k keeps a real session's output
 * while staying inline.
 */
export const NODE_SCROLLBACK_READ_MAX_CHARS = 16_000;

// Control bytes are referenced by code point (ESC = 27) via the RegExp
// constructor so no literal control bytes live in the source.
const ESC = '\\x1b';
const ANSI_CSI = new RegExp(`${ESC}\\[[0-9;?]*[ -/]*[@-~]`, 'g'); // colors, cursor moves
const ANSI_OSC = new RegExp(`${ESC}\\][^\\x07${ESC}]*(?:\\x07|${ESC}\\\\)`, 'g'); // title, links
const ANSI_ESC = new RegExp(`${ESC}[@-Z\\\\-_]`, 'g'); // single-char escapes
const CTRL_CHARS = new RegExp('[\\x00-\\x08\\x0b\\x0c\\x0e-\\x1f]', 'g'); // other control chars

/** Strip ANSI/VT control sequences so the captured buffer reads as plain text. */
export function stripTerminalControlSequences(raw: string): string {
  return raw
    .replace(ANSI_CSI, '')
    .replace(ANSI_OSC, '')
    .replace(ANSI_ESC, '')
    .replace(/\r(?!\n)/g, '') // bare CRs that just re-draw the line
    .replace(CTRL_CHARS, '');
}

export interface NormalizeScrollbackOptions {
  /** Maximum characters to keep, counted from the END — newest output wins. */
  maxChars?: number;
  /**
   * Prepend a `[… N chars of earlier scrollback omitted …]` line when the head
   * was dropped. Off by default so callers that report the returned length as
   * "the text" keep their existing shape.
   */
  omissionNotice?: boolean;
}

/**
 * Clean a raw scrollback buffer and optionally keep only its tail.
 *
 * Padding removal is not cosmetic: a full-screen TUI pads every box line out
 * to the terminal width, so trailing whitespace is a large fraction of the
 * characters an agent read would otherwise pay for.
 *
 * When truncating, the cut is moved forward to the next line boundary so the
 * result never opens mid-line. The omission notice, when enabled, is added on
 * top of `maxChars`.
 */
export function normalizeScrollback(
  raw: string,
  options: NormalizeScrollbackOptions = {},
): string {
  const cleaned = stripTerminalControlSequences(raw)
    .replace(/[^\S\n]+$/gm, '') // TUI right-padding on every framed line
    .replace(/\n{3,}/g, '\n\n')
    .trimEnd();

  const { maxChars, omissionNotice } = options;
  if (maxChars === undefined || cleaned.length <= maxChars) return cleaned;

  const cut = cleaned.length - maxChars;
  const nextLineBreak = cleaned.indexOf('\n', cut);
  const start = nextLineBreak === -1 ? cut : nextLineBreak + 1;
  const tail = cleaned.slice(start);
  if (!omissionNotice) return tail;
  return `[… ${start.toLocaleString('en-US')} chars of earlier scrollback omitted …]\n${tail}`;
}

/**
 * Normalization applied when a persisted `terminal`/`agent` node is read.
 * Stored scrollback usually arrives already parsed by xterm, but nodes written
 * by `canvas-cli` or older app versions can still carry raw control bytes, so
 * the strip stays in the path.
 */
export function normalizeNodeScrollback(raw: string): string {
  return normalizeScrollback(raw, {
    maxChars: NODE_SCROLLBACK_READ_MAX_CHARS,
    omissionNotice: true,
  });
}
