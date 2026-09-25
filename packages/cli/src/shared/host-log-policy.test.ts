import { describe, expect, it, vi } from 'vitest';

import { HostLogPolicy, formatStartupFailure } from './host-log-policy.js';
import type { EngineLogEntry } from './log-sink.js';

const entry = (level: EngineLogEntry['level'], text: string): EngineLogEntry => ({
  at: 1,
  level,
  text,
});

describe('HostLogPolicy', () => {
  it('keeps normal startup diagnostics out of the default transcript', () => {
    const render = vi.fn();
    const policy = new HostLogPolicy({ render, logFile: '/tmp/cli.log' });

    policy.handle(entry('log', '[PluginManager] Loaded built-in plugin skills'));
    policy.finishStartup();

    expect(render).not.toHaveBeenCalled();
  });

  it('summarizes non-blocking extension failures and keeps details discoverable', () => {
    const render = vi.fn();
    const policy = new HostLogPolicy({ render, logFile: '/tmp/cli.log' });

    policy.handle(entry('warn', '[MCP] Failed to load server "docs": fetch failed'));
    policy.handle(entry('warn', '[MCP] Failed to load server "local": spawn tool ENOENT'));
    policy.handle(entry('warn', 'Skill file /private/example/SKILL.md missing required fields (name or description)'));
    policy.finishStartup();

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(
      'warn',
      'Extensions: 3 issues (MCP 2, Skills 1). Check extension configuration; details: --verbose or /tmp/cli.log',
    );
  });

  it('groups plugin-manager and skill-file failures into the startup summary', () => {
    const render = vi.fn();
    const policy = new HostLogPolicy({ render, logFile: '/tmp/cli.log' });

    policy.handle(entry('warn', 'Failed to read skill file /private/example/SKILL.md: denied'));
    policy.handle(entry('warn', '[PluginManager] Missing recommended capability "skills"'));
    policy.finishStartup();

    expect(render).toHaveBeenCalledWith(
      'warn',
      'Extensions: 2 issues (Skills 1, Other 1). Check extension configuration; details: --verbose or /tmp/cli.log',
    );
  });

  it('shows full diagnostics in verbose mode', () => {
    const render = vi.fn();
    const policy = new HostLogPolicy({ render, logFile: '/tmp/cli.log', verbose: true });

    policy.handle(entry('warn', '[MCP] Failed to load server "docs": fetch failed'));
    policy.finishStartup();

    expect(render).toHaveBeenCalledWith('warn', '[MCP] Failed to load server "docs": fetch failed');
    expect(render).toHaveBeenCalledTimes(1);
  });

  it('always surfaces error entries in the default mode', () => {
    const render = vi.fn();
    const policy = new HostLogPolicy({ render, logFile: '/tmp/cli.log' });

    policy.handle(entry('error', 'engine initialization failed'));

    expect(render).toHaveBeenCalledWith('error', 'engine initialization failed');
  });

  it('keeps blocking startup failures explicit', () => {
    expect(formatStartupFailure(new Error('engine initialization failed')))
      .toContain('Failed to start CLI: Error: engine initialization failed');
  });
});
