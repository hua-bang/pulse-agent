/**
 * Read-only bash command classifier for planning mode.
 *
 * Mirrors Claude Code's built-in read-only command set (see
 * code.claude.com/docs/en/permissions#read-only-commands): a fixed list of
 * commands runs without approval in every mode; everything else needs
 * authorization. Planning mode has no authorization flow, so the classifier
 * FAILS CLOSED — any command it cannot confidently prove read-only is blocked.
 *
 * The classifier is a pure function. It deliberately does not execute
 * anything, so it never blocks the event loop and never has a side effect.
 */
import path from 'node:path';

export interface ReadonlyCommandResult {
  allowed: boolean;
  /** Present when blocked; names the specific rule that failed. */
  reason?: string;
}

export interface ReadonlyCommandOptions {
  /**
   * Working directory used to decide whether a `cd` target stays inside the
   * workspace. Defaults to `process.cwd()` when omitted.
   */
  cwd?: string;
}

/** Commands that run without approval in every mode (Claude Code built-in set). */
const READONLY_COMMANDS = new Set([
  'ls',
  'cat',
  'echo',
  'pwd',
  'head',
  'tail',
  'grep',
  'find',
  'wc',
  'which',
  'diff',
  'stat',
  'du',
  'cd',
]);

/**
 * git subcommands that are read-only forms. Anything else (`add`, `commit`,
 * `push`, `checkout`, `reset`, `clean`, ...) is blocked in planning mode.
 */
const GIT_READONLY_SUBCOMMANDS = new Set([
  'status',
  'diff',
  'log',
  'show',
  'blame',
  'ls-files',
  'ls-tree',
  'grep',
  'rev-parse',
  'describe',
  'remote',
  'branch',
  'tag',
  'stash',
  'config',
  'help',
  'version',
]);

/**
 * find flags that write, execute, or mutate the filesystem. The presence of
 * any of these makes a `find` command non-read-only.
 */
const FIND_WRITE_FLAGS = new Set([
  '-delete',
  '-exec',
  '-execdir',
  '-ok',
  '-okdir',
  '-fprint',
  '-fprintf',
  '-fls',
  '-fprint0',
  '-touch',
]);

const MAX_COMMAND_LENGTH = 10_000;

interface ShellSegment {
  /** argv tokens for the segment, with quoting metadata stripped. */
  argv: string[];
  /** True when any token was quoted or escaped (glob characters inside are inert). */
  hasQuotedParts: boolean;
  /** True when an unquoted glob character (`*`, `?`, `[`) appears. */
  hasUnquotedGlob: boolean;
  /** Output redirect targets other than /dev/null, e.g. `> out.txt`, `2>> log`. */
  outputRedirects: string[];
  /** True when a command substitution `$(...)` or backtick appears anywhere. */
  hasCommandSubstitution: boolean;
}

/**
 * Lightweight shell word splitter. It tracks quotes, escapes, glob markers,
 * redirects, and command substitutions well enough to classify read-only
 * commands; it is NOT a full shell parser. Anything ambiguous is surfaced so
 * the caller can fail closed.
 */
function tokenize(command: string): { segments: ShellSegment[]; parseError?: string } {
  const segments: ShellSegment[] = [];
  let argv: string[] = [];
  let current = '';
  let hasQuotedParts = false;
  let hasUnquotedGlob = false;
  let hasCommandSubstitution = false;
  let redirects: string[] = [];
  let inRedirectTarget = false;
  let quote: '"' | "'" | null = null;
  let escaped = false;

  const flushWord = () => {
    if (current) {
      argv.push(current);
      current = '';
    }
  };

  const flushSegment = () => {
    flushWord();
    segments.push({
      argv,
      hasQuotedParts,
      hasUnquotedGlob,
      outputRedirects: redirects,
      hasCommandSubstitution,
    });
    argv = [];
    redirects = [];
    hasQuotedParts = false;
    hasUnquotedGlob = false;
    hasCommandSubstitution = false;
    inRedirectTarget = false;
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i];

    if (escaped) {
      current += ch;
      hasQuotedParts = true;
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (quote === "'") {
      current += ch;
      hasQuotedParts = true;
      if (ch === "'") quote = null;
      continue;
    }

    if (quote === '"') {
      current += ch;
      hasQuotedParts = true;
      if (ch === '"') {
        quote = null;
      } else if (ch === '$' && command[i + 1] === '(') {
        hasCommandSubstitution = true;
      } else if (ch === '`') {
        hasCommandSubstitution = true;
      }
      continue;
    }

    if (ch === "'" || ch === '"') {
      quote = ch;
      hasQuotedParts = true;
      current += ch;
      continue;
    }

    // Command substitution markers outside quotes are dangerous; fail closed.
    if ((ch === '$' && command[i + 1] === '(') || ch === '`') {
      hasCommandSubstitution = true;
      current += ch;
      continue;
    }

    // Redirect operators. `>` `>>` `2>` `2>>` `&>` `&>>` `<` are structure.
    if (ch === '>' || ch === '<') {
      // A bare fd digit (`2>`, `1>>`) belongs to the operator, not the argv.
      if (/^\d+$/.test(current)) {
        current = '';
      } else {
        flushWord();
      }
      // Consume the whole redirect operator (`>>`, `2>`, `&>>`).
      let operator = ch;
      while (
        i + 1 < command.length &&
        (command[i + 1] === '>' || command[i + 1] === '<' || command[i + 1] === '&')
      ) {
        operator += command[i + 1];
        i += 1;
      }
      if (operator.includes('>')) {
        inRedirectTarget = true;
      }
      continue;
    }

    if (inRedirectTarget) {
      if (/\s/.test(ch)) continue;
      // Next unquoted word is the redirect target.
      let target = '';
      while (i < command.length && !/[\s|&;<>]/.test(command[i])) {
        target += command[i];
        i += 1;
      }
      i -= 1;
      redirects.push(target);
      inRedirectTarget = false;
      continue;
    }

    if (ch === '|' || ch === '&' || ch === ';') {
      flushSegment();
      // Skip a following duplicate operator (`||`, `&&`, `|&`).
      if (command[i + 1] === ch || (ch === '&' && command[i + 1] === '&')) i += 1;
      continue;
    }

    if (/\s/.test(ch)) {
      flushWord();
      continue;
    }

    if (ch === '*' || ch === '?' || ch === '[') {
      hasUnquotedGlob = true;
    }

    current += ch;
  }

  if (quote) {
    return { segments: [], parseError: 'unbalanced quotes' };
  }
  if (escaped) {
    return { segments: [], parseError: 'trailing escape' };
  }

  flushSegment();
  return { segments };
}

