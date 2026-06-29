const CODING_AGENT_COMMAND_PATTERN = /^(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:(?:npx|bunx)\s+|(?:pnpm|npm|yarn)\s+(?:dlx|exec)\s+)?(?:claude|codex)(?:\s|$)/;
const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const TERMINAL_OUTPUT_TAIL_LIMIT = 3000;

const SHELL_PROMPT_PATTERNS = [
  /(?:^|\n)[^\n]*(?:╰|└)[^\n]*(?:❯|➜|›|\$|%|#)\s*$/,
  /(?:^|\n)(?:➜\s+\S[^\n]*|[~/][^\n]*)(?:❯|➜|›|\$|%|#)\s*$/,
];

export const isCodingAgentCommand = (command: string): boolean => (
  CODING_AGENT_COMMAND_PATTERN.test(command.trim())
);

export const appendTerminalOutputTail = (tail: string, data: string): string => {
  // ANSI_PATTERN only matches sequences starting with the ESC byte (\x1B), so a
  // chunk without one cannot contain any match — skip the global regex scan
  // (the expensive part) for plain-text chunks, which are the common case.
  const stripped = data.indexOf('\x1B') === -1 ? data : data.replace(ANSI_PATTERN, '');
  const text = stripped.replace(/\r/g, '\n');
  return `${tail}${text}`.slice(-TERMINAL_OUTPUT_TAIL_LIMIT);
};

export const hasLikelyReturnedToShellPrompt = (tail: string): boolean => (
  SHELL_PROMPT_PATTERNS.some((pattern) => pattern.test(tail))
);
