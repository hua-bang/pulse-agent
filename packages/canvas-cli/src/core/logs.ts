import { promises as fs } from 'fs';
import { homedir } from 'os';
import { join, resolve } from 'path';

export interface LogSelector {
  runId?: string;
  sessionId?: string;
}
export interface RecordedLogRun {
  runId: string;
  sessionId: string;
  workspaceId: string;
  startedAt: number;
  trace: Record<string, unknown>;
  [key: string]: unknown;
}
export class LogError extends Error {
  constructor(public readonly code: string, message: string) { super(message); }
}

export function defaultLogDirectory(): string {
  const data = process.platform === 'darwin'
    ? join(homedir(), 'Library', 'Application Support')
    : process.platform === 'win32'
      ? process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
      : process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config');
  return join(data, 'Pulse Canvas', 'plugins', 'devtools', 'runs');
}

export function validateLogSelector(input: LogSelector): void {
  if ((input.runId !== undefined) === (input.sessionId !== undefined)) {
    throw new LogError('invalid_argument', 'Provide exactly one of --run or --session.');
  }
  const id = input.runId ?? input.sessionId!;
  if (!/^[a-zA-Z0-9_-]{1,256}$/.test(id)) {
    throw new LogError('invalid_argument', 'Log IDs must contain only letters, numbers, underscores, or hyphens.');
  }
}

/** Read the DevTools plugin's persisted StoredRun records without starting Canvas. */
export async function readRecordedLogs(
  selector: LogSelector,
  workspaceId: string,
  directory = defaultLogDirectory(),
): Promise<{ runs: RecordedLogRun[] }> {
  validateLogSelector(selector);
  const root = resolve(directory);
  const readRun = async (runId: string): Promise<RecordedLogRun | undefined> => {
    const path = join(root, `${runId}.json`);
    // The live plugin serializes its readers; an offline reader retries a
    // partial JSON write rather than treating an in-progress trace as corrupt.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        const stored = JSON.parse(await fs.readFile(path, 'utf8'));
        const detail = stored?.detail;
        if (!detail || detail.runId !== runId || typeof detail.sessionId !== 'string'
          || typeof detail.workspaceId !== 'string' || !Number.isFinite(detail.startedAt)
          || !detail.trace || typeof detail.trace !== 'object') {
          throw new LogError('log_corrupt', `Invalid DevTools record: ${path}`);
        }
        return detail as RecordedLogRun;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
        if (error instanceof SyntaxError && attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 20 * (attempt + 1)));
          continue;
        }
        if (error instanceof LogError) throw error;
        throw new LogError(error instanceof SyntaxError ? 'log_corrupt' : 'io_error',
          `Cannot read DevTools record: ${path}`);
      }
    }
    return undefined;
  };
  if (selector.runId) {
    const run = await readRun(selector.runId);
    if (!run || run.workspaceId !== workspaceId) {
      throw new LogError('run_not_found', `No recorded run ${selector.runId} in workspace ${workspaceId}.`);
    }
    return { runs: [run] };
  }
  let names: string[];
  try {
    names = await fs.readdir(root);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { runs: [] };
    throw new LogError('io_error', `Cannot read DevTools directory: ${root}`);
  }
  const runs: RecordedLogRun[] = [];
  for (const name of names) {
    if (!/^[a-zA-Z0-9_-]{1,256}\.json$/.test(name)) continue;
    const run = await readRun(name.slice(0, -5));
    if (run?.workspaceId === workspaceId && run.sessionId === selector.sessionId) runs.push(run);
  }
  return { runs: runs.sort((a, b) => b.startedAt - a.startedAt) };
}
