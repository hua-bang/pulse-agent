/**
 * Detect bash commands that add canvas nodes through `pulse-canvas`.
 *
 * Auto mode must show the approval card for these. `apply --dry-run` only
 * validates and stays ungated. A `#` comment is not that flag. A newline
 * between the binary and its subcommand still counts: bash line continuation
 * joins those lines, and splitting on the newline used to hide the command.
 */

const DIRECT = '(?:node\\s+create|workspace\\s+create)';
const SUB = `(?:${DIRECT}|apply)`;
// Newlines stay inside the match so `pulse-canvas\\nnode create` cannot hide
// between `;`, `&`, or `|` segments. Those separators still bound the match.
const creationRe = new RegExp(`\\bpulse-canvas\\b[^;&|]*?\\s${SUB}(?=\\s|$)`, 'i');
const directCreateRe = new RegExp(`(?:^|\\s)${DIRECT}(?=\\s|$)`, 'i');
const applyRe = /(?:^|\s)apply(?=\s|$)/i;
const dryRunRe = /(?:^|\s)--dry-run(?=\s|=|$)/i;

/** A real `--dry-run` word. Quoted text and `#` comments do not count. */
function hasUnquotedDryRun(command: string): boolean {
  const visible = command
    .replace(/'[^']*'/g, ' ')
    .replace(/"(?:\\.|[^"\\])*"/g, ' ')
    .replace(/#[^\n]*/g, ' ');
  return dryRunRe.test(visible);
}

/**
 * True when the command only validates. `node create` / `workspace create`
 * write even if the same text also mentions `apply --dry-run`. A `--dry-run`
 * on another line, or inside a comment or quotes, does not exempt `apply`.
 */
function isApplyDryRunOnly(source: string): boolean {
  if (directCreateRe.test(source)) return false;
  const applyLines = source.split(/\r?\n|\r/).filter(line =>
    applyRe.test(line) && creationRe.test(line));
  return applyLines.length > 0 && applyLines.every(hasUnquotedDryRun);
}

export function isCliCanvasNodeCreation(name: string, input: unknown): boolean {
  if (name.trim().toLowerCase() !== 'bash' || !input || typeof input !== 'object') return false;
  const command = (input as { command?: unknown }).command;
  if (typeof command !== 'string') return false;
  const source = command.replace(/\\\r?\n/g, '');
  return creationRe.test(source) && !isApplyDryRunOnly(source);
}
