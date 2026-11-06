export type CliUiMode = 'readline' | 'ink';

export interface ParsedCliArgs {
  uiMode: CliUiMode;
  print: boolean;
  prompt: string;
  continueLast: boolean;
  verbose: boolean;
  model?: string;
  isolated?: boolean;
  timeoutSeconds?: number;
  maxSteps?: number;
  maxTokens?: number;
  outputFormat?: 'text' | 'jsonl';
  traceFile?: string;
}

function positiveIntegerFlag(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${flag} requires a positive integer`);
  }
  return parsed;
}

function nonNegativeIntegerFlag(flag: string, value: string | undefined): number {
  const parsed = Number(value);
  if (!value || !Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${flag} requires a non-negative integer`);
  }
  return parsed;
}

function requiredFlagValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith('-')) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

/**
 * Resolves the UI host.
 *
 * A non-TTY stdin always forces readline: Ink needs raw mode, and asking for
 * it on a pipe/redirect throws out of a React effect (an unhandled crash, not
 * a graceful message). This overrides `--ui ink` on purpose — it is a hard
 * capability constraint, not a preference.
 */
export function resolveCliUiMode(
  args = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = Boolean(process.stdin.isTTY),
): CliUiMode {
  if (!isTTY) {
    return 'readline';
  }

  const flagIndex = args.findIndex(arg => arg === '--ui' || arg === '--tui');
  if (flagIndex >= 0) {
    const value = args[flagIndex + 1]?.toLowerCase();
    if (value === 'ink') {
      return 'ink';
    }
    if (value === 'readline' || value === 'plain') {
      return 'readline';
    }
  }

  const inlineFlag = args.find(arg => arg.startsWith('--ui=') || arg.startsWith('--tui='));
  if (inlineFlag) {
    const value = inlineFlag.split('=')[1]?.toLowerCase();
    if (value === 'ink') {
      return 'ink';
    }
    if (value === 'readline' || value === 'plain') {
      return 'readline';
    }
  }

  const envValue = env.PULSE_CODER_UI?.toLowerCase();
  if (envValue === 'readline' || envValue === 'plain') {
    return 'readline';
  }
  if (envValue === 'ink') {
    return 'ink';
  }

  return 'ink';
}

/**
 * Full CLI argument parse. Recognized flags:
 * - `--ui <mode>` / `--tui <mode>` / `--ui=<mode>` / `--tui=<mode>` — UI host
 * - `-p` / `--print` — non-interactive print mode; remaining words become the prompt
 * - `-c` / `--continue` — resume the most recent session on startup
 * - `--verbose` — show engine logs live in the Ink transcript (same as /debug on)
 * - `--isolated` — disable persistent/plugin state for reproducible print-mode runs
 * - `--timeout <seconds>` / `--max-steps <n>` / `--max-tokens <n>` — print-mode budgets
 * - `--output-format text|jsonl` / `--trace-file <path>` — machine-readable print-mode output
 * Unrecognized tokens are collected as the prompt (used only with `-p`).
 */
export function parseCliArgs(
  args = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env,
  isTTY: boolean = Boolean(process.stdin.isTTY),
): ParsedCliArgs {
  const promptParts: string[] = [];
  let print = false;
  let continueLast = false;
  let verbose = false;
  let model: string | undefined;
  let isolated = false;
  let timeoutSeconds: number | undefined;
  let maxSteps: number | undefined;
  let maxTokens: number | undefined;
  let outputFormat: 'text' | 'jsonl' | undefined;
  let traceFile: string | undefined;
  let hasPrintOnlyOption = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--ui' || arg === '--tui') {
      index += 1;
      continue;
    }
    if (arg === '--model') {
      const next = args[index + 1];
      // Never swallow the following token when it is itself a flag — that
      // silently ate --print/--continue and left model undefined.
      if (next && !next.startsWith('-')) {
        model = next;
        index += 1;
      }
      continue;
    }
    if (arg.startsWith('--model=')) {
      model = arg.slice('--model='.length);
      continue;
    }
    if (arg.startsWith('--ui=') || arg.startsWith('--tui=')) {
      continue;
    }
    if (arg === '-p' || arg === '--print') {
      print = true;
      continue;
    }
    if (arg === '-c' || arg === '--continue') {
      continueLast = true;
      continue;
    }
    if (arg === '--verbose') {
      verbose = true;
      continue;
    }
    if (arg === '--isolated') {
      isolated = true;
      hasPrintOnlyOption = true;
      continue;
    }
    if (arg === '--timeout' || arg === '--max-steps' || arg === '--max-tokens') {
      const value = args[index + 1];
      const parsed = arg === '--timeout'
        ? nonNegativeIntegerFlag(arg, value)
        : positiveIntegerFlag(arg, value);
      hasPrintOnlyOption = true;
      if (arg === '--timeout') timeoutSeconds = parsed;
      if (arg === '--max-steps') maxSteps = parsed;
      if (arg === '--max-tokens') maxTokens = parsed;
      index += 1;
      continue;
    }
    if (arg.startsWith('--timeout=')) {
      hasPrintOnlyOption = true;
      timeoutSeconds = nonNegativeIntegerFlag('--timeout', arg.slice('--timeout='.length));
      continue;
    }
    if (arg.startsWith('--max-steps=')) {
      hasPrintOnlyOption = true;
      maxSteps = positiveIntegerFlag('--max-steps', arg.slice('--max-steps='.length));
      continue;
    }
    if (arg.startsWith('--max-tokens=')) {
      hasPrintOnlyOption = true;
      maxTokens = positiveIntegerFlag('--max-tokens', arg.slice('--max-tokens='.length));
      continue;
    }
    if (arg === '--output-format') {
      hasPrintOnlyOption = true;
      const value = requiredFlagValue(arg, args[index + 1]);
      if (value !== 'text' && value !== 'jsonl') {
        throw new Error('--output-format must be text or jsonl');
      }
      outputFormat = value;
      index += 1;
      continue;
    }
    if (arg.startsWith('--output-format=')) {
      hasPrintOnlyOption = true;
      const value = arg.slice('--output-format='.length);
      if (value !== 'text' && value !== 'jsonl') {
        throw new Error('--output-format must be text or jsonl');
      }
      outputFormat = value;
      continue;
    }
    if (arg === '--trace-file') {
      hasPrintOnlyOption = true;
      traceFile = requiredFlagValue(arg, args[index + 1]);
      index += 1;
      continue;
    }
    if (arg.startsWith('--trace-file=')) {
      hasPrintOnlyOption = true;
      traceFile = requiredFlagValue('--trace-file', arg.slice('--trace-file='.length));
      continue;
    }
    promptParts.push(arg);
  }

  if (hasPrintOnlyOption && !print) {
    throw new Error('benchmark controls require -p or --print');
  }

  return {
    uiMode: resolveCliUiMode(args, env, isTTY),
    print,
    prompt: promptParts.join(' '),
    continueLast,
    verbose,
    ...(model ? { model } : {}),
    ...(isolated ? { isolated } : {}),
    ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
    ...(maxSteps ? { maxSteps } : {}),
    ...(maxTokens ? { maxTokens } : {}),
    ...(outputFormat ? { outputFormat } : {}),
    ...(traceFile ? { traceFile } : {}),
  };
}
