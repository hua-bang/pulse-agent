export type OutputFormat = 'json' | 'text';

/**
 * The format resolved from the global `--format` flag, set once per invocation
 * (via a commander `preAction` hook in cli.ts) so `errorOutput` can emit a
 * machine-readable error even at call sites that don't thread the format
 * through. Defaults to `text` for the rare error raised before any action runs.
 */
let activeFormat: OutputFormat = 'text';

export function setActiveFormat(format: OutputFormat): void {
  activeFormat = format === 'json' ? 'json' : 'text';
}

export function getActiveFormat(): OutputFormat {
  return activeFormat;
}

export function output(data: unknown, format: OutputFormat, textFn: (d: unknown) => string): void {
  if (format === 'json') {
    console.log(JSON.stringify(data, null, 2));
  } else {
    console.log(textFn(data));
  }
}

export interface ErrorOptions {
  /**
   * Stable machine-readable identifier for the failure so external callers can
   * branch on it (e.g. `workspace_not_found`, `runtime_unreachable`). Defaults
   * to `error`. Surfaced only in `--format json` output.
   */
  code?: string;
  /** Process exit code. Defaults to 1. */
  exitCode?: number;
  /** Force a format instead of using the resolved global one. */
  format?: OutputFormat;
}

/**
 * Print an error and exit non-zero. In `--format json` the error is emitted as
 * a JSON object `{ ok: false, error, code }` on stderr, so a machine consumer
 * gets parseable output on both the success (stdout) and failure (stderr)
 * paths; in text mode it stays a human `Error: …` line.
 */
export function errorOutput(message: string, opts: ErrorOptions = {}): never {
  const format = opts.format ?? activeFormat;
  const code = opts.code ?? 'error';
  if (format === 'json') {
    console.error(JSON.stringify({ ok: false, error: message, code }));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(opts.exitCode ?? 1);
}
