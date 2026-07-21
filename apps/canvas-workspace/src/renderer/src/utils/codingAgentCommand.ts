const CODING_AGENT_COMMAND_PATTERN = /^(?:env\s+)?(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)*(?:(?:npx|bunx)(?:\s+(?:-y|--yes))?\s+|(?:pnpm|npm|yarn)\s+(?:dlx|exec)\s+(?:--\s+)?)?(claude|codex|@anthropic-ai\/claude-code|@openai\/codex)(?:\s|$)/;
const ANSI_PATTERN = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1B\\))/g;
const TERMINAL_OUTPUT_TAIL_LIMIT = 3000;

const SHELL_PROMPT_PATTERNS = [
  /(?:^|\n)[^\n]*(?:╰|└)[^\n]*(?:❯|➜|›|\$|%|#)\s*$/,
  /(?:^|\n)(?:➜\s+\S[^\n]*|[~/][^\n]*)(?:❯|➜|›|\$|%|#)\s*$/,
  /(?:^|\n)(?:\([^\n)]{1,40}\)\s*)?[\w.-]+@[\w.-]+:[^\n]*(?:\$|#)\s*$/,
  /(?:^|\n)(?:\([^\n)]{1,40}\)\s*)?\[[^\n\]]+@[\w.-]+\s+[^\n\]]+\](?:\$|#)\s*$/,
];

export const detectCodingAgentCommand = (command: string): 'claude-code' | 'codex' | undefined => {
  const match = CODING_AGENT_COMMAND_PATTERN.exec(command.trim());
  if (!match) return undefined;
  return match[1].includes('claude') ? 'claude-code' : 'codex';
};

export const isCodingAgentCommand = (command: string): boolean => (
  detectCodingAgentCommand(command) !== undefined
);

/** Detects terminal output emitted after Claude or Codex exits, e.g.
 *  `Resume this session with:\n  claude --resume <uuid>` or
 *  `To continue this session, run codex resume <uuid>`.
 *  This is more reliable than shell-prompt heuristics alone because the
 *  message format is fixed and independent of the user's shell prompt. */
const CLAUDE_EXIT_PATTERN = /Resume this session with:\s*\n\s*claude\s+--resume\s+\S+/i;
const CODEX_EXIT_PATTERN = /To continue this session,.*?run\s+codex\s+resume\s+\S+/i;

export const detectCodingAgentExit = (text: string): boolean => (
  CLAUDE_EXIT_PATTERN.test(text) || CODEX_EXIT_PATTERN.test(text)
);

export const appendTerminalOutputTail = (tail: string, data: string): string => {
  const text = data.replace(ANSI_PATTERN, '').replace(/\r/g, '\n');
  return `${tail}${text}`.slice(-TERMINAL_OUTPUT_TAIL_LIMIT);
};

export const hasLikelyReturnedToShellPrompt = (tail: string): boolean => (
  SHELL_PROMPT_PATTERNS.some((pattern) => pattern.test(tail))
);
