import { describe, expect, it } from 'vitest';
import { electronCommand } from '../launch.mjs';

const base = { cdpPort: 9333, electronUserDataDir: '/tmp/ud' };

describe('electronCommand', () => {
  it('launches the built app directly with CDP and headless Chromium flags', () => {
    const { command, args } = electronCommand({ ...base, dev: false, headless: true });
    expect(command).toMatch(/electron/);
    expect(args).toEqual(expect.arrayContaining([
      '--remote-debugging-port=9333',
      '--user-data-dir=/tmp/ud',
      '--no-sandbox',
      '--disable-gpu',
      '--disable-dev-shm-usage',
    ]));
  });

  it('delegates dev launches to electron-vite with watch and forwarded Electron args', () => {
    const { command, args } = electronCommand({ ...base, dev: true, headless: true });
    expect(command).toMatch(/node_modules[\\/]\.bin[\\/]electron-vite$/);
    const separator = args.indexOf('--');
    expect(args.slice(0, separator)).toEqual(['dev', '--watch', '--remoteDebuggingPort', '9333', '--noSandbox']);
    expect(args.slice(separator + 1)).toEqual(['--user-data-dir=/tmp/ud', '--disable-gpu', '--disable-dev-shm-usage']);
  });

  it('keeps the sandbox and GPU when not headless', () => {
    expect(electronCommand({ ...base, dev: false, headless: false }).args).not.toContain('--no-sandbox');
    expect(electronCommand({ ...base, dev: true, headless: false }).args).toEqual([
      'dev', '--watch', '--remoteDebuggingPort', '9333', '--', '--user-data-dir=/tmp/ud',
    ]);
  });
});
