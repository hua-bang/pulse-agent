/**
 * Detect `pulse-canvas` shell commands that add canvas nodes.
 *
 * Auto mode must show the node-creation card for these. `apply --dry-run`
 * only validates and stays ungated. A `#` comment is not that flag. A newline
 * between the binary and its subcommand still counts: bash line continuation
 * joins those lines, and splitting on the newline used to hide the command.
 */

const CLI_NODE_CREATION_RE =
  /\bpulse-canvas\b[\s\S]*?\s(?:node\s+create|workspace\s+create|apply)(?=\s|$)/i;
const CLI_BINARY_RE = /\bpulse-canvas\b/i;
const CLI_SUBCOMMAND_START_RE =
  /^\s*(?:node\s+create|workspace\s+create|apply)(?=\s|$)/i;
const CLI_DIRECT_CREATE_RE =
  /(?:^|\s)(?:node\s+create|workspace\s+create)(?=\s|$)/i;
const CLI_APPLY_RE = /(?:^|\s)apply(?=\s|$)/i;

type ShellPiece = { text: string; brokeOnNewline: boolean };

function collapseShellContinuations(command: string): string {
  // Bash deletes an unquoted backslash-newline before it runs the line.
  // Do that first so a comment cannot hide a flag that the join pulls in,
  // and so `pulse-canvas \<newline>node create` stays one command.
  return command.replace(/\\\r?\n/g, '');
}

function isShellSeparator(ch: string): boolean {
  return ch === '\n' || ch === '\r' || ch === ';' || ch === '&' || ch === '|';
}

function isEscapedDoubleQuote(command: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && command[i] === '\\'; i--) slashes += 1;
  return slashes % 2 === 1;
}

/** Split on unquoted `;`, `&`, `|`, and newlines. Keep quote contents intact. */
function splitShellPieces(command: string): ShellPiece[] {
  const pieces: ShellPiece[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let brokeOnNewline = false;

  const push = (): void => {
    pieces.push({ text: current, brokeOnNewline });
    current = '';
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (quote) {
      current += ch;
      if (ch === quote && (quote === "'" || !isEscapedDoubleQuote(command, i))) quote = null;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      current += ch + command[i + 1];
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (isShellSeparator(ch)) {
      let newlineOnly = ch === '\n' || ch === '\r';
      while (i + 1 < command.length && isShellSeparator(command[i + 1])) {
        i += 1;
        if (command[i] !== '\n' && command[i] !== '\r') newlineOnly = false;
      }
      push();
      brokeOnNewline = newlineOnly;
      continue;
    }
    current += ch;
  }
  push();
  return pieces;
}

/** An unquoted `--dry-run` word. Text after `#` on that line is a comment. */
function hasUnquotedDryRun(command: string): boolean {
  let quote: '"' | "'" | null = null;
  let word = '';
  let inWord = false;
  let quotedWord = false;
  let commented = false;

  const flush = (): boolean => {
    const found = inWord && !quotedWord && /^--dry-run(?:$|=)/i.test(word);
    word = '';
    inWord = false;
    quotedWord = false;
    return found;
  };

  for (let i = 0; i < command.length; i++) {
    const ch = command[i];
    if (commented) {
      if (ch === '\n') commented = false;
      continue;
    }
    if (quote) {
      quotedWord = true;
      inWord = true;
      if (ch === quote && (quote === "'" || !isEscapedDoubleQuote(command, i))) {
        quote = null;
        continue;
      }
      if (quote === '"' && ch === '\\' && i + 1 < command.length) {
        word += command[i + 1];
        i += 1;
        continue;
      }
      word += ch;
      continue;
    }
    if (ch === '\\' && i + 1 < command.length) {
      word += command[i + 1];
      i += 1;
      inWord = true;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      quotedWord = true;
      inWord = true;
      continue;
    }
    if (ch === '#' && !inWord) {
      commented = true;
      continue;
    }
    if (/\s/.test(ch) || isShellSeparator(ch)) {
      if (flush()) return true;
      continue;
    }
    word += ch;
    inWord = true;
  }
  return flush();
}

function pieceCreatesNodes(text: string): boolean {
  if (!CLI_NODE_CREATION_RE.test(text)) return false;
  // `node create` / `workspace create` write even when the same segment
  // also mentions `apply --dry-run`. Only a pure apply dry-run is exempt.
  if (CLI_DIRECT_CREATE_RE.test(text)) return true;
  return !(CLI_APPLY_RE.test(text) && hasUnquotedDryRun(text));
}

function newlineJoinsCreation(previous: string, next: string): boolean {
  return CLI_BINARY_RE.test(previous)
    && !CLI_NODE_CREATION_RE.test(previous)
    && CLI_SUBCOMMAND_START_RE.test(next);
}

export function isCliCanvasNodeCreation(name: string, input: unknown): boolean {
  if (name.trim().toLowerCase() !== 'bash' || !input || typeof input !== 'object') return false;
  const command = (input as { command?: unknown }).command;
  if (typeof command !== 'string') return false;
  const pieces = splitShellPieces(collapseShellContinuations(command))
    .filter(piece => piece.text.trim());
  if (pieces.some(piece => pieceCreatesNodes(piece.text))) return true;
  for (let i = 1; i < pieces.length; i++) {
    const piece = pieces[i];
    if (!piece.brokeOnNewline) continue;
    if (newlineJoinsCreation(pieces[i - 1].text, piece.text)) return true;
  }
  return false;
}
