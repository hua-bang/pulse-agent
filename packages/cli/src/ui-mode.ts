export type CliUiMode = 'readline' | 'ink';

export interface ParsedCliArgs {
  uiMode: CliUiMode;
  print: boolean;
  prompt: string;
  continueLast: boolean;
  verbose: boolean;
  model?: string;
}

export function resolveCliUiMode(args = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): CliUiMode {
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
 * Unrecognized tokens are collected as the prompt (used only with `-p`).
 */
export function parseCliArgs(args = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): ParsedCliArgs {
  const promptParts: string[] = [];
  let print = false;
  let continueLast = false;
  let verbose = false;
  let model: string | undefined;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--ui' || arg === '--tui') {
      index += 1;
      continue;
    }
    if (arg === '--model') {
      model = args[index + 1];
      index += 1;
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
    promptParts.push(arg);
  }

  return {
    uiMode: resolveCliUiMode(args, env),
    print,
    prompt: promptParts.join(' '),
    continueLast,
    verbose,
    ...(model ? { model } : {}),
  };
}
