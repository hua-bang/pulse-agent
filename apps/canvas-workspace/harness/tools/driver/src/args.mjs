import { HarnessError } from './errors.mjs';

const BOOLEAN_FLAGS = new Set([
  'json',
  'build',
  'force',
  'reset',
  'allow-real-writes',
  'cleanup',
  'enable-webview-page-control',
  'headless',
]);

export function parseArgs(rawArgs) {
  const opts = {};
  const positional = [];
  for (let i = 0; i < rawArgs.length; i++) {
    const arg = rawArgs[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }

    const eq = arg.indexOf('=');
    const key = arg.slice(2, eq > -1 ? eq : undefined);
    const inlineValue = eq > -1 ? arg.slice(eq + 1) : undefined;
    if (BOOLEAN_FLAGS.has(key)) {
      opts[key] = true;
      continue;
    }

    const value = inlineValue ?? rawArgs[++i];
    if (value === undefined) throw new HarnessError(`Missing value for --${key}`);
    if (key === 'flag') {
      opts.flag = [...(opts.flag ?? []), value];
    } else {
      opts[key] = value;
    }
  }
  return { opts, positional };
}