/** True when `cmd` is one of the built-in read-only commands. */
function isReadonlyCommand(cmd: string): boolean {
  return READONLY_COMMANDS.has(cmd);
}

function isSafeGit(argv: string[]): boolean {
  // Walk from argv[1]: skip global flags; `-C <path>` consumes its value.
  // The first non-flag token is the subcommand. `git --version`, `git help`,
  // and bare `git` are fine.
  let i = 1;
  while (i < argv.length) {
    const arg = argv[i];
    if (arg === '-C' && i + 1 < argv.length) {
      i += 2;
      continue;
    }
    if (arg.startsWith('-')) {
      i += 1;
      continue;
    }
    return GIT_READONLY_SUBCOMMANDS.has(arg);
  }
  return true;
}

function hasFindWriteFlag(argv: string[]): boolean {
  return argv.some((arg) => FIND_WRITE_FLAGS.has(arg));
}

function isInsideWorkspace(target: string, cwd: string): boolean {
  if (target === '.' || target === './') return true;
  if (target === '-' || target.startsWith('$')) return false;
  // `~` expands to $HOME in the shell; path.resolve would treat it as a plain
  // directory name and wrongly resolve it inside the workspace.
  if (target === '~' || target.startsWith('~/')) return false;
  try {
    const resolved = path.resolve(cwd, target);
    const root = path.resolve(cwd);
    return resolved === root || resolved.startsWith(root + path.sep);
  } catch {
    return false;
  }
}

/**
 * Classify a bash command string.
 *
 * Returns `{ allowed: true }` only when every segment provably stays inside
 * the built-in read-only set with no write-capable flags, no output redirect
 * (other than `/dev/null`), no command substitution, no unquoted glob on a
 * write-capable command, and no `cd` leaving the workspace. Everything else —
 * including anything the tokenizer cannot parse — is `{ allowed: false }`.
 */
export function isReadonlyBashCommand(command: string, options?: ReadonlyCommandOptions): ReadonlyCommandResult {
  if (!command || !command.trim()) {
    return { allowed: false, reason: 'empty command' };
  }
  if (command.length > MAX_COMMAND_LENGTH) {
    return { allowed: false, reason: `command exceeds ${MAX_COMMAND_LENGTH} characters; treat as non-read-only` };
  }

  const cwd = options?.cwd ?? process.cwd();
  const { segments, parseError } = tokenize(command);
  if (parseError) {
    return { allowed: false, reason: `unparseable command (${parseError})` };
  }

  for (const segment of segments) {
    if (segment.argv.length === 0) continue;

    if (segment.hasCommandSubstitution) {
      return { allowed: false, reason: 'command substitution is not read-only' };
    }

    // Output redirects write a file (or open one for writing).
    if (segment.outputRedirects.some((target) => target !== '/dev/null')) {
      return { allowed: false, reason: 'output redirection writes a file' };
    }

    const cmd = segment.argv[0];

    if (cmd === 'cd') {
      // `cd` alone or into a workspace subdirectory is fine; leaving the
      // workspace, or combining with a redirect, is not.
      const target = segment.argv[1];
      if (segment.outputRedirects.length > 0) {
        return { allowed: false, reason: 'cd with output redirection is not read-only' };
      }
      if (target !== undefined && !isInsideWorkspace(target, cwd)) {
        return { allowed: false, reason: 'cd outside the workspace is not read-only' };
      }
      continue;
    }

    if (cmd === 'git') {
      if (!isSafeGit(segment.argv)) {
        return { allowed: false, reason: 'git subcommand is not read-only' };
      }
      if (segment.hasUnquotedGlob) {
        // Glob could expand to a flag like `-delete` on other commands; for
        // git, be conservative.
        return { allowed: false, reason: 'git with unquoted glob is not treated as read-only' };
      }
      continue;
    }

    if (!isReadonlyCommand(cmd)) {
      return { allowed: false, reason: `command \`${cmd}\` is not in the read-only set` };
    }

    if (cmd === 'find' && hasFindWriteFlag(segment.argv)) {
      return { allowed: false, reason: 'find with a write/execute flag is not read-only' };
    }

    if (segment.hasUnquotedGlob && cmd === 'find') {
      // find has write-capable flags (-delete, -exec), so an unquoted glob
      // could expand into one of them.
      return { allowed: false, reason: 'find with unquoted glob is not treated as read-only' };
    }
  }

  return { allowed: true };
}
