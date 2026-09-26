import { describe, expect, it } from 'vitest';
import { stopProcess } from '../session.mjs';

const recorder = () => {
  const calls = { kill: [], run: [] };
  return {
    calls,
    kill: (...args) => calls.kill.push(args),
    run: (...args) => calls.run.push(args),
  };
};

describe('stopProcess', () => {
  it('signals the detached process group on POSIX', () => {
    const r = recorder();
    stopProcess({ pid: 123, processGroup: true }, 'SIGTERM', { platform: 'linux', ...r });
    expect(r.calls.kill).toEqual([[-123, 'SIGTERM']]);
    expect(r.calls.run).toEqual([]);
  });

  it('kills the dev process tree with taskkill on Windows, where negative pids throw', () => {
    const r = recorder();
    stopProcess({ pid: 123, processGroup: true }, 'SIGTERM', { platform: 'win32', ...r });
    expect(r.calls.kill).toEqual([]);
    expect(r.calls.run[0].slice(0, 2)).toEqual(['taskkill', ['/pid', '123', '/T', '/F']]);
  });

  it('signals a single built-mode pid directly on every platform', () => {
    const r = recorder();
    stopProcess({ pid: 123 }, 'SIGTERM', { platform: 'win32', ...r });
    expect(r.calls.kill).toEqual([[123, 'SIGTERM']]);
  });
});
