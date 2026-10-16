import { beforeEach, expect, it, vi } from 'vitest';

const read = vi.hoisted(() => vi.fn());
const open = vi.hoisted(() => vi.fn());
vi.mock('../../core/logs', async () => ({
  ...await vi.importActual('../../core/logs'), readRecordedLogs: read,
}));
vi.mock('../../core/log-viewer', () => ({ openLogViewer: open }));
vi.mock('../options', () => ({
  getWorkspaceCommandOptions: async (command: { optsWithGlobals(): { format?: string } }) => ({
    workspace: 'ws-1', format: command.optsWithGlobals().format ?? 'text',
  }),
}));
import { createCli } from '../../cli';
import { LogError } from '../../core/logs';

beforeEach(() => {
  vi.restoreAllMocks();
  read.mockReset(); open.mockReset();
});

it('reads run/session logs offline and automatically opens the reusable viewer', async () => {
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  read.mockResolvedValue({ runs: [] });
  for (const [args, selector] of [
    [['--run', 'r-1'], { runId: 'r-1', sessionId: undefined }],
    [['--session', 's-1'], { sessionId: 's-1', runId: undefined }],
  ] as const) {
    await createCli().parseAsync(['--format', 'json', 'log', ...args, '--log-dir', '/saved/runs'], { from: 'user' });
    expect(read).toHaveBeenLastCalledWith(selector, 'ws-1', '/saved/runs');
    expect(JSON.parse(String(log.mock.calls.at(-1)?.[0]))).toEqual({ runs: [] });
  }
  const runs = [{ runId: 'r-1' }];
  read.mockResolvedValue({ runs });
  open.mockResolvedValue({ opened: true, path: '/tmp/viewer.html' });
  await createCli().parseAsync(['log', '--run', 'r-1', '--open'], { from: 'user' });
  expect(open).toHaveBeenCalledWith(runs, { runId: 'r-1', sessionId: undefined }, 'ws-1');
  expect(log).toHaveBeenLastCalledWith('Opened DevTools: /tmp/viewer.html');
});

it('rejects invalid selectors before disk access and preserves reader error codes', async () => {
  const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(process, 'exit').mockImplementation(() => { throw new Error('exit'); });
  for (const args of [[], ['--run', 'r-1', '--session', 's-1'], ['--run', '../secret']]) {
    await expect(createCli().parseAsync(['--format', 'json', 'log', ...args], { from: 'user' }))
      .rejects.toThrow('exit');
    expect(JSON.parse(String(error.mock.calls.at(-1)?.[0]))).toMatchObject({ code: 'invalid_argument' });
  }
  expect(read).not.toHaveBeenCalled();
  read.mockRejectedValue(new LogError('run_not_found', 'No recorded run.'));
  await expect(createCli().parseAsync(['--format', 'json', 'log', '--run', 'missing'], { from: 'user' }))
    .rejects.toThrow('exit');
  expect(JSON.parse(String(error.mock.calls.at(-1)?.[0]))).toMatchObject({ code: 'run_not_found' });
});
