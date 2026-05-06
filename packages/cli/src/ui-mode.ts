export type CliUiMode = 'readline' | 'ink';

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
  if (envValue === 'ink') {
    return 'ink';
  }

  return 'readline';
}
