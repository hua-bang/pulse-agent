import { Command } from 'commander';
import { readRecordedLogs, validateLogSelector, LogError } from '../core/logs';
import { openLogViewer } from '../core/log-viewer';
import { errorOutput, output } from '../output';
import { getWorkspaceCommandOptions } from './options';

export function registerLogCommand(program: Command): void {
  program.command('log')
    .description('Read saved DevTools traces without starting Canvas')
    .option('--run <runId>', 'Read one run')
    .option('--session <sessionId>', 'Read all recorded runs in a session, newest first')
    .option('--open', 'Open an offline snapshot in the existing DevTools UI')
    .option('--log-dir <path>', 'DevTools runs directory (default: Canvas userData/plugins/devtools/runs)')
    .action(async function (this: Command, options: { run?: string; session?: string; open?: boolean; logDir?: string }) {
      const selector = { runId: options.run, sessionId: options.session };
      try {
        validateLogSelector(selector);
      } catch (error) {
        errorOutput((error as Error).message, { code: (error as LogError).code });
      }
      const { format, workspace } = await getWorkspaceCommandOptions(this, { requireReadableCanvas: false });
      try {
        const result = await readRecordedLogs(selector, workspace, options.logDir);
        const value = options.open ? await openLogViewer(result.runs, selector, workspace) : result;
        output(value, format, renderLogs);
      } catch (error) {
        errorOutput((error as Error).message, { code: error instanceof LogError ? error.code : 'io_error' });
      }
    });
}

function renderLogs(value: unknown): string {
  const data = value as { opened?: boolean; path?: string; runs?: unknown[] };
  if (data.opened) return `Opened DevTools: ${data.path}`;
  if (!data.runs?.length) return 'No recorded traces found for this session.';
  return JSON.stringify(data, null, 2);
}
